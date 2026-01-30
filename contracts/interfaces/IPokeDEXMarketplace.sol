// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPokeDEXMarketplace
 * @author PokeDEX Team
 * @notice Interface for the PokeDEX NFT Marketplace
 * @dev Supports listings, offers, ERC-2981 royalties, trading statistics, and two-step admin transfer
 */
interface IPokeDEXMarketplace {
    // =============================================================================
    // STRUCTS
    // =============================================================================

    /// @notice Listing structure for NFTs on sale
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

    /// @notice Offer structure for NFT bids
    struct Offer {
        address buyer;
        address nftContract;
        uint256 tokenId;
        uint256 amount;
        uint256 expiresAt;
        bool active;
    }

    // =============================================================================
    // EVENTS
    // =============================================================================

    /**
     * @notice Emitted when an NFT is listed for sale
     * @param listingId Unique identifier for the listing
     * @param seller Address of the seller
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID being listed
     * @param price Listing price in wei
     */
    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );

    /**
     * @notice Emitted when a listing is cancelled
     * @param listingId Unique identifier of the cancelled listing
     */
    event ListingCancelled(uint256 indexed listingId);

    /**
     * @notice Emitted when a listing price is updated
     * @param listingId Unique identifier of the listing
     * @param newPrice New price in wei
     */
    event ListingUpdated(uint256 indexed listingId, uint256 newPrice);

    /**
     * @notice Emitted when an NFT is sold
     * @param listingId Unique identifier of the listing
     * @param seller Address of the seller
     * @param buyer Address of the buyer
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID that was sold
     * @param price Sale price in wei
     */
    event Sale(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        address nftContract,
        uint256 tokenId,
        uint256 price
    );

    /**
     * @notice Emitted when an offer is made on an NFT
     * @param offerId Unique identifier for the offer
     * @param buyer Address making the offer
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID the offer is for
     * @param amount Offer amount in wei
     * @param expiresAt Timestamp when offer expires
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
     * @param offerId Unique identifier of the cancelled offer
     */
    event OfferCancelled(uint256 indexed offerId);

    /**
     * @notice Emitted when an offer is accepted
     * @param offerId Unique identifier of the accepted offer
     * @param seller Address of the NFT seller
     * @param buyer Address of the buyer
     * @param amount Amount paid in wei
     */
    event OfferAccepted(
        uint256 indexed offerId,
        address indexed seller,
        address indexed buyer,
        uint256 amount
    );

    /**
     * @notice Emitted when marketplace fee is updated
     * @param oldFee Previous fee in basis points
     * @param newFee New fee in basis points
     */
    event MarketplaceFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @notice Emitted when fee recipient is updated
     * @param oldRecipient Previous fee recipient address
     * @param newRecipient New fee recipient address
     */
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    /**
     * @notice Emitted when an NFT is traded
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID that was traded
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
     * @notice Emitted when royalty is paid to creator
     * @param listingId Listing ID for the sale
     * @param royaltyRecipient Address receiving royalty
     * @param amount Royalty amount in wei
     */
    event RoyaltyPaid(
        uint256 indexed listingId,
        address indexed royaltyRecipient,
        uint256 amount
    );

    /**
     * @notice Emitted when excess payment is refunded
     * @param recipient Address receiving the refund
     * @param amount Refund amount in wei
     */
    event RefundIssued(address indexed recipient, uint256 amount);

    /**
     * @notice Emitted when admin transfer is initiated (step 1 of two-step transfer)
     * @param currentAdmin Address of the current admin initiating the transfer
     * @param pendingAdmin Address of the new admin who must accept
     */
    event AdminTransferInitiated(address indexed currentAdmin, address indexed pendingAdmin);

    /**
     * @notice Emitted when admin transfer is completed (step 2 of two-step transfer)
     * @param oldAdmin Address of the previous admin
     * @param newAdmin Address of the new admin
     */
    event AdminTransferCompleted(address indexed oldAdmin, address indexed newAdmin);

    /**
     * @notice Emitted when a pending admin transfer is cancelled
     * @param currentAdmin Address of the admin who cancelled
     * @param cancelledPending Address of the cancelled pending admin
     */
    event AdminTransferCancelled(address indexed currentAdmin, address indexed cancelledPending);

    // =============================================================================
    // LISTING FUNCTIONS
    // =============================================================================

    /**
     * @notice List an NFT for sale on the marketplace
     * @dev Requires marketplace to be approved for NFT transfer
     * @param nftContract NFT contract address (must support ERC721)
     * @param tokenId Token ID to list
     * @param price Listing price in wei (must be > 0)
     * @param imageURI IPFS URI for card image display
     * @return listingId Unique identifier for the created listing
     */
    function listNFT(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        string calldata imageURI
    ) external returns (uint256 listingId);

    /**
     * @notice Cancel an active listing
     * @dev Only seller can cancel after MIN_LISTING_DURATION
     * @param listingId Listing ID to cancel
     */
    function cancelListing(uint256 listingId) external;

    /**
     * @notice Update the price of an active listing
     * @dev Only seller can update their listing
     * @param listingId Listing ID to update
     * @param newPrice New price in wei (must be > 0)
     */
    function updateListing(uint256 listingId, uint256 newPrice) external;

    /**
     * @notice Purchase a listed NFT
     * @dev Handles fees, royalties, and excess refunds
     * @param listingId Listing ID to purchase
     */
    function buyNFT(uint256 listingId) external payable;

    // =============================================================================
    // OFFER FUNCTIONS
    // =============================================================================

    /**
     * @notice Make an offer on an NFT
     * @dev Offer amount held in escrow until accepted/cancelled/expired
     * @param nftContract NFT contract address
     * @param tokenId Token ID to make offer on
     * @param duration Offer duration in seconds (1 hour - 30 days)
     * @return offerId Unique identifier for the created offer
     */
    function makeOffer(
        address nftContract,
        uint256 tokenId,
        uint256 duration
    ) external payable returns (uint256 offerId);

    /**
     * @notice Cancel an offer and receive refund
     * @dev Only offer maker can cancel
     * @param offerId Offer ID to cancel
     */
    function cancelOffer(uint256 offerId) external;

    /**
     * @notice Accept an offer (by NFT owner)
     * @dev NFT owner must have approved marketplace
     * @param offerId Offer ID to accept
     */
    function acceptOffer(uint256 offerId) external;

    /**
     * @notice Withdraw expired offer funds
     * @dev Only offer maker can withdraw after expiration
     * @param offerId Offer ID to withdraw
     */
    function withdrawExpiredOffer(uint256 offerId) external;

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get listing details
     * @param listingId Listing ID to query
     * @return Listing struct with all listing data
     */
    function getListing(uint256 listingId) external view returns (Listing memory);

    /**
     * @notice Get offer details
     * @param offerId Offer ID to query
     * @return Offer struct with all offer data
     */
    function getOffer(uint256 offerId) external view returns (Offer memory);

    /**
     * @notice Get active listing ID for an NFT
     * @param nftContract NFT contract address
     * @param tokenId Token ID to query
     * @return listingId Active listing ID (0 if none)
     */
    function getActiveListingId(address nftContract, uint256 tokenId) external view returns (uint256 listingId);

    /**
     * @notice Get all listing IDs for a seller
     * @param seller Seller address to query
     * @return Array of listing IDs
     */
    function getSellerListings(address seller) external view returns (uint256[] memory);

    /**
     * @notice Get all offer IDs for a buyer
     * @param buyer Buyer address to query
     * @return Array of offer IDs
     */
    function getBuyerOffers(address buyer) external view returns (uint256[] memory);

    /**
     * @notice Get NFT trading statistics
     * @param nftContract NFT contract address
     * @param tokenId Token ID to query
     * @return NFTStats struct with trading history
     */
    function getNFTStats(address nftContract, uint256 tokenId) external view returns (NFTStats memory);

    /**
     * @notice Get total number of listings ever created
     * @return Total listing count
     */
    function totalListings() external view returns (uint256);

    /**
     * @notice Get the pending admin address for two-step transfer
     * @return Address of pending admin (zero if no pending transfer)
     */
    function pendingAdmin() external view returns (address);

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Set PokeDEXCard contract reference
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param pokeDEXCard Address of PokeDEXCard contract
     */
    function setPokeDEXCard(address pokeDEXCard) external;

    /**
     * @notice Set marketplace fee
     * @dev Only callable by FEE_MANAGER_ROLE
     * @dev Maximum fee is 10% (1000 basis points)
     * @param newFee New fee in basis points
     */
    function setMarketplaceFee(uint256 newFee) external;

    /**
     * @notice Set fee recipient address
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external;

    /**
     * @notice Pause marketplace operations
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function pause() external;

    /**
     * @notice Unpause marketplace operations
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function unpause() external;

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER FUNCTIONS
    // =============================================================================

    /**
     * @notice Initiates admin transfer to a new address (step 1)
     * @dev Only callable by current admin
     * @dev The new admin must call acceptAdminTransfer() to complete the transfer
     * @param newAdmin The address to transfer admin role to (cannot be zero or current admin)
     */
    function initiateAdminTransfer(address newAdmin) external;

    /**
     * @notice Completes admin transfer (step 2)
     * @dev Must be called by the pending admin address
     * @dev Grants DEFAULT_ADMIN_ROLE to pending admin and revokes from initiating admin
     */
    function acceptAdminTransfer() external;

    /**
     * @notice Cancels a pending admin transfer
     * @dev Only callable by current admin
     * @dev Resets pending admin to zero address
     */
    function cancelAdminTransfer() external;
}
