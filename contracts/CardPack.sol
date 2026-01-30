// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/ICardPack.sol";
import "./interfaces/IPokeDEXCard.sol";

/**
 * @title CardPack
 * @dev Card pack contract using API3 QRNG (Quantum Random Number Generator)
 * @notice FREE randomness - only pay gas, no subscription needed!
 *
 * API3 QRNG uses quantum vacuum fluctuations for true randomness
 * More info: https://docs.api3.org/qrng/
 */

/// @notice Interface for API3 QRNG Airnode RRP
interface IAirnodeRrpV0 {
    function makeFullRequest(
        address airnode,
        bytes32 endpointId,
        address sponsor,
        address sponsorWallet,
        address fulfillAddress,
        bytes4 fulfillFunctionId,
        bytes calldata parameters
    ) external returns (bytes32 requestId);
}

contract CardPack is
    AccessControl,
    ReentrancyGuard,
    Pausable,
    ICardPack
{
    /// @notice Role for setting prices and configuration
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    /// @notice Reference to the PokeDEX card contract
    IPokeDEXCard public immutable cardContract;

    /// @notice API3 Airnode RRP contract
    IAirnodeRrpV0 public immutable airnodeRrp;

    /// @notice API3 QRNG Airnode address (ANU Quantum Random)
    address public airnode;

    /// @notice Endpoint ID for requesting random numbers
    bytes32 public endpointIdUint256Array;

    /// @notice Sponsor wallet for QRNG requests
    address public sponsorWallet;

    /// @notice Pack prices in wei
    mapping(PackType => uint256) public packPrices;

    /// @notice Mapping from request ID to pack request
    mapping(bytes32 => PackRequestInternal) internal _packRequests;

    /// @notice Mapping from user to their pending request IDs
    mapping(address => bytes32[]) public userPendingRequests;

    /// @notice Base URIs for card metadata by rarity
    mapping(IPokeDEXCard.Rarity => string) public rarityBaseURIs;

    /// @notice Rarity thresholds (out of 10000)
    uint16 public constant UNCOMMON_THRESHOLD = 6000;
    uint16 public constant RARE_THRESHOLD = 8500;
    uint16 public constant ULTRA_RARE_THRESHOLD = 9500;
    uint16 public constant LEGENDARY_THRESHOLD = 9900;

    /// @notice Counter for card naming
    uint256 private _cardCounter;

    /// @notice Internal pack request structure (uses bytes32 for QRNG)
    struct PackRequestInternal {
        address buyer;
        PackType packType;
        bytes32 requestId;
        bool fulfilled;
        uint256 pendingIndex;
        uint256[] cardIds;
    }

    /// @notice Emitted when QRNG is configured
    event QRNGConfigured(address airnode, bytes32 endpointId, address sponsorWallet);

    /**
     * @notice Contract constructor
     * @param _airnodeRrp API3 Airnode RRP contract address
     * @param _cardContract Address of PokeDEXCard contract
     * @param admin Admin address
     */
    constructor(
        address _airnodeRrp,
        address _cardContract,
        address admin
    ) {
        require(_airnodeRrp != address(0), "Invalid Airnode RRP");
        require(_cardContract != address(0), "Invalid card contract");
        require(admin != address(0), "Invalid admin");

        airnodeRrp = IAirnodeRrpV0(_airnodeRrp);
        cardContract = IPokeDEXCard(_cardContract);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);

        // Set default pack prices
        packPrices[PackType.Basic] = 0.01 ether;
        packPrices[PackType.Premium] = 0.025 ether;
        packPrices[PackType.Legendary] = 0.05 ether;
    }

    /**
     * @notice Configure QRNG parameters
     * @param _airnode API3 QRNG Airnode address
     * @param _endpointIdUint256Array Endpoint ID for uint256[] requests
     * @param _sponsorWallet Sponsor wallet address
     */
    function setQRNGParameters(
        address _airnode,
        bytes32 _endpointIdUint256Array,
        address _sponsorWallet
    ) external onlyRole(CONFIG_ROLE) {
        require(_airnode != address(0), "Invalid airnode");
        require(_sponsorWallet != address(0), "Invalid sponsor wallet");

        airnode = _airnode;
        endpointIdUint256Array = _endpointIdUint256Array;
        sponsorWallet = _sponsorWallet;

        emit QRNGConfigured(_airnode, _endpointIdUint256Array, _sponsorWallet);
    }

    /**
     * @notice Purchase a card pack
     * @param packType Type of pack to purchase
     * @return requestId QRNG request ID (as uint256 for interface compatibility)
     */
    function purchasePack(PackType packType)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        require(airnode != address(0), "QRNG not configured");

        uint256 price = packPrices[packType];
        require(msg.value >= price, "Insufficient payment");

        uint32 numWords = _getCardsInPack(packType);

        // Make QRNG request
        bytes32 requestId = airnodeRrp.makeFullRequest(
            airnode,
            endpointIdUint256Array,
            address(this),
            sponsorWallet,
            address(this),
            this.fulfillRandomWords.selector,
            abi.encode(bytes32("1u"), bytes32("size"), numWords)
        );

        // Calculate refund before state changes
        uint256 refundAmount = msg.value - price;

        // Store pending index for O(1) removal
        uint256 pendingIdx = userPendingRequests[msg.sender].length;

        // Store pack request
        _packRequests[requestId] = PackRequestInternal({
            buyer: msg.sender,
            packType: packType,
            requestId: requestId,
            fulfilled: false,
            pendingIndex: pendingIdx,
            cardIds: new uint256[](0)
        });

        userPendingRequests[msg.sender].push(requestId);

        emit PackPurchased(uint256(requestId), msg.sender, packType);

        // Refund excess payment
        if (refundAmount > 0) {
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            require(success, "Refund failed");
        }

        return uint256(requestId);
    }

    /**
     * @notice QRNG callback function (called by Airnode)
     * @param requestId Request ID
     * @param data Encoded random data
     */
    function fulfillRandomWords(
        bytes32 requestId,
        bytes calldata data
    ) external {
        require(msg.sender == address(airnodeRrp), "Only Airnode RRP");

        PackRequestInternal storage request = _packRequests[requestId];
        require(request.buyer != address(0), "Request not found");
        require(!request.fulfilled, "Already fulfilled");

        // Mark fulfilled before external calls (CEI pattern)
        request.fulfilled = true;

        // Decode random words
        uint256[] memory randomWords = abi.decode(data, (uint256[]));

        uint256[] memory cardIds = new uint256[](randomWords.length);

        // Mint cards based on random words
        for (uint256 i = 0; i < randomWords.length; i++) {
            cardIds[i] = _mintRandomCard(request.buyer, randomWords[i]);
        }

        request.cardIds = cardIds;

        // Remove from pending requests
        _removePendingRequest(request.buyer, requestId);

        emit PackOpened(uint256(requestId), request.buyer, cardIds);
    }

    /**
     * @notice Get pack price
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
     */
    function getPackRequest(uint256 requestId)
        external
        view
        override
        returns (PackRequest memory)
    {
        PackRequestInternal storage req = _packRequests[bytes32(requestId)];
        return PackRequest({
            buyer: req.buyer,
            packType: req.packType,
            requestId: uint256(req.requestId),
            fulfilled: req.fulfilled,
            pendingIndex: req.pendingIndex,
            cardIds: req.cardIds
        });
    }

    /**
     * @notice Get user's pending pack requests
     */
    function getUserPendingRequests(address user)
        external
        view
        returns (bytes32[] memory)
    {
        return userPendingRequests[user];
    }

    /**
     * @notice Set pack price
     */
    function setPackPrice(PackType packType, uint256 price)
        external
        onlyRole(CONFIG_ROLE)
    {
        require(price > 0, "Price must be positive");
        packPrices[packType] = price;
    }

    /**
     * @notice Set base URI for rarity
     */
    function setRarityBaseURI(IPokeDEXCard.Rarity rarity, string calldata baseURI)
        external
        onlyRole(CONFIG_ROLE)
    {
        rarityBaseURIs[rarity] = baseURI;
    }

    /**
     * @notice Receive ETH
     */
    receive() external payable {}

    /**
     * @notice Withdraw contract balance
     */
    function withdraw(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");

        (bool success, ) = payable(to).call{value: balance}("");
        require(success, "Withdraw failed");
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================

    function _getCardsInPack(PackType packType) internal pure returns (uint32) {
        if (packType == PackType.Basic) return 3;
        if (packType == PackType.Premium) return 5;
        return 10;
    }

    function _mintRandomCard(address to, uint256 randomWord)
        internal
        returns (uint256)
    {
        uint256 rarityRoll = randomWord % 10000;
        IPokeDEXCard.Rarity rarity = _determineRarity(rarityRoll);

        IPokeDEXCard.CardStats memory stats = _generateStats(randomWord, rarity);

        uint256 cardNum = ++_cardCounter;
        string memory uri = string(
            abi.encodePacked(
                rarityBaseURIs[rarity],
                _toString(cardNum),
                ".json"
            )
        );

        return cardContract.mintCard(to, uri, stats);
    }

    function _determineRarity(uint256 roll) internal pure returns (IPokeDEXCard.Rarity) {
        if (roll < UNCOMMON_THRESHOLD) return IPokeDEXCard.Rarity.Common;
        if (roll < RARE_THRESHOLD) return IPokeDEXCard.Rarity.Uncommon;
        if (roll < ULTRA_RARE_THRESHOLD) return IPokeDEXCard.Rarity.Rare;
        if (roll < LEGENDARY_THRESHOLD) return IPokeDEXCard.Rarity.UltraRare;
        return IPokeDEXCard.Rarity.Legendary;
    }

    function _generateStats(uint256 randomWord, IPokeDEXCard.Rarity rarity)
        internal
        pure
        returns (IPokeDEXCard.CardStats memory)
    {
        (uint16 minStat, uint16 maxStat) = _getStatRange(rarity);

        uint16 hp = minStat + uint16((randomWord >> 8) % (maxStat - minStat + 1));
        uint16 attack = minStat + uint16((randomWord >> 16) % (maxStat - minStat + 1));
        uint16 defense = minStat + uint16((randomWord >> 24) % (maxStat - minStat + 1));
        uint16 speed = minStat + uint16((randomWord >> 32) % (maxStat - minStat + 1));

        IPokeDEXCard.PokemonType pokemonType = IPokeDEXCard.PokemonType(
            (randomWord >> 40) % 18
        );

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

    function _getStatRange(IPokeDEXCard.Rarity rarity)
        internal
        pure
        returns (uint16 minStat, uint16 maxStat)
    {
        if (rarity == IPokeDEXCard.Rarity.Common) return (20, 60);
        if (rarity == IPokeDEXCard.Rarity.Uncommon) return (40, 80);
        if (rarity == IPokeDEXCard.Rarity.Rare) return (60, 120);
        if (rarity == IPokeDEXCard.Rarity.UltraRare) return (80, 180);
        return (120, 255);
    }

    function _removePendingRequest(address user, bytes32 requestId) internal {
        PackRequestInternal storage request = _packRequests[requestId];
        bytes32[] storage pending = userPendingRequests[user];
        uint256 index = request.pendingIndex;

        if (index < pending.length && pending[index] == requestId) {
            bytes32 lastRequestId = pending[pending.length - 1];
            if (lastRequestId != requestId) {
                pending[index] = lastRequestId;
                _packRequests[lastRequestId].pendingIndex = index;
            }
            pending.pop();
        }
    }

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
