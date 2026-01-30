// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICardPack
 * @dev Interface for the Card Pack contract with VRF randomness
 */
interface ICardPack {
    /// @notice Pack types available for purchase
    enum PackType {
        Basic,      // 3 cards
        Premium,    // 5 cards
        Legendary   // 10 cards
    }

    /// @notice Pack purchase request structure
    struct PackRequest {
        address buyer;
        PackType packType;
        uint256 requestId;
        bool fulfilled;
        uint256 pendingIndex;  // Index in userPendingRequests for O(1) removal
        uint256[] cardIds;
    }

    /// @notice Emitted when a pack is purchased
    event PackPurchased(
        uint256 indexed requestId,
        address indexed buyer,
        PackType packType
    );

    /// @notice Emitted when pack is opened (VRF fulfilled)
    event PackOpened(
        uint256 indexed requestId,
        address indexed buyer,
        uint256[] cardIds
    );

    /// @notice Purchase a card pack
    function purchasePack(PackType packType) external payable returns (uint256 requestId);

    /// @notice Get pack price
    function getPackPrice(PackType packType) external view returns (uint256);

    /// @notice Get pack request details
    function getPackRequest(uint256 requestId) external view returns (PackRequest memory);
}
