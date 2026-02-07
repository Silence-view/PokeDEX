// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PokeDEXCustomCards
 * @dev User-created custom NFT cards with royalty support
 * @notice Allows anyone to create and sell their own Pokemon-style cards
 */
contract PokeDEXCustomCards is
    ERC721URIStorage,
    ERC2981,
    AccessControl,
    ReentrancyGuard,
    Pausable
{
    /// @notice Role for moderating content
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");

    /// @notice Counter for token IDs
    uint256 private _tokenIdCounter;

    /// @notice Minting fee in wei (to prevent spam)
    uint256 public mintingFee = 0.001 ether;

    /// @notice Maximum royalty percentage (10%)
    uint96 public constant MAX_ROYALTY = 1000; // 10% in basis points

    /// @notice Default royalty percentage for new cards
    uint96 public defaultRoyalty = 500; // 5%

    /// @notice Fee recipient address
    address public feeRecipient;

    /// @notice Custom card stats structure
    struct CustomCardStats {
        uint16 hp;
        uint16 attack;
        uint16 defense;
        uint16 speed;
        uint8 cardType;      // 0-17 for Pokemon types
        uint8 rarity;        // 0-4 for rarity levels
        address creator;     // Original creator address
        uint256 createdAt;   // Creation timestamp
        bool verified;       // Moderator verified
    }

    /// @notice Mapping from token ID to custom stats
    mapping(uint256 => CustomCardStats) public cardStats;

    /// @notice Mapping from creator to their token IDs
    mapping(address => uint256[]) public creatorCards;

    /// @notice Mapping for banned token IDs (content moderation)
    mapping(uint256 => bool) public bannedTokens;

    /// @notice Mapping from owner to list of owned token IDs (for enumeration)
    mapping(address => uint256[]) private _ownedTokens;

    /// @notice Mapping from token ID to index in owner's token list
    mapping(uint256 => uint256) private _ownedTokensIndex;

    /// @notice Events
    event CardCreated(
        uint256 indexed tokenId,
        address indexed creator,
        string metadataURI,
        uint96 royaltyPercentage
    );

    event CardVerified(uint256 indexed tokenId, address indexed moderator);

    event CardBanned(uint256 indexed tokenId, address indexed moderator, string reason);

    event CardUnbanned(uint256 indexed tokenId, address indexed moderator);

    event MintingFeeUpdated(uint256 oldFee, uint256 newFee);

    event DefaultRoyaltyUpdated(uint96 oldRoyalty, uint96 newRoyalty);

    /**
     * @notice Contract constructor
     * @param admin Admin address
     * @param _feeRecipient Address to receive minting fees
     */
    constructor(
        address admin,
        address _feeRecipient
    ) ERC721("PokeDEX Custom Cards", "PDEXC") {
        require(admin != address(0), "Invalid admin");
        require(_feeRecipient != address(0), "Invalid fee recipient");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MODERATOR_ROLE, admin);

        feeRecipient = _feeRecipient;

        // Set default royalty for contract
        _setDefaultRoyalty(_feeRecipient, defaultRoyalty);
    }

    /**
     * @notice Create a custom card
     * @param metadataURI IPFS URI for card metadata
     * @param hp Card HP stat (1-255)
     * @param attack Card attack stat (0-255)
     * @param defense Card defense stat (0-255)
     * @param speed Card speed stat (0-255)
     * @param cardType Pokemon type (0-17)
     * @param rarity Card rarity (0-4)
     * @param royaltyPercentage Royalty in basis points (0-1000, i.e., 0-10%)
     * @return tokenId The created token ID
     */
    function createCard(
        string calldata metadataURI,
        uint16 hp,
        uint16 attack,
        uint16 defense,
        uint16 speed,
        uint8 cardType,
        uint8 rarity,
        uint96 royaltyPercentage
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value >= mintingFee, "Insufficient minting fee");
        require(bytes(metadataURI).length > 0, "Empty metadata URI");
        require(hp > 0 && hp <= 255, "Invalid HP");
        require(attack <= 255, "Invalid attack");
        require(defense <= 255, "Invalid defense");
        require(speed <= 255, "Invalid speed");
        require(cardType <= 17, "Invalid card type");
        require(rarity <= 4, "Invalid rarity");
        require(royaltyPercentage <= MAX_ROYALTY, "Royalty too high");

        uint256 tokenId = ++_tokenIdCounter;

        // Mint NFT
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);

        // Set royalty for this token (creator receives royalties)
        if (royaltyPercentage > 0) {
            _setTokenRoyalty(tokenId, msg.sender, royaltyPercentage);
        }

        // Store stats
        cardStats[tokenId] = CustomCardStats({
            hp: hp,
            attack: attack,
            defense: defense,
            speed: speed,
            cardType: cardType,
            rarity: rarity,
            creator: msg.sender,
            createdAt: block.timestamp,
            verified: false
        });

        creatorCards[msg.sender].push(tokenId);

        // Transfer minting fee
        if (msg.value > 0) {
            (bool success, ) = payable(feeRecipient).call{value: mintingFee}("");
            require(success, "Fee transfer failed");

            // Refund excess
            if (msg.value > mintingFee) {
                (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - mintingFee}("");
                require(refundSuccess, "Refund failed");
            }
        }

        emit CardCreated(tokenId, msg.sender, metadataURI, royaltyPercentage);

        return tokenId;
    }

    /**
     * @notice Create a card without stats (simpler version)
     * @param metadataURI IPFS URI for card metadata
     * @param royaltyPercentage Royalty in basis points
     * @return tokenId The created token ID
     */
    function createSimpleCard(
        string calldata metadataURI,
        uint96 royaltyPercentage
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value >= mintingFee, "Insufficient minting fee");
        require(bytes(metadataURI).length > 0, "Empty metadata URI");
        require(royaltyPercentage <= MAX_ROYALTY, "Royalty too high");

        uint256 tokenId = ++_tokenIdCounter;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);

        if (royaltyPercentage > 0) {
            _setTokenRoyalty(tokenId, msg.sender, royaltyPercentage);
        }

        // Default stats for simple cards
        cardStats[tokenId] = CustomCardStats({
            hp: 100,
            attack: 50,
            defense: 50,
            speed: 50,
            cardType: 0, // Normal
            rarity: 0,   // Common
            creator: msg.sender,
            createdAt: block.timestamp,
            verified: false
        });

        creatorCards[msg.sender].push(tokenId);

        if (msg.value > 0) {
            (bool success, ) = payable(feeRecipient).call{value: mintingFee}("");
            require(success, "Fee transfer failed");

            if (msg.value > mintingFee) {
                (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - mintingFee}("");
                require(refundSuccess, "Refund failed");
            }
        }

        emit CardCreated(tokenId, msg.sender, metadataURI, royaltyPercentage);

        return tokenId;
    }

    /**
     * @notice Batch create multiple cards
     * @param metadataURIs Array of IPFS URIs
     * @param royaltyPercentage Royalty for all cards
     * @return tokenIds Array of created token IDs
     */
    function batchCreateCards(
        string[] calldata metadataURIs,
        uint96 royaltyPercentage
    ) external payable nonReentrant whenNotPaused returns (uint256[] memory) {
        uint256 count = metadataURIs.length;
        require(count > 0 && count <= 10, "Invalid batch size");
        require(msg.value >= mintingFee * count, "Insufficient minting fee");
        require(royaltyPercentage <= MAX_ROYALTY, "Royalty too high");

        uint256[] memory tokenIds = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            require(bytes(metadataURIs[i]).length > 0, "Empty metadata URI");

            uint256 tokenId = ++_tokenIdCounter;

            _safeMint(msg.sender, tokenId);
            _setTokenURI(tokenId, metadataURIs[i]);

            if (royaltyPercentage > 0) {
                _setTokenRoyalty(tokenId, msg.sender, royaltyPercentage);
            }

            cardStats[tokenId] = CustomCardStats({
                hp: 100,
                attack: 50,
                defense: 50,
                speed: 50,
                cardType: 0,
                rarity: 0,
                creator: msg.sender,
                createdAt: block.timestamp,
                verified: false
            });

            creatorCards[msg.sender].push(tokenId);
            tokenIds[i] = tokenId;

            emit CardCreated(tokenId, msg.sender, metadataURIs[i], royaltyPercentage);
        }

        // Transfer total fee
        uint256 totalFee = mintingFee * count;
        (bool success, ) = payable(feeRecipient).call{value: totalFee}("");
        require(success, "Fee transfer failed");

        // Refund excess
        if (msg.value > totalFee) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - totalFee}("");
            require(refundSuccess, "Refund failed");
        }

        return tokenIds;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get card stats
     * @param tokenId Token ID
     * @return CustomCardStats struct
     */
    function getCardStats(uint256 tokenId) external view returns (CustomCardStats memory) {
        _requireOwned(tokenId);
        return cardStats[tokenId];
    }

    /**
     * @notice Get all token IDs owned by an address
     * @param owner Address to query
     * @return Array of token IDs owned by the address
     */
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    /**
     * @notice Get creator's cards
     * @param creator Creator address
     * @return Array of token IDs
     */
    function getCreatorCards(address creator) external view returns (uint256[] memory) {
        return creatorCards[creator];
    }

    /**
     * @notice Get total supply
     * @return Total number of cards created
     */
    function totalSupply() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @notice Check if card is banned
     * @param tokenId Token ID
     * @return True if banned
     */
    function isBanned(uint256 tokenId) external view returns (bool) {
        return bannedTokens[tokenId];
    }

    /**
     * @notice Calculate battle power (for compatibility with battle arena)
     * @param tokenId Token ID
     * @return Battle power value
     */
    function calculateBattlePower(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        require(!bannedTokens[tokenId], "Card is banned");

        CustomCardStats memory stats = cardStats[tokenId];

        uint256 basePower = (uint256(stats.hp) * 2) +
                           (uint256(stats.attack) * 3) +
                           (uint256(stats.defense) * 2) +
                           (uint256(stats.speed) * 3);

        // Rarity multipliers
        uint256 rarityMultiplier;
        if (stats.rarity == 0) rarityMultiplier = 100;
        else if (stats.rarity == 1) rarityMultiplier = 120;
        else if (stats.rarity == 2) rarityMultiplier = 150;
        else if (stats.rarity == 3) rarityMultiplier = 200;
        else rarityMultiplier = 300;

        // Verified bonus (10%)
        uint256 verifiedBonus = stats.verified ? 110 : 100;

        return (basePower * rarityMultiplier * verifiedBonus) / 10000;
    }

    // =============================================================================
    // MODERATION FUNCTIONS
    // =============================================================================

    /**
     * @notice Verify a card (moderator only)
     * @param tokenId Token ID to verify
     */
    function verifyCard(uint256 tokenId) external onlyRole(MODERATOR_ROLE) {
        _requireOwned(tokenId);
        require(!cardStats[tokenId].verified, "Already verified");

        cardStats[tokenId].verified = true;

        emit CardVerified(tokenId, msg.sender);
    }

    /**
     * @notice Ban a card (moderator only)
     * @param tokenId Token ID to ban
     * @param reason Reason for banning
     */
    function banCard(uint256 tokenId, string calldata reason) external onlyRole(MODERATOR_ROLE) {
        _requireOwned(tokenId);
        require(!bannedTokens[tokenId], "Already banned");

        bannedTokens[tokenId] = true;

        emit CardBanned(tokenId, msg.sender, reason);
    }

    /**
     * @notice Unban a card (moderator only)
     * @param tokenId Token ID to unban
     */
    function unbanCard(uint256 tokenId) external onlyRole(MODERATOR_ROLE) {
        require(bannedTokens[tokenId], "Not banned");

        bannedTokens[tokenId] = false;

        emit CardUnbanned(tokenId, msg.sender);
    }

    /**
     * @notice Batch verify cards
     * @param tokenIds Array of token IDs
     */
    function batchVerify(uint256[] calldata tokenIds) external onlyRole(MODERATOR_ROLE) {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (_ownerOf(tokenIds[i]) != address(0) && !cardStats[tokenIds[i]].verified) {
                cardStats[tokenIds[i]].verified = true;
                emit CardVerified(tokenIds[i], msg.sender);
            }
        }
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Set minting fee
     * @param newFee New fee in wei
     */
    function setMintingFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldFee = mintingFee;
        mintingFee = newFee;
        emit MintingFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Set default royalty
     * @param newRoyalty New royalty in basis points
     */
    function setDefaultRoyalty(uint96 newRoyalty) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRoyalty <= MAX_ROYALTY, "Royalty too high");
        uint96 oldRoyalty = defaultRoyalty;
        defaultRoyalty = newRoyalty;
        _setDefaultRoyalty(feeRecipient, newRoyalty);
        emit DefaultRoyaltyUpdated(oldRoyalty, newRoyalty);
    }

    /**
     * @notice Set fee recipient
     * @param newRecipient New recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "Invalid recipient");
        feeRecipient = newRecipient;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Withdraw accumulated fees
     */
    function withdrawFees() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");

        (bool success, ) = payable(feeRecipient).call{value: balance}("");
        require(success, "Withdraw failed");
    }

    // =============================================================================
    // OVERRIDES
    // =============================================================================

    /**
     * @notice Check interface support
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @notice Override transfer to check banned status and track ownership
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        require(!bannedTokens[tokenId], "Card is banned");
        address from = _ownerOf(tokenId);

        // Update ownership enumeration
        if (from != address(0)) {
            _removeTokenFromOwnerEnumeration(from, tokenId);
        }
        if (to != address(0)) {
            _addTokenToOwnerEnumeration(to, tokenId);
        }

        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Add token to owner's enumeration list
     */
    function _addTokenToOwnerEnumeration(address to, uint256 tokenId) private {
        _ownedTokensIndex[tokenId] = _ownedTokens[to].length;
        _ownedTokens[to].push(tokenId);
    }

    /**
     * @dev Remove token from owner's enumeration list using swap-and-pop
     */
    function _removeTokenFromOwnerEnumeration(address from, uint256 tokenId) private {
        uint256 lastTokenIndex = _ownedTokens[from].length - 1;
        uint256 tokenIndex = _ownedTokensIndex[tokenId];

        if (tokenIndex != lastTokenIndex) {
            uint256 lastTokenId = _ownedTokens[from][lastTokenIndex];
            _ownedTokens[from][tokenIndex] = lastTokenId;
            _ownedTokensIndex[lastTokenId] = tokenIndex;
        }

        _ownedTokens[from].pop();
        delete _ownedTokensIndex[tokenId];
    }
}
