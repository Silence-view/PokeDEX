// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./interfaces/IPokeDEXCard.sol";

/**
 * @title PokeDEXMarketplace
 * @author PokeDEX Team
 * @notice NFT Marketplace for buying and selling PokeDEX cards with support for listings, offers, and ERC-2981 royalties
 * @dev Implements a secure marketplace with reentrancy protection, pausability, and role-based access control.
 *      Supports both direct listings and offer-based trading mechanisms.
 *      Automatically handles ERC-2981 royalty payments when supported by the NFT contract.
 *
 *      Key security features:
 *      - ReentrancyGuard prevents reentrancy attacks on payment functions
 *      - Pausable allows emergency stops
 *      - AccessControl manages admin and fee manager roles
 *      - Two-step admin transfer prevents accidental role loss
 *      - CEI (Checks-Effects-Interactions) pattern followed for all state changes
 *      - MIN_LISTING_DURATION prevents listing manipulation attacks
 *
 *      Fee Structure:
 *      - Marketplace fee: 2.5% default (configurable up to 10%)
 *      - ERC-2981 royalties: Capped at 10% per sale
 */
contract PokeDEXMarketplace is AccessControl, ReentrancyGuard, Pausable {
    /// @notice Role for managing marketplace fees
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER
    // =============================================================================

    /// @notice Address of pending admin for two-step transfer
    address public pendingAdmin;

    /// @notice Address of current admin who initiated the transfer
    address private _transferInitiator;

    /// @notice Emitted when admin transfer is initiated
    event AdminTransferInitiated(address indexed currentAdmin, address indexed pendingAdmin);

    /// @notice Emitted when admin transfer is completed
    event AdminTransferCompleted(address indexed oldAdmin, address indexed newAdmin);

    /// @notice Emitted when admin transfer is cancelled
    event AdminTransferCancelled(address indexed currentAdmin, address indexed cancelledPending);

    /// @notice Marketplace fee in basis points (100 = 1%)
    uint256 public marketplaceFee = 250; // 2.5%

    /// @notice Maximum fee allowed (10%)
    uint256 public constant MAX_FEE = 1000;

    /// @notice Minimum listing duration before cancellation allowed (prevents manipulation)
    uint256 public constant MIN_LISTING_DURATION = 1 hours;

    /// @notice ERC721 interface ID for validation
    bytes4 private constant ERC721_INTERFACE_ID = 0x80ac58cd;

    /// @notice Fee recipient address
    address public feeRecipient;

    /// @notice Listing structure
    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        bool active;
        uint256 createdAt;
        string imageURI;
    }

    /// @notice NFT trading statistics
    struct NFTStats {
        uint256 tradeCount;
        uint256 lastSalePrice;
        uint256 highestSalePrice;
        uint256 totalVolume;
        address lastBuyer;
        uint256 lastSaleTimestamp;
    }

    /// @notice Offer structure
    struct Offer {
        address buyer;
        address nftContract;
        uint256 tokenId;
        uint256 amount;
        uint256 expiresAt;
        bool active;
    }

    /// @notice Listing ID counter
    uint256 private _listingIdCounter;

    /// @notice Offer ID counter
    uint256 private _offerIdCounter;

    /// @notice Mapping from listing ID to Listing
    mapping(uint256 => Listing) public listings;

    /// @notice Mapping from offer ID to Offer
    mapping(uint256 => Offer) public offers;

    /// @notice Mapping from NFT (contract + tokenId) to active listing ID
    mapping(address => mapping(uint256 => uint256)) public activeListings;

    /// @notice Mapping from seller to their listing IDs
    mapping(address => uint256[]) public sellerListings;

    /// @notice Mapping from buyer to their offer IDs
    mapping(address => uint256[]) public buyerOffers;

    /// @notice Mapping from NFT (contract + tokenId) to trading stats
    mapping(address => mapping(uint256 => NFTStats)) public nftStats;

    /// @notice Reference to PokeDEXCard contract for setting sale prices
    IPokeDEXCard public pokeDEXCard;

    // =============================================================================
    // EVENTS
    // =============================================================================

    /**
     * @notice Emitted when an NFT is listed for sale
     * @param listingId Unique identifier for the listing
     * @param seller Address of the seller
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID of the listed NFT
     * @param price Listing price in wei
     */
    event NFTListed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );

    /**
     * @notice Emitted when an NFT is sold through a listing
     * @param listingId Unique identifier for the listing
     * @param buyer Address of the buyer
     * @param seller Address of the seller
     * @param price Sale price in wei
     */
    event NFTSold(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 price
    );

    /**
     * @notice Emitted when a listing is cancelled
     * @param listingId Unique identifier for the cancelled listing
     * @param seller Address of the seller who cancelled
     */
    event ListingCancelled(uint256 indexed listingId, address indexed seller);

    /**
     * @notice Emitted when a listing price is updated
     * @param listingId Unique identifier for the listing
     * @param oldPrice Previous price in wei
     * @param newPrice New price in wei
     */
    event PriceUpdated(uint256 indexed listingId, uint256 oldPrice, uint256 newPrice);

    /**
     * @notice Emitted when the fee recipient address is updated
     * @param oldRecipient Previous fee recipient address
     * @param newRecipient New fee recipient address
     */
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /**
     * @notice Emitted when the marketplace fee percentage is updated
     * @param oldFee Previous fee in basis points
     * @param newFee New fee in basis points
     */
    event FeePercentageUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @notice Emitted when an offer is made on an NFT
     * @param offerId Unique identifier for the offer
     * @param buyer Address of the offer maker
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID of the NFT
     * @param amount Offer amount in wei
     * @param expiresAt Timestamp when the offer expires
     */
    event OfferMade(
        uint256 indexed offerId,
        address indexed buyer,
        address indexed nftContract,
        uint256 tokenId,
        uint256 amount,
        uint256 expiresAt
    );

    /**
     * @notice Emitted when an offer is cancelled
     * @param offerId Unique identifier for the cancelled offer
     */
    event OfferCancelled(uint256 indexed offerId);

    /**
     * @notice Emitted when an offer is accepted
     * @param offerId Unique identifier for the accepted offer
     * @param seller Address of the NFT owner who accepted
     * @param buyer Address of the offer maker
     * @param amount Sale amount in wei
     */
    event OfferAccepted(
        uint256 indexed offerId,
        address indexed seller,
        address indexed buyer,
        uint256 amount
    );

    /**
     * @notice Emitted when an NFT is traded (tracks statistics)
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID of the traded NFT
     * @param salePrice Sale price in wei
     * @param buyer Address of the buyer
     * @param totalTrades Total number of trades for this NFT
     */
    event NFTTraded(
        address indexed nftContract,
        uint256 indexed tokenId,
        uint256 salePrice,
        address indexed buyer,
        uint256 totalTrades
    );

    /**
     * @notice Emitted when royalty is paid to the creator
     * @param listingId Listing ID associated with the sale
     * @param royaltyRecipient Address receiving the royalty
     * @param amount Royalty amount in wei
     */
    event RoyaltyPaid(
        uint256 indexed listingId,
        address indexed royaltyRecipient,
        uint256 amount
    );

    /**
     * @notice Emitted when excess payment is refunded to the buyer
     * @param recipient Address receiving the refund
     * @param amount Refund amount in wei
     */
    event RefundIssued(address indexed recipient, uint256 amount);

    /**
     * @notice Emitted when the PokeDEXCard contract reference is updated
     * @param oldAddress Previous PokeDEXCard contract address
     * @param newAddress New PokeDEXCard contract address
     */
    event PokeDEXCardUpdated(address indexed oldAddress, address indexed newAddress);

    /**
     * @notice Contract constructor
     * @dev Initializes the marketplace with admin roles and fee settings
     * @param admin Admin address (receives DEFAULT_ADMIN_ROLE and FEE_MANAGER_ROLE)
     * @param _feeRecipient Address to receive marketplace fees (cannot be zero address)
     * @param _pokeDEXCard Address of PokeDEXCard contract (optional, can be zero)
     */
    constructor(address admin, address _feeRecipient, address _pokeDEXCard) {
        require(admin != address(0), "Admin cannot be zero address");
        require(_feeRecipient != address(0), "Fee recipient cannot be zero address");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEE_MANAGER_ROLE, admin);

        feeRecipient = _feeRecipient;
        if (_pokeDEXCard != address(0)) {
            pokeDEXCard = IPokeDEXCard(_pokeDEXCard);
        }
    }

    /**
     * @notice Set PokeDEXCard contract reference
     * @dev Only callable by accounts with DEFAULT_ADMIN_ROLE
     * @dev Emits {PokeDEXCardUpdated} event on success
     * @param _pokeDEXCard Address of PokeDEXCard contract (cannot be zero address)
     */
    function setPokeDEXCard(address _pokeDEXCard) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pokeDEXCard != address(0), "PokeDEXCard address cannot be zero");
        address oldAddress = address(pokeDEXCard);
        pokeDEXCard = IPokeDEXCard(_pokeDEXCard);
        emit PokeDEXCardUpdated(oldAddress, _pokeDEXCard);
    }

    /**
     * @notice List an NFT for sale on the marketplace
     * @dev Requires the marketplace to be approved for the NFT transfer
     * @dev The NFT must implement ERC721 interface
     * @param nftContract NFT contract address (must be a valid ERC721 contract)
     * @param tokenId Token ID to list
     * @param price Listing price in wei (must be greater than zero)
     * @param imageURI IPFS URI for card image (for display purposes)
     * @return listingId The unique identifier for the created listing
     */
    function listNFT(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        string calldata imageURI
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(price > 0, "Price must be greater than zero");
        require(nftContract != address(0), "NFT contract cannot be zero address");
        require(_supportsERC721(nftContract), "Contract must support ERC721 interface");

        IERC721 nft = IERC721(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Not token owner");
        require(
            nft.isApprovedForAll(msg.sender, address(this)) ||
            nft.getApproved(tokenId) == address(this),
            "Marketplace not approved"
        );

        // Check if already listed
        uint256 existingListingId = activeListings[nftContract][tokenId];
        if (existingListingId != 0 && listings[existingListingId].active) {
            revert("Already listed");
        }

        uint256 listingId = ++_listingIdCounter;

        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            active: true,
            createdAt: block.timestamp,
            imageURI: imageURI
        });

        activeListings[nftContract][tokenId] = listingId;
        sellerListings[msg.sender].push(listingId);

        emit NFTListed(listingId, msg.sender, nftContract, tokenId, price);

        return listingId;
    }

    /**
     * @notice Cancel an active listing
     * @dev Only the seller can cancel their listing
     * @dev Listing must have been active for at least MIN_LISTING_DURATION to prevent manipulation
     * @param listingId The unique identifier of the listing to cancel
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.seller == msg.sender, "Not seller");
        require(
            block.timestamp >= listing.createdAt + MIN_LISTING_DURATION,
            "Cannot cancel before minimum listing duration"
        );

        listing.active = false;
        activeListings[listing.nftContract][listing.tokenId] = 0;

        emit ListingCancelled(listingId, msg.sender);
    }

    /**
     * @notice Update the price of an active listing
     * @dev Only the seller can update their listing price
     * @param listingId The unique identifier of the listing to update
     * @param newPrice New listing price in wei (must be greater than zero)
     */
    function updateListing(uint256 listingId, uint256 newPrice) external nonReentrant {
        require(newPrice > 0, "Price must be greater than zero");

        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.seller == msg.sender, "Not seller");

        uint256 oldPrice = listing.price;
        listing.price = newPrice;

        emit PriceUpdated(listingId, oldPrice, newPrice);
    }

    /**
     * @notice Purchase a listed NFT from the marketplace
     * @dev Handles marketplace fees, ERC-2981 royalties, and seller payment
     * @dev Excess payment is automatically refunded to the buyer
     * @param listingId The unique identifier of the listing to purchase
     */
    function buyNFT(uint256 listingId) external payable nonReentrant whenNotPaused {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(msg.value >= listing.price, "Insufficient payment");
        require(msg.sender != listing.seller, "Buyer cannot be the seller");

        IERC721 nft = IERC721(listing.nftContract);
        require(nft.ownerOf(listing.tokenId) == listing.seller, "Seller no longer owns NFT");

        // Mark as inactive before transfers (CEI pattern)
        listing.active = false;
        activeListings[listing.nftContract][listing.tokenId] = 0;

        // Calculate fees
        uint256 price = listing.price;
        uint256 marketplaceCut = (price * marketplaceFee) / 10000;
        uint256 royaltyAmount = 0;
        address royaltyRecipient = address(0);

        // Check for ERC-2981 royalties
        if (_supportsERC2981(listing.nftContract)) {
            (royaltyRecipient, royaltyAmount) = IERC2981(listing.nftContract).royaltyInfo(
                listing.tokenId,
                price
            );
            // Cap royalty at 10%
            if (royaltyAmount > price / 10) {
                royaltyAmount = price / 10;
            }
        }

        uint256 sellerProceeds = price - marketplaceCut - royaltyAmount;

        // Transfer NFT
        nft.safeTransferFrom(listing.seller, msg.sender, listing.tokenId);

        // Transfer payments
        if (marketplaceCut > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{value: marketplaceCut}("");
            require(feeSuccess, "Fee transfer failed");
        }

        if (royaltyAmount > 0 && royaltyRecipient != address(0)) {
            (bool royaltySuccess, ) = payable(royaltyRecipient).call{value: royaltyAmount}("");
            require(royaltySuccess, "Royalty transfer failed");
        }

        (bool sellerSuccess, ) = payable(listing.seller).call{value: sellerProceeds}("");
        require(sellerSuccess, "Seller payment failed");

        // Refund excess payment
        if (msg.value > price) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - price}("");
            require(refundSuccess, "Refund failed");
            emit RefundIssued(msg.sender, msg.value - price);
        }

        // Update NFT trading stats
        NFTStats storage stats = nftStats[listing.nftContract][listing.tokenId];
        stats.tradeCount++;
        stats.lastSalePrice = price;
        stats.highestSalePrice = price > stats.highestSalePrice ? price : stats.highestSalePrice;
        stats.totalVolume += price;
        stats.lastBuyer = msg.sender;
        stats.lastSaleTimestamp = block.timestamp;

        // Update PokeDEXCard last sale price if applicable
        if (address(pokeDEXCard) != address(0) && listing.nftContract == address(pokeDEXCard)) {
            try pokeDEXCard.setLastSalePrice(listing.tokenId, price) {} catch {}
        }

        emit NFTSold(listingId, msg.sender, listing.seller, price);

        emit NFTTraded(
            listing.nftContract,
            listing.tokenId,
            price,
            msg.sender,
            stats.tradeCount
        );

        if (royaltyAmount > 0) {
            emit RoyaltyPaid(listingId, royaltyRecipient, royaltyAmount);
        }
    }

    /**
     * @notice Make an offer on an NFT
     * @dev The offer amount is held in escrow until accepted, cancelled, or expired
     * @dev Offer duration must be between 1 hour and 30 days
     * @param nftContract NFT contract address (must be a valid ERC721 contract)
     * @param tokenId Token ID to make an offer on
     * @param duration Offer duration in seconds (min: 1 hour, max: 30 days)
     * @return offerId The unique identifier for the created offer
     */
    function makeOffer(
        address nftContract,
        uint256 tokenId,
        uint256 duration
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value > 0, "Offer amount must be greater than zero");
        require(duration >= 1 hours && duration <= 30 days, "Duration must be between 1 hour and 30 days");
        require(nftContract != address(0), "NFT contract cannot be zero address");
        require(_supportsERC721(nftContract), "Contract must support ERC721 interface");

        // Verify NFT exists
        IERC721 nft = IERC721(nftContract);
        address owner = nft.ownerOf(tokenId);
        require(owner != msg.sender, "Cannot offer on own NFT");

        uint256 offerId = ++_offerIdCounter;

        offers[offerId] = Offer({
            buyer: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            amount: msg.value,
            expiresAt: block.timestamp + duration,
            active: true
        });

        buyerOffers[msg.sender].push(offerId);

        emit OfferMade(offerId, msg.sender, nftContract, tokenId, msg.value, block.timestamp + duration);

        return offerId;
    }

    /**
     * @notice Cancel an active offer and receive a refund
     * @dev Only the offer maker can cancel their offer
     * @dev The escrowed offer amount is returned to the buyer
     * @param offerId The unique identifier of the offer to cancel
     */
    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "Offer not active");
        require(offer.buyer == msg.sender, "Not offer maker");

        offer.active = false;

        (bool success, ) = payable(msg.sender).call{value: offer.amount}("");
        require(success, "Refund failed");

        emit OfferCancelled(offerId);
    }

    /**
     * @notice Accept an offer on an owned NFT
     * @dev Only the current NFT owner can accept offers on their tokens
     * @dev Handles marketplace fees, ERC-2981 royalties, and seller payment
     * @dev Automatically cancels any active listing for the same NFT
     * @param offerId The unique identifier of the offer to accept
     */
    function acceptOffer(uint256 offerId) external nonReentrant whenNotPaused {
        Offer storage offer = offers[offerId];
        require(offer.active, "Offer not active");
        require(block.timestamp < offer.expiresAt, "Offer expired");

        IERC721 nft = IERC721(offer.nftContract);
        require(nft.ownerOf(offer.tokenId) == msg.sender, "Not token owner");
        require(
            nft.isApprovedForAll(msg.sender, address(this)) ||
            nft.getApproved(offer.tokenId) == address(this),
            "Marketplace not approved"
        );

        offer.active = false;

        // Cancel any active listing for this NFT
        uint256 listingId = activeListings[offer.nftContract][offer.tokenId];
        if (listingId != 0 && listings[listingId].active) {
            address listingSeller = listings[listingId].seller;
            listings[listingId].active = false;
            activeListings[offer.nftContract][offer.tokenId] = 0;
            emit ListingCancelled(listingId, listingSeller);
        }

        // Calculate fees
        uint256 amount = offer.amount;
        uint256 marketplaceCut = (amount * marketplaceFee) / 10000;
        uint256 royaltyAmount = 0;
        address royaltyRecipient = address(0);

        // Check for ERC-2981 royalties
        if (_supportsERC2981(offer.nftContract)) {
            (royaltyRecipient, royaltyAmount) = IERC2981(offer.nftContract).royaltyInfo(
                offer.tokenId,
                amount
            );
            if (royaltyAmount > amount / 10) {
                royaltyAmount = amount / 10;
            }
        }

        uint256 sellerProceeds = amount - marketplaceCut - royaltyAmount;

        // Transfer NFT
        nft.safeTransferFrom(msg.sender, offer.buyer, offer.tokenId);

        // Transfer payments
        if (marketplaceCut > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{value: marketplaceCut}("");
            require(feeSuccess, "Fee transfer failed");
        }

        if (royaltyAmount > 0 && royaltyRecipient != address(0)) {
            (bool royaltySuccess, ) = payable(royaltyRecipient).call{value: royaltyAmount}("");
            require(royaltySuccess, "Royalty transfer failed");
        }

        (bool sellerSuccess, ) = payable(msg.sender).call{value: sellerProceeds}("");
        require(sellerSuccess, "Seller payment failed");

        emit OfferAccepted(offerId, msg.sender, offer.buyer, amount);
    }

    /**
     * @notice Withdraw funds from an expired offer
     * @dev Only the offer maker can withdraw their expired offer funds
     * @dev The offer must have passed its expiration timestamp
     * @param offerId The unique identifier of the expired offer to withdraw
     */
    function withdrawExpiredOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "Offer not active");
        require(offer.buyer == msg.sender, "Not offer maker");
        require(block.timestamp >= offer.expiresAt, "Offer not expired");

        offer.active = false;

        (bool success, ) = payable(msg.sender).call{value: offer.amount}("");
        require(success, "Refund failed");

        emit OfferCancelled(offerId);
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get listing details
     * @param listingId Listing ID
     * @return Listing struct
     */
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    /**
     * @notice Get offer details
     * @param offerId Offer ID
     * @return Offer struct
     */
    function getOffer(uint256 offerId) external view returns (Offer memory) {
        return offers[offerId];
    }

    /**
     * @notice Get active listing for an NFT
     * @param nftContract NFT contract address
     * @param tokenId Token ID
     * @return listingId Active listing ID (0 if none)
     */
    function getActiveListingId(address nftContract, uint256 tokenId) external view returns (uint256) {
        uint256 listingId = activeListings[nftContract][tokenId];
        if (listingId != 0 && listings[listingId].active) {
            return listingId;
        }
        return 0;
    }

    /**
     * @notice Get seller's listing IDs
     * @param seller Seller address
     * @return Array of listing IDs
     */
    function getSellerListings(address seller) external view returns (uint256[] memory) {
        return sellerListings[seller];
    }

    /**
     * @notice Get buyer's offer IDs
     * @param buyer Buyer address
     * @return Array of offer IDs
     */
    function getBuyerOffers(address buyer) external view returns (uint256[] memory) {
        return buyerOffers[buyer];
    }

    /**
     * @notice Get NFT trading statistics
     * @param nftContract NFT contract address
     * @param tokenId Token ID
     * @return NFTStats struct with trading history
     */
    function getNFTStats(address nftContract, uint256 tokenId) external view returns (NFTStats memory) {
        return nftStats[nftContract][tokenId];
    }

    /**
     * @notice Get total listing count
     * @return Current listing ID counter
     */
    function totalListings() external view returns (uint256) {
        return _listingIdCounter;
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Update the marketplace fee percentage
     * @dev Only accounts with FEE_MANAGER_ROLE can call this function
     * @dev Fee cannot exceed MAX_FEE (10%)
     * @param newFee New fee in basis points (100 = 1%, max 1000 = 10%)
     */
    function setMarketplaceFee(uint256 newFee) external onlyRole(FEE_MANAGER_ROLE) {
        require(newFee <= MAX_FEE, "Fee too high");
        uint256 oldFee = marketplaceFee;
        marketplaceFee = newFee;
        emit FeePercentageUpdated(oldFee, newFee);
    }

    /**
     * @notice Update the fee recipient address
     * @dev Only accounts with DEFAULT_ADMIN_ROLE can call this function
     * @param newRecipient New recipient address (cannot be zero address)
     */
    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "Fee recipient cannot be zero address");
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @notice Pause the marketplace
     * @dev Only accounts with DEFAULT_ADMIN_ROLE can call this function
     * @dev When paused, listings, purchases, offers, and offer acceptances are disabled
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the marketplace
     * @dev Only accounts with DEFAULT_ADMIN_ROLE can call this function
     * @dev Restores normal marketplace operations
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER FUNCTIONS
    // =============================================================================

    /**
     * @notice Initiates admin transfer to a new address (step 1)
     * @dev Only callable by current admin. The new admin must call acceptAdminTransfer() to complete.
     * @param newAdmin The address to transfer admin role to
     */
    function initiateAdminTransfer(address newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAdmin != address(0), "New admin cannot be zero address");
        require(newAdmin != msg.sender, "New admin cannot be current admin");
        pendingAdmin = newAdmin;
        _transferInitiator = msg.sender;
        emit AdminTransferInitiated(msg.sender, newAdmin);
    }

    /**
     * @notice Completes admin transfer (step 2) - must be called by pending admin
     * @dev Grants DEFAULT_ADMIN_ROLE to pending admin and revokes from the initiating admin
     */
    function acceptAdminTransfer() external {
        require(msg.sender == pendingAdmin, "Only pending admin can accept");
        address oldAdmin = _transferInitiator;
        require(oldAdmin != address(0), "No pending transfer");

        _grantRole(DEFAULT_ADMIN_ROLE, pendingAdmin);
        _revokeRole(DEFAULT_ADMIN_ROLE, oldAdmin);

        emit AdminTransferCompleted(oldAdmin, pendingAdmin);
        pendingAdmin = address(0);
        _transferInitiator = address(0);
    }

    /**
     * @notice Cancels pending admin transfer
     * @dev Only callable by current admin
     */
    function cancelAdminTransfer() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(pendingAdmin != address(0), "No pending transfer");
        emit AdminTransferCancelled(msg.sender, pendingAdmin);
        pendingAdmin = address(0);
        _transferInitiator = address(0);
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================

    /**
     * @dev Check if contract supports ERC-721 interface
     * @param nftContract Contract address to check
     * @return True if supports ERC-721
     */
    function _supportsERC721(address nftContract) internal view returns (bool) {
        try IERC165(nftContract).supportsInterface(ERC721_INTERFACE_ID) returns (bool supported) {
            return supported;
        } catch {
            return false;
        }
    }

    /**
     * @dev Check if contract supports ERC-2981 royalty interface
     * @param nftContract Contract address to check
     * @return True if supports ERC-2981
     */
    function _supportsERC2981(address nftContract) internal view returns (bool) {
        try IERC165(nftContract).supportsInterface(type(IERC2981).interfaceId) returns (bool supported) {
            return supported;
        } catch {
            return false;
        }
    }
}
