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

    /// @notice Emitted when a new card is minted
    event CardMinted(
        uint256 indexed tokenId,
        address indexed owner,
        PokemonType pokemonType,
        Rarity rarity
    );

    /// @notice Emitted when card stats are updated
    event CardStatsUpdated(uint256 indexed tokenId, uint32 newExperience);

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
}
