// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPokeDEXCard
 * @dev Interface for the PokeDEX NFT Card contract
 */
interface IPokeDEXCard {
    /// @notice Pokemon types enum
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

    /// @notice Card rarity levels
    enum Rarity {
        Common,
        Uncommon,
        Rare,
        UltraRare,
        Legendary
    }

    /// @notice Card stats structure
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

    /// @notice Extended card metrics for battle calculations
    struct CardMetrics {
        CardStats baseStats;
        uint32 tradeCount;
        uint256 holderDays;
        uint256 lastSalePrice;
        bool isVeteranCard;
    }

    /// @notice Emitted when a new card is minted
    event CardMinted(
        uint256 indexed tokenId,
        address indexed owner,
        PokemonType pokemonType,
        Rarity rarity
    );

    /// @notice Emitted when card stats are updated
    event CardStatsUpdated(uint256 indexed tokenId, uint32 newExperience);

    /// @notice Emitted when a card is transferred (for trade tracking)
    event CardTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        uint32 tradeCount
    );

    /// @notice Get card stats by token ID
    function getCardStats(uint256 tokenId) external view returns (CardStats memory);

    /// @notice Mint a new card
    function mintCard(
        address to,
        string calldata tokenURI,
        CardStats calldata stats
    ) external returns (uint256);

    /// @notice Add experience to a card
    function addExperience(uint256 tokenId, uint32 expAmount) external;

    /// @notice Get extended card metrics for battle formula
    function getCardMetrics(uint256 tokenId) external view returns (CardMetrics memory);

    /// @notice Get trade count for a card
    function getTradeCount(uint256 tokenId) external view returns (uint32);

    /// @notice Set last sale price (called by marketplace)
    function setLastSalePrice(uint256 tokenId, uint256 price) external;
}
