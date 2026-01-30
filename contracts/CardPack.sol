// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/ICardPack.sol";
import "./interfaces/IPokeDEXCard.sol";

/**
 * @title CardPack
 * @dev Card pack contract with Chainlink VRF v2.5 for verifiable randomness
 * @notice Gacha-style pack opening with guaranteed rarity distribution
 */
contract CardPack is
    VRFConsumerBaseV2Plus,
    AccessControl,
    ReentrancyGuard,
    Pausable,
    ICardPack
{
    /// @notice Role for setting prices and configuration
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    /// @notice Emitted when pack price is updated
    event PackPriceUpdated(PackType indexed packType, uint256 oldPrice, uint256 newPrice);

    /// @notice Reference to the PokeDEX card contract
    IPokeDEXCard public immutable cardContract;

    /// @notice VRF subscription ID
    uint256 public immutable subscriptionId;

    /// @notice VRF key hash
    bytes32 public immutable keyHash;

    /// @notice VRF callback gas limit
    uint32 public callbackGasLimit = 500000;

    /// @notice VRF request confirmations
    uint16 public requestConfirmations = 3;

    /// @notice Pack prices in wei
    mapping(PackType => uint256) public packPrices;

    /// @notice Mapping from VRF request ID to pack request
    mapping(uint256 => PackRequest) public packRequests;

    /// @notice Mapping from user to their pending requests
    mapping(address => uint256[]) public userPendingRequests;

    /// @notice Base URIs for card metadata by rarity
    mapping(IPokeDEXCard.Rarity => string) public rarityBaseURIs;

    /// @notice Rarity thresholds (out of 10000)
    /// Common: 0-5999 (60%), Uncommon: 6000-8499 (25%), Rare: 8500-9499 (10%)
    /// UltraRare: 9500-9899 (4%), Legendary: 9900-9999 (1%)
    uint16 public constant UNCOMMON_THRESHOLD = 6000;
    uint16 public constant RARE_THRESHOLD = 8500;
    uint16 public constant ULTRA_RARE_THRESHOLD = 9500;
    uint16 public constant LEGENDARY_THRESHOLD = 9900;

    /// @notice Counter for card naming within packs
    uint256 private _cardCounter;

    /**
     * @notice Contract constructor
     * @param _vrfCoordinator VRF Coordinator address
     * @param _subscriptionId VRF subscription ID
     * @param _keyHash VRF key hash
     * @param _cardContract Address of PokeDEXCard contract
     * @param admin Admin address
     */
    constructor(
        address _vrfCoordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash,
        address _cardContract,
        address admin
    ) VRFConsumerBaseV2Plus(_vrfCoordinator) {
        require(_cardContract != address(0), "Invalid card contract");
        require(admin != address(0), "Invalid admin");

        cardContract = IPokeDEXCard(_cardContract);
        subscriptionId = _subscriptionId;
        keyHash = _keyHash;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);

        // Set default pack prices
        packPrices[PackType.Basic] = 0.01 ether;
        packPrices[PackType.Premium] = 0.025 ether;
        packPrices[PackType.Legendary] = 0.05 ether;
    }

    /**
     * @notice Purchase a card pack
     * @param packType Type of pack to purchase
     * @return requestId VRF request ID
     */
    function purchasePack(PackType packType)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        uint256 price = packPrices[packType];
        require(msg.value >= price, "Insufficient payment");

        // Request random words from Chainlink VRF
        uint32 numWords = _getCardsInPack(packType);

        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );

        // Calculate refund BEFORE state changes (CEI pattern)
        uint256 refundAmount = msg.value - price;

        // Store pending index for O(1) removal
        uint256 pendingIdx = userPendingRequests[msg.sender].length;

        // Store pack request (EFFECTS)
        packRequests[requestId] = PackRequest({
            buyer: msg.sender,
            packType: packType,
            requestId: requestId,
            fulfilled: false,
            pendingIndex: pendingIdx,
            cardIds: new uint256[](0)
        });

        userPendingRequests[msg.sender].push(requestId);

        // Emit event before external call
        emit PackPurchased(requestId, msg.sender, packType);

        // Refund excess payment LAST (INTERACTIONS)
        if (refundAmount > 0) {
            (bool success,) = payable(msg.sender).call{value: refundAmount}("");
            require(success, "Refund failed");
        }

        return requestId;
    }

    /**
     * @notice VRF callback function
     * @param requestId Request ID
     * @param randomWords Array of random words
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        PackRequest storage request = packRequests[requestId];
        require(request.buyer != address(0), "Request not found");
        require(!request.fulfilled, "Already fulfilled");

        // Mark fulfilled BEFORE external calls (CEI pattern)
        request.fulfilled = true;

        uint256[] memory cardIds = new uint256[](randomWords.length);

        // Mint cards based on random words
        for (uint256 i = 0; i < randomWords.length; i++) {
            cardIds[i] = _mintRandomCard(request.buyer, randomWords[i]);
        }

        request.cardIds = cardIds;

        // Remove from pending requests
        _removePendingRequest(request.buyer, requestId);

        emit PackOpened(requestId, request.buyer, cardIds);
    }

    /**
     * @notice Get pack price
     * @param packType Pack type to query
     * @return Price in wei
     */
    function getPackPrice(PackType packType)
        external
        view
        override
        returns (uint256)
    {
        return packPrices[packType];
    }

    /**
     * @notice Get pack request details
     * @param requestId Request ID to query
     * @return PackRequest struct
     */
    function getPackRequest(uint256 requestId)
        external
        view
        override
        returns (PackRequest memory)
    {
        return packRequests[requestId];
    }

    /**
     * @notice Get user's pending pack requests
     * @param user User address
     * @return Array of request IDs
     */
    function getUserPendingRequests(address user)
        external
        view
        returns (uint256[] memory)
    {
        return userPendingRequests[user];
    }

    /**
     * @notice Verify that the contract has the required role on the card contract
     * @return True if this contract has MINTER_ROLE on cardContract
     */
    function verifySetup() external view returns (bool) {
        bytes32 MINTER_ROLE = keccak256("MINTER_ROLE");
        return IAccessControl(address(cardContract)).hasRole(MINTER_ROLE, address(this));
    }

    /**
     * @notice Set pack price
     * @param packType Pack type to update
     * @param price New price in wei
     */
    function setPackPrice(PackType packType, uint256 price)
        external
        onlyRole(CONFIG_ROLE)
    {
        require(price > 0, "Price must be positive");
        uint256 oldPrice = packPrices[packType];
        packPrices[packType] = price;
        emit PackPriceUpdated(packType, oldPrice, price);
    }

    /**
     * @notice Set base URI for rarity
     * @param rarity Rarity level
     * @param baseURI Base URI string
     */
    function setRarityBaseURI(IPokeDEXCard.Rarity rarity, string calldata baseURI)
        external
        onlyRole(CONFIG_ROLE)
    {
        rarityBaseURIs[rarity] = baseURI;
    }

    /**
     * @notice Set VRF callback gas limit
     * @param _callbackGasLimit New gas limit
     */
    function setCallbackGasLimit(uint32 _callbackGasLimit)
        external
        onlyRole(CONFIG_ROLE)
    {
        callbackGasLimit = _callbackGasLimit;
    }

    /**
     * @notice Receive ETH payments
     */
    receive() external payable {}

    /**
     * @notice Withdraw contract balance
     * @param to Recipient address
     */
    function withdraw(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");

        (bool success,) = payable(to).call{value: balance}("");
        require(success, "Withdraw failed");
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
     * @dev Get number of cards in a pack type
     * @param packType Pack type
     * @return Number of cards
     */
    function _getCardsInPack(PackType packType) internal pure returns (uint32) {
        if (packType == PackType.Basic) return 3;
        if (packType == PackType.Premium) return 5;
        return 10; // Legendary
    }

    /**
     * @dev Mint a random card based on random word
     * @param to Recipient address
     * @param randomWord Random value from VRF
     * @return tokenId Minted token ID
     */
    function _mintRandomCard(address to, uint256 randomWord)
        internal
        returns (uint256)
    {
        // Determine rarity based on random value
        uint256 rarityRoll = randomWord % 10000;
        IPokeDEXCard.Rarity rarity = _determineRarity(rarityRoll);

        // Generate stats based on rarity and randomness
        IPokeDEXCard.CardStats memory stats = _generateStats(randomWord, rarity);

        // Generate token URI
        uint256 cardNum = ++_cardCounter;
        string memory uri = string(
            abi.encodePacked(
                rarityBaseURIs[rarity],
                _toString(cardNum),
                ".json"
            )
        );

        // Mint the card
        return cardContract.mintCard(to, uri, stats);
    }

    /**
     * @dev Determine rarity from random roll
     * @param roll Random value 0-9999
     * @return Rarity level
     */
    function _determineRarity(uint256 roll) internal pure returns (IPokeDEXCard.Rarity) {
        if (roll < UNCOMMON_THRESHOLD) return IPokeDEXCard.Rarity.Common;
        if (roll < RARE_THRESHOLD) return IPokeDEXCard.Rarity.Uncommon;
        if (roll < ULTRA_RARE_THRESHOLD) return IPokeDEXCard.Rarity.Rare;
        if (roll < LEGENDARY_THRESHOLD) return IPokeDEXCard.Rarity.UltraRare;
        return IPokeDEXCard.Rarity.Legendary;
    }

    /**
     * @dev Generate card stats based on randomness and rarity
     * @param randomWord Random seed
     * @param rarity Card rarity
     * @return CardStats struct
     */
    function _generateStats(uint256 randomWord, IPokeDEXCard.Rarity rarity)
        internal
        pure
        returns (IPokeDEXCard.CardStats memory)
    {
        // Base stat ranges by rarity
        (uint16 minStat, uint16 maxStat) = _getStatRange(rarity);

        // Use different parts of random word for different stats
        uint16 hp = minStat + uint16((randomWord >> 8) % (maxStat - minStat + 1));
        uint16 attack = minStat + uint16((randomWord >> 16) % (maxStat - minStat + 1));
        uint16 defense = minStat + uint16((randomWord >> 24) % (maxStat - minStat + 1));
        uint16 speed = minStat + uint16((randomWord >> 32) % (maxStat - minStat + 1));

        // Determine Pokemon type
        IPokeDEXCard.PokemonType pokemonType = IPokeDEXCard.PokemonType(
            (randomWord >> 40) % 18
        );

        // Determine generation (1-9)
        uint8 generation = uint8(1 + ((randomWord >> 48) % 9));

        return IPokeDEXCard.CardStats({
            hp: hp,
            attack: attack,
            defense: defense,
            speed: speed,
            pokemonType: pokemonType,
            rarity: rarity,
            generation: generation,
            experience: 0
        });
    }

    /**
     * @dev Get stat range for a rarity level
     * @param rarity Rarity level
     * @return minStat Minimum stat value
     * @return maxStat Maximum stat value
     */
    function _getStatRange(IPokeDEXCard.Rarity rarity)
        internal
        pure
        returns (uint16 minStat, uint16 maxStat)
    {
        if (rarity == IPokeDEXCard.Rarity.Common) return (20, 60);
        if (rarity == IPokeDEXCard.Rarity.Uncommon) return (40, 80);
        if (rarity == IPokeDEXCard.Rarity.Rare) return (60, 120);
        if (rarity == IPokeDEXCard.Rarity.UltraRare) return (80, 180);
        return (120, 255); // Legendary
    }

    /**
     * @dev Remove a pending request from user's list (O(1) using stored index)
     * @param user User address
     * @param requestId Request ID to remove
     */
    function _removePendingRequest(address user, uint256 requestId) internal {
        PackRequest storage request = packRequests[requestId];
        uint256[] storage pending = userPendingRequests[user];
        uint256 index = request.pendingIndex;

        // Verify index is valid and contains the correct request
        if (index < pending.length && pending[index] == requestId) {
            // Swap with last element
            uint256 lastRequestId = pending[pending.length - 1];
            if (lastRequestId != requestId) {
                pending[index] = lastRequestId;
                packRequests[lastRequestId].pendingIndex = index;
            }
            pending.pop();
        }
    }

    /**
     * @dev Convert uint to string
     * @param value Number to convert
     * @return String representation
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }

        return string(buffer);
    }
}
