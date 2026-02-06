// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPokeDEXCard
 * @author PokeDEX Team
 * @notice Interface for the PokeDEX NFT Card contract
 * @dev ERC-721 NFT contract interface for Pokemon trading cards with built-in stats tracking
 */
interface IPokeDEXCard {
    // =============================================================================
    // ENUMS
    // =============================================================================

    /// @notice Pokemon types enum representing all 18 types
    enum PokemonType {
        Normal,
        Fire,
        Water,
        Electric,
        Grass,
        Ice,
        Fighting,
        Poison,
        Ground,
        Flying,
        Psychic,
        Bug,
        Rock,
        Ghost,
        Dragon,
        Dark,
        Steel,
        Fairy
    }

    /// @notice Card rarity levels from common to legendary
    enum Rarity {
        Common,
        Uncommon,
        Rare,
        UltraRare,
        Legendary
    }

    // =============================================================================
    // STRUCTS
    // =============================================================================

    /// @notice Card stats structure containing all battle-relevant statistics
    /// @dev Packed for storage efficiency
    struct CardStats {
        uint16 hp;
        uint16 attack;
        uint16 defense;
        uint16 speed;
        PokemonType pokemonType;
        Rarity rarity;
        uint8 generation;
        uint32 experience;
    }

    /// @notice Extended card metrics for battle calculations including trade history
    struct CardMetrics {
        CardStats baseStats;
        uint32 tradeCount;
        uint256 holderDays;
        uint256 lastSalePrice;
        bool isVeteranCard;
    }

    // =============================================================================
    // EVENTS
    // =============================================================================

    /**
     * @notice Emitted when a new card is minted
     * @param tokenId The unique identifier of the minted card
     * @param owner The address that received the card
     * @param pokemonType The Pokemon type of the card
     * @param rarity The rarity level of the card
     */
    event CardMinted(
        uint256 indexed tokenId,
        address indexed owner,
        PokemonType pokemonType,
        Rarity rarity
    );

    /**
     * @notice Emitted when card stats are updated (experience gained)
     * @param tokenId The unique identifier of the card
     * @param newExperience The new total experience value
     */
    event CardStatsUpdated(uint256 indexed tokenId, uint32 newExperience);

    /**
     * @notice Emitted when a card is transferred (for trade tracking)
     * @param tokenId The unique identifier of the card
     * @param from The address transferring the card
     * @param to The address receiving the card
     * @param tradeCount The new total trade count for this card
     */
    event CardTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        uint32 tradeCount
    );

    // =============================================================================
    // EXTERNAL FUNCTIONS
    // =============================================================================

    /**
     * @notice Mint a new Pokemon card
     * @dev Only callable by addresses with MINTER_ROLE
     * @param to Recipient address
     * @param tokenURI Token metadata URI (IPFS or other)
     * @param stats Card statistics structure
     * @return tokenId The minted token ID
     */
    function mintCard(
        address to,
        string calldata tokenURI,
        CardStats calldata stats
    ) external returns (uint256 tokenId);

    /**
     * @notice Batch mint multiple cards in a single transaction
     * @dev Only callable by addresses with MINTER_ROLE
     * @dev Maximum batch size is 20 cards
     * @param to Recipient address
     * @param uris Array of token URIs
     * @param statsArray Array of card stats
     * @return tokenIds Array of minted token IDs
     */
    function batchMintCards(
        address to,
        string[] calldata uris,
        CardStats[] calldata statsArray
    ) external returns (uint256[] memory tokenIds);

    /**
     * @notice Add experience to a card
     * @dev Only callable by addresses with STATS_UPDATER_ROLE
     * @param tokenId Token ID to update
     * @param expAmount Experience points to add
     */
    function addExperience(uint256 tokenId, uint32 expAmount) external;

    /**
     * @notice Set last sale price (called by marketplace after sale)
     * @dev Only callable by addresses with MARKETPLACE_ROLE
     * @param tokenId Token ID to update
     * @param price Sale price in wei
     */
    function setLastSalePrice(uint256 tokenId, uint256 price) external;

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get card stats for a token
     * @param tokenId Token ID to query
     * @return CardStats struct with all card data
     */
    function getCardStats(uint256 tokenId) external view returns (CardStats memory);

    /**
     * @notice Get extended card metrics for battle calculations
     * @param tokenId Token ID to query
     * @return CardMetrics struct with trade history and holding bonus data
     */
    function getCardMetrics(uint256 tokenId) external view returns (CardMetrics memory);

    /**
     * @notice Get trade count for a card
     * @param tokenId Token ID to query
     * @return Number of times the card has been traded
     */
    function getTradeCount(uint256 tokenId) external view returns (uint32);

    /**
     * @notice Calculate the battle power of a card based on its stats and rarity
     * @dev Battle power formula: weighted sum of stats with rarity multiplier and experience bonus
     * @param tokenId Token ID to calculate battle power for
     * @return battlePower The calculated battle power value (higher is stronger)
     
    function calculateBattlePower(uint256 tokenId) external view returns (uint256 battlePower);
*/
    /**
     * @notice Calculate battle power including trade metrics and holding bonuses
     * @dev Extends base battle power with trade count bonus, veteran bonus, and price weight
     * @param tokenId Token ID to calculate enhanced battle power for
     * @return enhancedPower Battle power including all metric-based bonuses
     
    function calculateBattlePowerWithMetrics(uint256 tokenId) external view returns (uint256 enhancedPower);
*/
    /**
     * @notice Get total number of cards minted
     * @dev This is a simple counter and does not account for burned tokens
     * @return supply Total number of tokens ever minted
     */
    function totalSupply() external view returns (uint256 supply);

    /**
     * @notice Get all token IDs owned by an address
     * @dev Used by frontend/bot to display user's card collection
     * @param owner Address to query
     * @return Array of token IDs owned by the address
     */
    function tokensOfOwner(address owner) external view returns (uint256[] memory);

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Pause all minting and stat update operations
     * @dev Only callable by accounts with DEFAULT_ADMIN_ROLE
     * @dev Transfers still work when paused
     */
    function pause() external;

    /**
     * @notice Unpause all contract operations
     * @dev Only callable by accounts with DEFAULT_ADMIN_ROLE
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
