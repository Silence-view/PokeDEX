// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/ICardPack.sol";
import "./interfaces/IPokeDEXCard.sol";

/**
 * @title CardPack
 * @author PokeDEX Team
 * @dev Card pack contract using API3 QRNG (Quantum Random Number Generator)
 * @notice FREE randomness - only pay gas, no subscription needed!
 *
 * API3 QRNG uses quantum vacuum fluctuations for true randomness
 * More info: https://docs.api3.org/qrng/
 *
 * Security Features:
 * - Input validation on all configurable parameters
 * - Maximum cards per pack limit to prevent gas exhaustion
 * - Price validation to prevent zero-price purchases
 * - Address validation to prevent zero-address assignments
 * - Reentrancy protection on all state-changing functions
 * - Pausable for emergency stops
 * - Timeout refund mechanism for failed QRNG requests
 * - Two-step admin transfer for safe ownership changes
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
    // =============================================================================
    // CONSTANTS
    // =============================================================================

    /// @notice Role for setting prices and configuration
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    /// @notice Maximum number of cards allowed in a single pack
    /// @dev Prevents gas exhaustion attacks and ensures reasonable pack sizes
    uint256 public constant MAX_CARDS_PER_PACK = 50;

    /// @notice Minimum number of cards required in a pack
    uint256 public constant MIN_CARDS_PER_PACK = 1;

    /// @notice Maximum rarity roll value (basis points)
    uint16 public constant MAX_RARITY_ROLL = 10000;

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER
    // =============================================================================

    /// @notice Address of pending admin for two-step transfer
    address public pendingAdmin;

    /// @notice Address of current admin who initiated the transfer
    address private _transferInitiator;

    // Note: Admin transfer events are inherited from ICardPack interface

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

    /// @notice Timeout duration for QRNG requests (1 hour)
    uint256 public constant REQUEST_TIMEOUT = 1 hours;

    /// @notice Mapping from request ID to timestamp when request was made
    mapping(bytes32 => uint256) public requestTimestamps;

    /// @notice Mapping from request ID to the amount paid for the pack
    mapping(bytes32 => uint256) public requestToAmount;

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

    // Note: QRNGConfigured, RequestRefunded, RequestTimedOut, PackPurchased, PackOpened
    // are inherited from ICardPack interface

    // =============================================================================
    // EVENTS
    // =============================================================================

    /// @notice Emitted when a pack type is configured with new settings
    /// @param packType The type of pack being configured
    /// @param price The price of the pack in wei
    /// @param numCards The number of cards in the pack
    event PackConfigured(
        uint256 indexed packType,
        uint256 price,
        uint256 numCards
    );

    /// @notice Emitted when pack price is updated
    /// @param packType The type of pack
    /// @param oldPrice The previous price
    /// @param newPrice The new price
    event PackPriceUpdated(
        PackType indexed packType,
        uint256 oldPrice,
        uint256 newPrice
    );

    /// @notice Emitted when rarity base URI is updated
    /// @param rarity The rarity level
    /// @param baseURI The new base URI
    event RarityBaseURIUpdated(
        IPokeDEXCard.Rarity indexed rarity,
        string baseURI
    );

    /// @notice Emitted when funds are withdrawn
    /// @param to The recipient address
    /// @param amount The amount withdrawn
    event Withdrawn(address indexed to, uint256 amount);

    // =============================================================================
    // ERRORS
    // =============================================================================

    /// @notice Thrown when an invalid address (zero address) is provided
    error InvalidAddress();

    /// @notice Thrown when the price is not positive
    error PriceMustBePositive();

    /// @notice Thrown when too many cards are requested in a pack
    /// @param requested The number of cards requested
    /// @param maximum The maximum allowed
    error TooManyCardsPerPack(uint256 requested, uint256 maximum);

    /// @notice Thrown when too few cards are requested in a pack
    error MustHaveAtLeastOneCard();

    /// @notice Thrown when QRNG is not configured
    error QRNGNotConfigured();

    /// @notice Thrown when insufficient payment is provided
    /// @param provided The amount provided
    /// @param required The amount required
    error InsufficientPayment(uint256 provided, uint256 required);

    /// @notice Thrown when a request is not found
    error RequestNotFound();

    /// @notice Thrown when a request has already been fulfilled
    error AlreadyFulfilled();

    /// @notice Thrown when caller is not authorized
    error UnauthorizedCaller();

    /// @notice Thrown when refund transfer fails
    error RefundFailed();

    /// @notice Thrown when withdraw transfer fails
    error WithdrawFailed();

    /// @notice Thrown when there is no balance to withdraw
    error NoBalance();

    /// @notice Thrown when request has not timed out yet
    error RequestNotTimedOut();

    /// @notice Thrown when there is no amount to refund
    error NoAmountToRefund();

    /// @notice Thrown when trying to transfer admin to self
    error CannotTransferToSelf();

    /// @notice Thrown when there is no pending transfer to accept/cancel
    error NoPendingTransfer();

    /// @notice Thrown when caller is not the pending admin
    error OnlyPendingAdmin();

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @notice Contract constructor
     * @dev Initializes the contract with required addresses and default pack prices
     * @param _airnodeRrp API3 Airnode RRP contract address (cannot be zero)
     * @param _cardContract Address of PokeDEXCard contract (cannot be zero)
     * @param admin Admin address (cannot be zero)
     */
    constructor(
        address _airnodeRrp,
        address _cardContract,
        address admin
    ) {
        if (_airnodeRrp == address(0)) revert InvalidAddress();
        if (_cardContract == address(0)) revert InvalidAddress();
        if (admin == address(0)) revert InvalidAddress();

        airnodeRrp = IAirnodeRrpV0(_airnodeRrp);
        cardContract = IPokeDEXCard(_cardContract);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);

        // Set default pack prices (all positive values)
        packPrices[PackType.Basic] = 0.01 ether;
        packPrices[PackType.Premium] = 0.025 ether;
        packPrices[PackType.Legendary] = 0.05 ether;

        // Emit configuration events for default packs
        emit PackConfigured(uint256(PackType.Basic), 0.01 ether, 3);
        emit PackConfigured(uint256(PackType.Premium), 0.025 ether, 5);
        emit PackConfigured(uint256(PackType.Legendary), 0.05 ether, 10);
    }

    // =============================================================================
    // EXTERNAL FUNCTIONS - CONFIGURATION
    // =============================================================================

    /**
     * @notice Configure QRNG parameters for random number generation
     * @dev Only callable by accounts with CONFIG_ROLE
     * @param _airnode API3 QRNG Airnode address (cannot be zero)
     * @param _endpointIdUint256Array Endpoint ID for uint256[] requests
     * @param _sponsorWallet Sponsor wallet address (cannot be zero)
     */
    function setQRNGParameters(
        address _airnode,
        bytes32 _endpointIdUint256Array,
        address _sponsorWallet
    ) external onlyRole(CONFIG_ROLE) {
        if (_airnode == address(0)) revert InvalidAddress();
        if (_sponsorWallet == address(0)) revert InvalidAddress();

        airnode = _airnode;
        endpointIdUint256Array = _endpointIdUint256Array;
        sponsorWallet = _sponsorWallet;

        emit QRNGConfigured(_airnode, _endpointIdUint256Array, _sponsorWallet);
    }

    // =============================================================================
    // EXTERNAL FUNCTIONS - PACK OPERATIONS
    // =============================================================================

    /**
     * @notice Purchase a card pack with the specified type
     * @dev Requires QRNG to be configured. Excess payment is refunded.
     * @param packType Type of pack to purchase (Basic, Premium, or Legendary)
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
        if (airnode == address(0)) revert QRNGNotConfigured();

        uint256 price = packPrices[packType];
        if (msg.value < price) revert InsufficientPayment(msg.value, price);

        uint32 numWords = _getCardsInPack(packType);

        // Validate card count (defense in depth - _getCardsInPack returns known values)
        assert(numWords >= MIN_CARDS_PER_PACK && numWords <= MAX_CARDS_PER_PACK);

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

        // Store request timestamp and amount for timeout refund mechanism
        requestTimestamps[requestId] = block.timestamp;
        requestToAmount[requestId] = price;

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

        // Refund excess payment (CEI pattern - external call last)
        if (refundAmount > 0) {
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            if (!success) revert RefundFailed();
        }

        return uint256(requestId);
    }

    /**
     * @notice QRNG callback function (called by Airnode)
     * @dev Can only be called by the Airnode RRP contract
     * @param requestId Request ID from the original QRNG request
     * @param data Encoded random data (uint256[] of random words)
     */
    function fulfillRandomWords(
        bytes32 requestId,
        bytes calldata data
    ) external {
        if (msg.sender != address(airnodeRrp)) revert UnauthorizedCaller();

        PackRequestInternal storage request = _packRequests[requestId];
        if (request.buyer == address(0)) revert RequestNotFound();
        if (request.fulfilled) revert AlreadyFulfilled();

        // Mark fulfilled before external calls (CEI pattern)
        request.fulfilled = true;

        // Decode random words
        uint256[] memory randomWords = abi.decode(data, (uint256[]));

        // Validate array length (bounds check)
        uint256 numCards = randomWords.length;
        if (numCards == 0) revert MustHaveAtLeastOneCard();
        if (numCards > MAX_CARDS_PER_PACK) revert TooManyCardsPerPack(numCards, MAX_CARDS_PER_PACK);

        uint256[] memory cardIds = new uint256[](numCards);

        // Mint cards based on random words
        // Note: Solidity 0.8+ has built-in overflow protection
        for (uint256 i = 0; i < numCards; i++) {
            cardIds[i] = _mintRandomCard(request.buyer, randomWords[i]);
        }

        request.cardIds = cardIds;

        // Remove from pending requests
        _removePendingRequest(request.buyer, requestId);

        emit PackOpened(uint256(requestId), request.buyer, cardIds);
    }

    // =============================================================================
    // EXTERNAL FUNCTIONS - VIEW
    // =============================================================================

    /**
     * @notice Get the price of a specific pack type
     * @param packType The type of pack to query
     * @return The price in wei
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
     * @notice Get pack request details by request ID
     * @param requestId The request ID to query
     * @return PackRequest struct containing all request details
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
     * @notice Get all pending request IDs for a user
     * @param user The user address to query
     * @return Array of pending request IDs (as bytes32)
     */
    function getUserPendingRequests(address user)
        external
        view
        returns (bytes32[] memory)
    {
        return userPendingRequests[user];
    }

    /**
     * @notice Get the number of cards in a specific pack type
     * @param packType The type of pack to query
     * @return The number of cards in the pack
     */
    function getCardsInPack(PackType packType) external pure returns (uint32) {
        return _getCardsInPack(packType);
    }

    /**
     * @notice Set the price for a specific pack type
     * @dev Only callable by accounts with CONFIG_ROLE. Price must be greater than 0.
     * @param packType The type of pack to configure
     * @param price The new price in wei (must be greater than 0)
     */
    function setPackPrice(PackType packType, uint256 price)
        external
        onlyRole(CONFIG_ROLE)
    {
        if (price == 0) revert PriceMustBePositive();

        uint256 oldPrice = packPrices[packType];
        packPrices[packType] = price;

        emit PackPriceUpdated(packType, oldPrice, price);
    }

    /**
     * @notice Set base URI for a specific rarity level
     * @dev Only callable by accounts with CONFIG_ROLE
     * @param rarity The rarity level to configure
     * @param baseURI The base URI for metadata
     */
    function setRarityBaseURI(IPokeDEXCard.Rarity rarity, string calldata baseURI)
        external
        onlyRole(CONFIG_ROLE)
    {
        rarityBaseURIs[rarity] = baseURI;

        emit RarityBaseURIUpdated(rarity, baseURI);
    }

    // =============================================================================
    // EXTERNAL FUNCTIONS - ADMIN
    // =============================================================================

    /**
     * @notice Receive ETH for sponsor wallet funding
     * @dev Allows the contract to receive ETH for QRNG sponsorship
     */
    receive() external payable {}

    /**
     * @notice Withdraw contract balance to a specified address
     * @dev Only callable by accounts with DEFAULT_ADMIN_ROLE
     * @param to The address to receive the withdrawn funds (cannot be zero)
     */
    function withdraw(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance == 0) revert NoBalance();

        emit Withdrawn(to, balance);

        (bool success, ) = payable(to).call{value: balance}("");
        if (!success) revert WithdrawFailed();
    }

    /**
     * @notice Pause the contract, preventing pack purchases
     * @dev Only callable by accounts with DEFAULT_ADMIN_ROLE
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the contract, allowing pack purchases
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
     * @param newAdmin The address to transfer admin role to (cannot be zero or self)
     */
    function initiateAdminTransfer(address newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newAdmin == address(0)) revert InvalidAddress();
        if (newAdmin == msg.sender) revert CannotTransferToSelf();

        pendingAdmin = newAdmin;
        _transferInitiator = msg.sender;

        emit AdminTransferInitiated(msg.sender, newAdmin);
    }

    /**
     * @notice Completes admin transfer (step 2) - must be called by pending admin
     * @dev Grants DEFAULT_ADMIN_ROLE to pending admin and revokes from the initiating admin
     */
    function acceptAdminTransfer() external {
        if (msg.sender != pendingAdmin) revert OnlyPendingAdmin();

        address oldAdmin = _transferInitiator;
        if (oldAdmin == address(0)) revert NoPendingTransfer();

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
        if (pendingAdmin == address(0)) revert NoPendingTransfer();

        emit AdminTransferCancelled(msg.sender, pendingAdmin);

        pendingAdmin = address(0);
        _transferInitiator = address(0);
    }

    /**
     * @notice Refund a timed-out QRNG request
     * @dev Allows users to reclaim ETH if QRNG fails to respond within timeout period
     * @param requestId The request ID to refund
     */
    function refundTimedOutRequest(bytes32 requestId) external nonReentrant {
        // Validate request exists
        if (requestTimestamps[requestId] == 0) revert RequestNotFound();

        // Validate timeout period has passed
        if (block.timestamp <= requestTimestamps[requestId] + REQUEST_TIMEOUT) {
            revert RequestNotTimedOut();
        }

        PackRequestInternal storage request = _packRequests[requestId];

        // Validate request hasn't been fulfilled
        if (request.fulfilled) revert AlreadyFulfilled();

        // Get requester and amount before state changes (CEI pattern)
        address requester = request.buyer;
        uint256 amount = requestToAmount[requestId];

        // Validate there's something to refund
        if (amount == 0) revert NoAmountToRefund();
        if (requester == address(0)) revert InvalidAddress();

        // Mark as fulfilled to prevent double refund (state changes before external call)
        request.fulfilled = true;

        // Clear timeout-related mappings
        delete requestTimestamps[requestId];
        delete requestToAmount[requestId];

        // Remove from user's pending requests
        _removePendingRequest(requester, requestId);

        // Emit events before external call
        emit RequestTimedOut(requestId);
        emit RequestRefunded(requestId, requester, amount);

        // Transfer refund (external call last - CEI pattern)
        (bool success, ) = payable(requester).call{value: amount}("");
        if (!success) revert RefundFailed();
    }

    /**
     * @notice Check if a request has timed out and is eligible for refund
     * @param requestId The request ID to check
     * @return isTimedOut Whether the request has timed out
     * @return timeRemaining Seconds until timeout (0 if already timed out)
     */
    function isRequestTimedOut(bytes32 requestId)
        external
        view
        returns (bool isTimedOut, uint256 timeRemaining)
    {
        uint256 timestamp = requestTimestamps[requestId];
        if (timestamp == 0) {
            return (false, 0);
        }

        uint256 timeoutAt = timestamp + REQUEST_TIMEOUT;
        if (block.timestamp > timeoutAt) {
            return (true, 0);
        }

        return (false, timeoutAt - block.timestamp);
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================

    /**
     * @notice Get the number of cards in a pack type
     * @dev Returns predefined values within valid bounds (3, 5, or 10)
     * @param packType The type of pack
     * @return Number of cards (3 for Basic, 5 for Premium, 10 for Legendary)
     */
    function _getCardsInPack(PackType packType) internal pure returns (uint32) {
        if (packType == PackType.Basic) return 3;
        if (packType == PackType.Premium) return 5;
        return 10; // Legendary
    }

    /**
     * @notice Mint a random card based on a random word
     * @dev Determines rarity and stats from the random word
     * @param to The address to mint the card to
     * @param randomWord The random word from QRNG
     * @return The minted card's token ID
     */
    function _mintRandomCard(address to, uint256 randomWord)
        internal
        returns (uint256)
    {
        uint256 rarityRoll = randomWord % MAX_RARITY_ROLL;
        IPokeDEXCard.Rarity rarity = _determineRarity(rarityRoll);

        IPokeDEXCard.CardStats memory stats = _generateStats(randomWord, rarity);

        // Increment counter (Solidity 0.8+ overflow protection)
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

    /**
     * @notice Determine card rarity based on roll value
     * @dev Uses predefined thresholds for rarity distribution
     * @param roll The roll value (0-9999)
     * @return The determined rarity
     */
    function _determineRarity(uint256 roll) internal pure returns (IPokeDEXCard.Rarity) {
        // Bounds check (roll should be < MAX_RARITY_ROLL from modulo operation)
        assert(roll < MAX_RARITY_ROLL);

        if (roll < UNCOMMON_THRESHOLD) return IPokeDEXCard.Rarity.Common;
        if (roll < RARE_THRESHOLD) return IPokeDEXCard.Rarity.Uncommon;
        if (roll < ULTRA_RARE_THRESHOLD) return IPokeDEXCard.Rarity.Rare;
        if (roll < LEGENDARY_THRESHOLD) return IPokeDEXCard.Rarity.UltraRare;
        return IPokeDEXCard.Rarity.Legendary;
    }

    /**
     * @notice Generate card stats based on random word and rarity
     * @dev Uses bit shifting to extract multiple random values from one word
     * @param randomWord The random word from QRNG
     * @param rarity The card's rarity level
     * @return CardStats struct with generated values
     */
    function _generateStats(uint256 randomWord, IPokeDEXCard.Rarity rarity)
        internal
        pure
        returns (IPokeDEXCard.CardStats memory)
    {
        (uint16 minStat, uint16 maxStat) = _getStatRange(rarity);

        // Calculate stat range (Solidity 0.8+ overflow protection)
        uint16 statRange = maxStat - minStat + 1;

        // Extract stats from different bit positions of the random word
        uint16 hp = minStat + uint16((randomWord >> 8) % statRange);
        uint16 attack = minStat + uint16((randomWord >> 16) % statRange);
        uint16 defense = minStat + uint16((randomWord >> 24) % statRange);
        uint16 speed = minStat + uint16((randomWord >> 32) % statRange);

        // Determine Pokemon type (18 types: 0-17)
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
     * @notice Get the stat range for a specific rarity
     * @dev Higher rarities have higher stat ranges
     * @param rarity The rarity level
     * @return minStat The minimum stat value
     * @return maxStat The maximum stat value
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
     * @notice Remove a request from a user's pending requests
     * @dev Uses swap-and-pop for O(1) removal with bounds checking
     * @param user The user's address
     * @param requestId The request ID to remove
     */
    function _removePendingRequest(address user, bytes32 requestId) internal {
        PackRequestInternal storage request = _packRequests[requestId];
        bytes32[] storage pending = userPendingRequests[user];
        uint256 index = request.pendingIndex;

        // Bounds check before array access
        uint256 pendingLength = pending.length;
        if (index < pendingLength && pending[index] == requestId) {
            bytes32 lastRequestId = pending[pendingLength - 1];
            if (lastRequestId != requestId) {
                pending[index] = lastRequestId;
                _packRequests[lastRequestId].pendingIndex = index;
            }
            pending.pop();
        }
    }

    /**
     * @notice Convert a uint256 to its string representation
     * @dev Gas-efficient implementation for on-chain string conversion
     * @param value The value to convert
     * @return The string representation
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
