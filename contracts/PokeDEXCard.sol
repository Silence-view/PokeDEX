// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IPokeDEXCard.sol";

/**
 * @title PokeDEXCard
 * @author PokeDEX Team
 * @dev ERC-721 NFT contract for Pokemon trading cards with built-in stats tracking
 * @notice Main NFT contract for Pokemon cards with battle stats, trade history, and experience system
 * @custom:security-contact security@pokedex.example
 */
contract PokeDEXCard is
    ERC721,
    ERC721URIStorage,
    AccessControl,
    ReentrancyGuard,
    Pausable,
    IPokeDEXCard
{
    /// @notice Role for minting new cards
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role for updating card stats (battle arena)
    bytes32 public constant STATS_UPDATER_ROLE = keccak256("STATS_UPDATER_ROLE");

    /// @notice Role for marketplace to set sale prices
    bytes32 public constant MARKETPLACE_ROLE = keccak256("MARKETPLACE_ROLE");

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER
    // =============================================================================

    /// @notice Address of pending admin for two-step transfer
    address public pendingAdmin;

    /// @notice Address of current admin who initiated the transfer
    address private _transferInitiator;

    // Note: Admin transfer events are inherited from IPokeDEXCard interface

    /// @notice Counter for token IDs
    uint256 private _tokenIdCounter;

    /// @notice Mapping from token ID to card stats
    mapping(uint256 => CardStats) private _cardStats;

    /// @notice Trade count per token (incremented on each transfer)
    mapping(uint256 => uint32) private _tradeCount;

    /// @notice Maximum trade count to prevent overflow (uint32 max - 1 for safety margin)
    uint32 public constant MAX_TRADE_COUNT = type(uint32).max - 1;

    /// @notice Timestamp when card was acquired by current owner
    mapping(uint256 => uint48) private _acquiredAt;

    /// @notice Timestamp of last transfer
    mapping(uint256 => uint48) private _lastTransferAt;

    /// @notice Last sale price in wei (set by marketplace)
    mapping(uint256 => uint256) private _lastSalePrice;

    /// @notice Mapping from owner to list of owned token IDs (for enumeration)
    mapping(address => uint256[]) private _ownedTokens;

    /// @notice Mapping from token ID to index in owner's token list
    mapping(uint256 => uint256) private _ownedTokensIndex;

    /// @notice Maximum stats values
    uint16 public constant MAX_STAT = 255;
    uint32 public constant MAX_EXPERIENCE = 1000000;

    /**
     * @notice Contract constructor
     * @param admin Address to receive admin role
     */
    constructor(address admin) ERC721("PokeDEX Card", "PDEX") {
        require(admin != address(0), "Invalid admin address");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(STATS_UPDATER_ROLE, admin);
    }

    /**
     * @notice Mint a new Pokemon card
     * @param to Recipient address
     * @param uri Token metadata URI
     * @param stats Card statistics
     * @return tokenId The minted token ID
     */
    function mintCard(
        address to,
        string calldata uri,
        CardStats calldata stats
    )
        external
        override
        onlyRole(MINTER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        require(to != address(0), "Cannot mint to zero address");
        require(bytes(uri).length > 0, "URI cannot be empty");
        _validateStats(stats);

        uint256 tokenId = ++_tokenIdCounter;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        _cardStats[tokenId] = stats;

        emit CardMinted(tokenId, to, stats.pokemonType, stats.rarity);

        return tokenId;
    }

    /**
     * @notice Batch mint multiple cards
     * @param to Recipient address
     * @param uris Array of token URIs
     * @param statsArray Array of card stats
     * @return tokenIds Array of minted token IDs
     */
    function batchMintCards(
        address to,
        string[] calldata uris,
        CardStats[] calldata statsArray
    )
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256[] memory)
    {
        require(to != address(0), "Cannot mint to zero address");
        require(uris.length == statsArray.length, "Arrays length mismatch");
        require(uris.length > 0 && uris.length <= 20, "Invalid batch size");

        uint256[] memory tokenIds = new uint256[](uris.length);

        for (uint256 i = 0; i < uris.length; i++) {
            require(bytes(uris[i]).length > 0, "URI cannot be empty");
            _validateStats(statsArray[i]);

            uint256 tokenId = ++_tokenIdCounter;

            _safeMint(to, tokenId);
            _setTokenURI(tokenId, uris[i]);
            _cardStats[tokenId] = statsArray[i];

            tokenIds[i] = tokenId;

            emit CardMinted(tokenId, to, statsArray[i].pokemonType, statsArray[i].rarity);
        }

        return tokenIds;
    }

    /**
     * @notice Get card stats for a token
     * @param tokenId Token ID to query
     * @return CardStats struct with all card data
     */
    function getCardStats(uint256 tokenId)
        external
        view
        override
        returns (CardStats memory)
    {
        _requireOwned(tokenId);
        return _cardStats[tokenId];
    }

    /**
     * @notice Add experience to a card
     * @param tokenId Token ID to update
     * @param expAmount Experience points to add
     */
    function addExperience(uint256 tokenId, uint32 expAmount)
        external
        override
        onlyRole(STATS_UPDATER_ROLE)
        nonReentrant
        whenNotPaused
    {
        _requireOwned(tokenId);

        CardStats storage card = _cardStats[tokenId];
        // Use uint256 to prevent overflow before capping
        uint256 newExp = uint256(card.experience) + uint256(expAmount);

        // Cap at max experience (safe cast after comparison)
        card.experience = newExp > MAX_EXPERIENCE ? MAX_EXPERIENCE : uint32(newExp);

        emit CardStatsUpdated(tokenId, card.experience);
    }

    
    /**
     * @notice Calculate the battle power of a card based on its stats and rarity
     * @dev Battle power formula: weighted sum of stats with rarity multiplier and experience bonus
     * @param tokenId Token ID to calculate battle power for
     * @return battlePower The calculated battle power value (higher is stronger)
     
    function calculateBattlePower(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        CardStats memory stats = _cardStats[tokenId];

        // Battle power formula: weighted sum of stats with rarity multiplier
        uint256 basePower = (uint256(stats.hp) * 2) +
                           (uint256(stats.attack) * 3) +
                           (uint256(stats.defense) * 2) +
                           (uint256(stats.speed) * 3);

        // Rarity multipliers: Common=100, Uncommon=120, Rare=150, UltraRare=200, Legendary=300
        uint256 rarityMultiplier = _getRarityMultiplier(stats.rarity);

        // Experience bonus (up to 50% at max exp) - improved precision
        // Formula: basePower * rarityMultiplier * (100 + expBonus) / 10000
        // Where expBonus = (experience * 50) / MAX_EXPERIENCE
        // Refactored to: basePower * rarityMultiplier * (100 * MAX_EXPERIENCE + experience * 50) / (10000 * MAX_EXPERIENCE)
        uint256 maxExp = uint256(MAX_EXPERIENCE);
        uint256 expScaled = uint256(stats.experience) * 50;
        uint256 baseScaled = 100 * maxExp;

        return (basePower * rarityMultiplier * (baseScaled + expScaled)) / (10000 * maxExp);
    }
    */

    /**
     * @notice Get total number of cards minted
     * @dev This is a simple counter and does not account for burned tokens
     * @return supply Total number of tokens ever minted
     */
    function totalSupply() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @notice Get all token IDs owned by an address
     * @dev Used by frontend/bot to display user's card collection
     * @param owner Address to query
     * @return Array of token IDs owned by the address
     */
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    /**
     * @notice Pause all minting and stat update operations
     * @dev Only callable by accounts with DEFAULT_ADMIN_ROLE. Transfers still work when paused.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause all contract operations
     * @dev Only callable by accounts with DEFAULT_ADMIN_ROLE
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

    // The following functions are overrides required by Solidity.

    /**
     * @notice Returns URI of a Token
     * @param tokenId Token Identifier
     * @return The URI of the Token
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    /**
     * @notice Check if contract supports an interface
     * @param interfaceId Interface identifier
     * @return True if supported
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @notice Get extended card metrics for battle calculations
     * @param tokenId Token ID to query
     * @return CardMetrics struct with trade history
     */
    function getCardMetrics(uint256 tokenId)
        external
        view
        override
        returns (CardMetrics memory)
    {
        _requireOwned(tokenId);

        CardStats memory stats = _cardStats[tokenId];
        uint256 acquiredTime = uint256(_acquiredAt[tokenId]);
        uint256 holderDays = acquiredTime > 0
            ? (block.timestamp - acquiredTime) / 1 days
            : 0;

        return CardMetrics({
            baseStats: stats,
            tradeCount: _tradeCount[tokenId],
            holderDays: holderDays,
            lastSalePrice: _lastSalePrice[tokenId],
            isVeteranCard: holderDays > 30
        });
    }

    /**
     * @notice Get trade count for a card
     * @param tokenId Token ID to query
     * @return Number of times the card has been traded
     */
    function getTradeCount(uint256 tokenId) external view override returns (uint32) {
        _requireOwned(tokenId);
        return _tradeCount[tokenId];
    }

    /**
     * @notice Set last sale price (called by marketplace after sale)
     * @param tokenId Token ID to update
     * @param price Sale price in wei
     */
    function setLastSalePrice(uint256 tokenId, uint256 price)
        external
        override
        onlyRole(MARKETPLACE_ROLE)
    {
        _requireOwned(tokenId);
        _lastSalePrice[tokenId] = price;
    }

    /*
    struct BattlePowerWithMetrics {
        uint256 basePower;
        uint256 rarityMultiplier;
        uint256 maxExp;
        uint256 expScaled;
        uint256 baseScaled;
        uint256 powerWithExp;
        uint32 trades;
        uint256 tradeBonus;
        uint256 acquiredTime;
        uint256 holderDays;
        uint256 veteranBonus;
        uint256 rawPriceBonus;
        uint256 priceBonus;
    }
    */
    /**
     * @notice Calculate battle power including trade metrics and holding bonuses
     * @dev Extends base battle power with trade count bonus, veteran bonus, and price weight
     * @param tokenId Token ID to calculate enhanced battle power for
     * @return enhancedPower Battle power including all metric-based bonuses
     
    function calculateBattlePowerWithMetrics(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);

        // Get base battle power
        CardStats memory stats = _cardStats[tokenId];
        BattlePowerWithMetrics memory metrics;
        metrics.basePower = (uint256(stats.hp) * 2) +
                           (uint256(stats.attack) * 3) +
                           (uint256(stats.defense) * 2) +
                           (uint256(stats.speed) * 3);

        metrics.rarityMultiplier = _getRarityMultiplier(stats.rarity);

        // Experience bonus
        metrics.maxExp = uint256(MAX_EXPERIENCE);
        metrics.expScaled = uint256(stats.experience) * 50;
        metrics.baseScaled = 100 * metrics.maxExp;
        metrics.powerWithExp = (metrics.basePower * metrics.rarityMultiplier * (metrics.baseScaled + metrics.expScaled)) / (10000 * metrics.maxExp);

        // Trade count bonus: +0.5% per trade, max 25%
        metrics.trades = _tradeCount[tokenId];
        metrics.tradeBonus = metrics.trades > 0
            ? (metrics.powerWithExp * _min(uint256(metrics.trades) * 5, 250)) / 1000
            : 0;

        // Veteran bonus: +10% if held > 30 days
        metrics.acquiredTime = uint256(_acquiredAt[tokenId]);
        metrics.holderDays = metrics.acquiredTime > 0 ? (block.timestamp - metrics.acquiredTime) / 1 days : 0;
        metrics.veteranBonus = metrics.holderDays > 30 ? (metrics.powerWithExp * 10) / 100 : 0;

        // Price weight: +1 power per 0.01 ETH of last sale price
        // Capped at 100 (equivalent to 1 ETH) to prevent wash trading exploitation
        metrics.rawPriceBonus = _lastSalePrice[tokenId] / 0.01 ether;
        metrics.priceBonus = metrics.rawPriceBonus > 100 ? 100 : metrics.rawPriceBonus;

        return metrics.powerWithExp + metrics.tradeBonus + metrics.veteranBonus + metrics.priceBonus;
    }*/

    /**
     * @dev Override _update to track transfers for trade metrics and ownership enumeration
     * @param to Address receiving the token
     * @param tokenId Token being transferred
     * @param auth Address authorized for the transfer
     * @return from The previous owner address
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Update ownership enumeration
        if (from != address(0)) {
            _removeTokenFromOwnerEnumeration(from, tokenId);
        }
        if (to != address(0)) {
            _addTokenToOwnerEnumeration(to, tokenId);
        }

        // Track transfers (not mints or burns)
        if (from != address(0) && to != address(0) && from != to) {
            // Overflow protection for trade count
            uint32 currentTradeCount = _tradeCount[tokenId];
            if (currentTradeCount < MAX_TRADE_COUNT) {
                // Safe to increment - no overflow possible
                unchecked {
                    _tradeCount[tokenId] = currentTradeCount + 1;
                }
            }
            // If at max, trade count stays at max (no revert to allow transfers)

            _lastTransferAt[tokenId] = uint48(block.timestamp);
            _acquiredAt[tokenId] = uint48(block.timestamp);

            emit CardTransferred(tokenId, from, to, _tradeCount[tokenId]);
        }

        // Track acquisition time on mint
        if (from == address(0) && to != address(0)) {
            _acquiredAt[tokenId] = uint48(block.timestamp);
            _lastTransferAt[tokenId] = uint48(block.timestamp);
        }

        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Helper function for minimum of two values
     * @param a First value to compare
     * @param b Second value to compare
     * @return minimum The smaller of the two values
     */
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @dev Add token to owner's enumeration list
     * @param to Address receiving the token
     * @param tokenId Token being added
     */
    function _addTokenToOwnerEnumeration(address to, uint256 tokenId) private {
        _ownedTokensIndex[tokenId] = _ownedTokens[to].length;
        _ownedTokens[to].push(tokenId);
    }

    /**
     * @dev Remove token from owner's enumeration list using swap-and-pop
     * @param from Address losing the token
     * @param tokenId Token being removed
     */
    function _removeTokenFromOwnerEnumeration(address from, uint256 tokenId) private {
        uint256 lastTokenIndex = _ownedTokens[from].length - 1;
        uint256 tokenIndex = _ownedTokensIndex[tokenId];

        // If not last token, swap with last
        if (tokenIndex != lastTokenIndex) {
            uint256 lastTokenId = _ownedTokens[from][lastTokenIndex];
            _ownedTokens[from][tokenIndex] = lastTokenId;
            _ownedTokensIndex[lastTokenId] = tokenIndex;
        }

        // Remove last element
        _ownedTokens[from].pop();
        delete _ownedTokensIndex[tokenId];
    }

    /**
     * @dev Validate card stats are within bounds
     * @param stats Stats to validate
     */
    function _validateStats(CardStats calldata stats) internal pure {
        require(stats.hp > 0 && stats.hp <= MAX_STAT, "Invalid HP");
        require(stats.attack <= MAX_STAT, "Invalid attack");
        require(stats.defense <= MAX_STAT, "Invalid defense");
        require(stats.speed <= MAX_STAT, "Invalid speed");
        require(stats.generation > 0 && stats.generation <= 9, "Invalid generation");
    }

    /**
     * @dev Get rarity multiplier for battle power calculation
     * @param rarity Card rarity
     * @return Multiplier value (100-300)
     
    function _getRarityMultiplier(Rarity rarity) internal pure returns (uint256) {
        if (rarity == Rarity.Common) return 100;
        if (rarity == Rarity.Uncommon) return 120;
        if (rarity == Rarity.Rare) return 150;
        if (rarity == Rarity.UltraRare) return 200;
        return 300; // Legendary
    }*/

    
}
