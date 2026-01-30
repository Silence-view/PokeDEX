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
 * @dev NFT Marketplace for buying and selling PokeDEX cards
 * @notice Supports listings, offers, and ERC-2981 royalties
 */
contract PokeDEXMarketplace is AccessControl, ReentrancyGuard, Pausable {
    /// @notice Role for managing marketplace fees
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    /// @notice Marketplace fee in basis points (100 = 1%)
    uint256 public marketplaceFee = 250; // 2.5%

    /// @notice Maximum fee allowed (10%)
    uint256 public constant MAX_FEE = 1000;

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

    /// @notice Events
    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );

    event ListingCancelled(uint256 indexed listingId);

    event ListingUpdated(uint256 indexed listingId, uint256 newPrice);

    event Sale(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        address nftContract,
        uint256 tokenId,
        uint256 price
    );

    event OfferMade(
        uint256 indexed offerId,
        address indexed buyer,
        address indexed nftContract,
        uint256 tokenId,
        uint256 amount,
        uint256 expiresAt
    );

    event OfferCancelled(uint256 indexed offerId);

    event OfferAccepted(
        uint256 indexed offerId,
        address indexed seller,
        address indexed buyer,
        uint256 amount
    );

    event MarketplaceFeeUpdated(uint256 oldFee, uint256 newFee);

    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    /// @notice Emitted when an NFT is traded
    event NFTTraded(
        address indexed nftContract,
        uint256 indexed tokenId,
        uint256 salePrice,
        address indexed buyer,
        uint256 totalTrades
    );

    /// @notice Emitted when royalty is paid
    event RoyaltyPaid(
        uint256 indexed listingId,
        address indexed royaltyRecipient,
        uint256 amount
    );

    /// @notice Emitted when a refund is issued
    event RefundIssued(address indexed recipient, uint256 amount);

    /**
     * @notice Contract constructor
     * @param admin Admin address
     * @param _feeRecipient Address to receive marketplace fees
     * @param _pokeDEXCard Address of PokeDEXCard contract
     */
    constructor(address admin, address _feeRecipient, address _pokeDEXCard) {
        require(admin != address(0), "Invalid admin");
        require(_feeRecipient != address(0), "Invalid fee recipient");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEE_MANAGER_ROLE, admin);

        feeRecipient = _feeRecipient;
        if (_pokeDEXCard != address(0)) {
            pokeDEXCard = IPokeDEXCard(_pokeDEXCard);
        }
    }

    /**
     * @notice Set PokeDEXCard contract reference
     * @param _pokeDEXCard Address of PokeDEXCard contract
     */
    function setPokeDEXCard(address _pokeDEXCard) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pokeDEXCard != address(0), "Invalid address");
        pokeDEXCard = IPokeDEXCard(_pokeDEXCard);
    }

    /**
     * @notice List an NFT for sale
     * @param nftContract NFT contract address
     * @param tokenId Token ID to list
     * @param price Listing price in wei
     * @param imageURI IPFS URI for card image (for display)
     * @return listingId The created listing ID
     */
    function listNFT(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        string calldata imageURI
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(price > 0, "Price must be positive");
        require(nftContract != address(0), "Invalid NFT contract");

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

        emit Listed(listingId, msg.sender, nftContract, tokenId, price);

        return listingId;
    }

    /**
     * @notice Cancel a listing
     * @param listingId Listing ID to cancel
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.seller == msg.sender, "Not seller");

        listing.active = false;
        activeListings[listing.nftContract][listing.tokenId] = 0;

        emit ListingCancelled(listingId);
    }

    /**
     * @notice Update listing price
     * @param listingId Listing ID to update
     * @param newPrice New price in wei
     */
    function updateListing(uint256 listingId, uint256 newPrice) external nonReentrant {
        require(newPrice > 0, "Price must be positive");

        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.seller == msg.sender, "Not seller");

        listing.price = newPrice;

        emit ListingUpdated(listingId, newPrice);
    }

    /**
     * @notice Buy a listed NFT
     * @param listingId Listing ID to buy
     */
    function buyNFT(uint256 listingId) external payable nonReentrant whenNotPaused {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(msg.value >= listing.price, "Insufficient payment");
        require(msg.sender != listing.seller, "Cannot buy own listing");

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

        emit Sale(
            listingId,
            listing.seller,
            msg.sender,
            listing.nftContract,
            listing.tokenId,
            price
        );

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
     * @param nftContract NFT contract address
     * @param tokenId Token ID to make offer on
     * @param duration Offer duration in seconds
     * @return offerId The created offer ID
     */
    function makeOffer(
        address nftContract,
        uint256 tokenId,
        uint256 duration
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value > 0, "Offer must be positive");
        require(duration >= 1 hours && duration <= 30 days, "Invalid duration");
        require(nftContract != address(0), "Invalid NFT contract");

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
     * @notice Cancel an offer and get refund
     * @param offerId Offer ID to cancel
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
     * @notice Accept an offer (by NFT owner)
     * @param offerId Offer ID to accept
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
            listings[listingId].active = false;
            activeListings[offer.nftContract][offer.tokenId] = 0;
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
     * @notice Withdraw expired offer funds
     * @param offerId Offer ID to withdraw
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
     * @notice Set marketplace fee
     * @param newFee New fee in basis points
     */
    function setMarketplaceFee(uint256 newFee) external onlyRole(FEE_MANAGER_ROLE) {
        require(newFee <= MAX_FEE, "Fee too high");
        uint256 oldFee = marketplaceFee;
        marketplaceFee = newFee;
        emit MarketplaceFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Set fee recipient
     * @param newRecipient New recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "Invalid recipient");
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @notice Pause marketplace
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause marketplace
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================

    /**
     * @dev Check if contract supports ERC-2981
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
