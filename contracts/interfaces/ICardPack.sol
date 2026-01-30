// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IPokeDEXCard.sol";

/**
 * @title ICardPack
 * @author PokeDEX Team
 * @notice Interface for the Card Pack contract with API3 QRNG randomness
 * @dev Card packs use quantum random number generation for fair card distribution
 */
interface ICardPack {
    // =============================================================================
    // ENUMS
    // =============================================================================

    /// @notice Pack types available for purchase
    enum PackType {
        Basic,      // 3 cards - lowest price
        Premium,    // 5 cards - medium price
        Legendary   // 10 cards - highest price, best odds
    }

    // =============================================================================
    // STRUCTS
    // =============================================================================

    /// @notice Pack purchase request structure
    /// @dev Used to track pending and fulfilled pack purchases
    struct PackRequest {
        address buyer;
        PackType packType;
        uint256 requestId;
        bool fulfilled;
        uint256 pendingIndex;  // Index in userPendingRequests for O(1) removal
        uint256[] cardIds;
    }

    // =============================================================================
    // EVENTS
    // =============================================================================

    /**
     * @notice Emitted when a pack is purchased
     * @param requestId QRNG request ID for tracking
     * @param buyer Address of the pack purchaser
     * @param packType Type of pack purchased
     */
    event PackPurchased(
        uint256 indexed requestId,
        address indexed buyer,
        PackType packType
    );

    /**
     * @notice Emitted when pack is opened (QRNG fulfilled)
     * @param requestId QRNG request ID
     * @param buyer Address of the pack owner
     * @param cardIds Array of minted card token IDs
     */
    event PackOpened(
        uint256 indexed requestId,
        address indexed buyer,
        uint256[] cardIds
    );

    /**
     * @notice Emitted when QRNG parameters are configured
     * @param airnode API3 QRNG Airnode address
     * @param endpointId Endpoint ID for random number requests
     * @param sponsorWallet Sponsor wallet address
     */
    event QRNGConfigured(
        address airnode,
        bytes32 endpointId,
        address sponsorWallet
    );

    /**
     * @notice Emitted when a timed-out request is refunded
     * @param requestId The QRNG request ID
     * @param user Address receiving the refund
     * @param amount Amount refunded
     */
    event RequestRefunded(
        bytes32 indexed requestId,
        address indexed user,
        uint256 amount
    );

    /**
     * @notice Emitted when a request times out without fulfillment
     * @param requestId The QRNG request ID that timed out
     */
    event RequestTimedOut(bytes32 indexed requestId);

    // =============================================================================
    // EXTERNAL FUNCTIONS
    // =============================================================================

    /**
     * @notice Purchase a card pack
     * @dev Requires payment equal to or greater than pack price
     * @dev Excess payment is refunded
     * @param packType Type of pack to purchase (Basic, Premium, or Legendary)
     * @return requestId QRNG request ID for tracking the purchase
     */
    function purchasePack(PackType packType) external payable returns (uint256 requestId);

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get pack price for a specific pack type
     * @param packType Type of pack to query
     * @return price Price in wei
     */
    function getPackPrice(PackType packType) external view returns (uint256 price);

    /**
     * @notice Get pack request details
     * @param requestId Request ID to query
     * @return PackRequest struct with purchase details
     */
    function getPackRequest(uint256 requestId) external view returns (PackRequest memory);

    /**
     * @notice Get user's pending pack requests
     * @param user User address to query
     * @return Array of pending request IDs (as bytes32)
     */
    function getUserPendingRequests(address user) external view returns (bytes32[] memory);

    /**
     * @notice Check if a request has timed out and is eligible for refund
     * @param requestId The request ID to check
     * @return isTimedOut Whether the request has timed out
     * @return timeRemaining Seconds until timeout (0 if already timed out)
     */
    function isRequestTimedOut(bytes32 requestId) external view returns (bool isTimedOut, uint256 timeRemaining);

    // =============================================================================
    // REFUND FUNCTIONS
    // =============================================================================

    /**
     * @notice Refund a timed-out QRNG request
     * @dev Allows users to reclaim ETH if QRNG fails to respond within timeout period
     * @dev Can be called by anyone (but funds go to original requester)
     * @param requestId The request ID to refund
     */
    function refundTimedOutRequest(bytes32 requestId) external;

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Configure QRNG parameters for API3 Airnode
     * @dev Only callable by CONFIG_ROLE
     * @param airnode API3 QRNG Airnode address
     * @param endpointIdUint256Array Endpoint ID for uint256[] requests
     * @param sponsorWallet Sponsor wallet address
     */
    function setQRNGParameters(
        address airnode,
        bytes32 endpointIdUint256Array,
        address sponsorWallet
    ) external;

    /**
     * @notice Set pack price for a specific type
     * @dev Only callable by CONFIG_ROLE
     * @param packType Type of pack to update
     * @param price New price in wei
     */
    function setPackPrice(PackType packType, uint256 price) external;

    /**
     * @notice Set base URI for card metadata by rarity
     * @dev Only callable by CONFIG_ROLE
     * @param rarity Rarity level to set URI for
     * @param baseURI Base URI for metadata (card number and .json appended)
     */
    function setRarityBaseURI(IPokeDEXCard.Rarity rarity, string calldata baseURI) external;

    /**
     * @notice Withdraw contract balance
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param to Address to send funds to
     */
    function withdraw(address to) external;

    /**
     * @notice Pause contract operations
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function pause() external;

    /**
     * @notice Unpause contract operations
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function unpause() external;

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER
    // =============================================================================

    /// @notice Emitted when admin transfer is initiated
    event AdminTransferInitiated(address indexed currentAdmin, address indexed pendingAdmin);

    /// @notice Emitted when admin transfer is completed
    event AdminTransferCompleted(address indexed oldAdmin, address indexed newAdmin);

    /// @notice Emitted when admin transfer is cancelled
    event AdminTransferCancelled(address indexed currentAdmin, address indexed cancelledPending);

    /**
     * @notice Initiates admin transfer to a new address (step 1)
     * @dev Only callable by current admin. The new admin must call acceptAdminTransfer() to complete.
     * @param newAdmin The address to transfer admin role to
     */
    function initiateAdminTransfer(address newAdmin) external;

    /**
     * @notice Completes admin transfer (step 2) - must be called by pending admin
     * @dev Grants DEFAULT_ADMIN_ROLE to pending admin and revokes from the initiating admin
     */
    function acceptAdminTransfer() external;

    /**
     * @notice Cancels pending admin transfer
     * @dev Only callable by current admin
     */
    function cancelAdminTransfer() external;

    /**
     * @notice Get pending admin address
     * @return The address of the pending admin, or zero address if none
     */
    function pendingAdmin() external view returns (address);
}
