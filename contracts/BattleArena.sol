// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./interfaces/IBattleArena.sol";
import "./interfaces/IPokeDEXCard.sol";
import "./PokeDEXCard.sol";

/**
 * @title BattleArena
 * @author PokeDEX Team
 * @dev PvP battle system for Pokemon card battles with betting support
 * @notice Turn-based battles with type advantages, stat calculations, and ETH staking
 */
contract BattleArena is
    AccessControl,
    ReentrancyGuard,
    Pausable,
    IBattleArena
{
    // =============================================================================
    // CONSTANTS
    // =============================================================================

    /// @notice Role for managing battle rewards
    bytes32 public constant REWARDS_ROLE = keccak256("REWARDS_ROLE");

    /// @notice Maximum leaderboard size to prevent DoS
    uint256 public constant MAX_LEADERBOARD_SIZE = 100;

    /// @notice Default pagination limit for view functions to prevent DoS
    uint256 public constant DEFAULT_PAGINATION_LIMIT = 100;

    /// @notice Minimum bet amount (0.001 ETH)
    uint256 public constant MIN_BET = 0.001 ether;

    /// @notice Maximum bet amount (0.5 ETH)
    /// @dev Reduced from 10 ETH due to tiebreaker determinism. For higher stakes,
    /// integrate VRF/QRNG (see CardPack.sol for API3 QRNG example).
    uint256 public constant MAX_BET = 0.5 ether;

    // =============================================================================
    // EVENTS
    // =============================================================================

    // Note: ExpRewardsUpdated and ChallengeTimeoutUpdated are inherited from IBattleArena

    /// @notice Emitted when a challenge is created
    /// @param battleId The unique battle identifier
    /// @param challenger The address of the challenger
    /// @param opponent The address of the opponent
    /// @param cardId The card token ID used by the challenger
    event ChallengeCreated(
        uint256 indexed battleId,
        address indexed challenger,
        address indexed opponent,
        uint256 cardId
    );

    /// @notice Emitted when a challenge is accepted
    /// @param battleId The unique battle identifier
    /// @param opponent The address of the opponent accepting
    /// @param cardId The card token ID used by the opponent
    event ChallengeAccepted(
        uint256 indexed battleId,
        address indexed opponent,
        uint256 cardId
    );

    /// @notice Emitted when a battle is completed with power details
    /// @param battleId The unique battle identifier
    /// @param winner The address of the winner
    /// @param winnerPower The calculated battle power of the winner
    /// @param loserPower The calculated battle power of the loser
    event BattleResult(
        uint256 indexed battleId,
        address indexed winner,
        uint256 winnerPower,
        uint256 loserPower
    );

    /// @notice Emitted when a bet is placed on a battle
    /// @param battleId The unique battle identifier
    /// @param player The address of the player placing the bet
    /// @param amount The amount of ETH staked
    event BetPlaced(
        uint256 indexed battleId,
        address indexed player,
        uint256 amount
    );

    /// @notice Emitted when winnings are distributed to the winner
    /// @param battleId The unique battle identifier
    /// @param winner The address receiving the winnings
    /// @param amount The total amount distributed (after fees)
    event WinningsDistributed(
        uint256 indexed battleId,
        address indexed winner,
        uint256 amount
    );

    /// @notice Emitted when betting fee is updated
    /// @param oldFee The previous fee in basis points
    /// @param newFee The new fee in basis points
    event BettingFeeUpdated(uint256 oldFee, uint256 newFee);

    /// @notice Emitted when fee recipient is updated
    /// @param oldRecipient The previous fee recipient address
    /// @param newRecipient The new fee recipient address
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    /// @notice Emitted when fees are withdrawn
    /// @param recipient The address receiving the fees
    /// @param amount The amount withdrawn
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================

    /// @notice Reference to the PokeDEX card contract
    PokeDEXCard public immutable cardContract;

    /// @notice Battle counter
    uint256 private _battleIdCounter;

    /// @notice Mapping from battle ID to battle data
    mapping(uint256 => Battle) public battles;

    /// @notice Mapping from player to their stats
    mapping(address => PlayerStats) public playerStats;

    /// @notice Mapping from player to their active challenges (as challenger)
    mapping(address => uint256[]) public activeChallenges;

    /// @notice Mapping from player to challenges against them
    mapping(address => uint256[]) public pendingChallenges;

    /// @notice Experience reward for winning
    uint32 public winnerExpReward = 100;

    /// @notice Experience reward for losing
    uint32 public loserExpReward = 25;

    /// @notice Challenge timeout duration (24 hours)
    uint256 public challengeTimeout = 24 hours;

    /// @notice Type effectiveness matrix
    /// @dev 0 = normal (1x), 1 = super effective (2x), 2 = not very effective (0.5x), 3 = immune (0x)
    mapping(IPokeDEXCard.PokemonType => mapping(IPokeDEXCard.PokemonType => uint8))
        public typeChart;

    /// @notice Leaderboard tracking
    address[] public leaderboardAddresses;

    /// @notice Player position in leaderboard (1-indexed, 0 = not in leaderboard)
    mapping(address => uint256) public leaderboardPosition;

    // =============================================================================
    // BETTING SYSTEM
    // =============================================================================

    /// @notice Mapping from battle ID to bet data
    mapping(uint256 => BattleBet) public battleBets;

    /// @notice Betting fee in basis points (500 = 5%)
    uint256 public bettingFee = 500;

    /// @notice Fee recipient for betting fees
    address public feeRecipient;

    /// @notice Total fees collected
    uint256 public totalFeesCollected;

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER
    // =============================================================================

    /// @notice Pending admin address for two-step transfer
    address private _pendingAdmin;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @notice Contract constructor
     * @dev Initializes the card contract reference, grants admin roles, and sets up the type chart
     * @param _cardContract Address of PokeDEXCard contract
     * @param admin Admin address that will receive DEFAULT_ADMIN_ROLE and REWARDS_ROLE
     */
    constructor(address _cardContract, address admin) {
        require(_cardContract != address(0), "Invalid card contract");
        require(admin != address(0), "Invalid admin");

        cardContract = PokeDEXCard(_cardContract);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REWARDS_ROLE, admin);

        feeRecipient = admin;

        // Initialize type chart
        _initializeTypeChart();
    }

    // =============================================================================
    // CHALLENGE FUNCTIONS
    // =============================================================================

    /**
     * @notice Create a battle challenge against another player
     * @dev Creates a pending battle that the opponent can accept or that expires after challengeTimeout
     * @param opponent Opponent's address (cannot be msg.sender or zero address)
     * @param cardId Challenger's card token ID (must be owned by msg.sender)
     * @return battleId The unique identifier for the created battle
     */
    function createChallenge(address opponent, uint256 cardId)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        require(opponent != address(0), "Invalid opponent");
        require(opponent != msg.sender, "Cannot challenge yourself");
        require(
            cardContract.ownerOf(cardId) == msg.sender,
            "Not card owner"
        );

        uint256 battleId = ++_battleIdCounter;

        require(cardId <= type(uint48).max, "Card ID too large");

        battles[battleId] = Battle({
            challenger: msg.sender,
            createdAt: uint48(block.timestamp),
            status: BattleStatus.Pending,
            opponent: opponent,
            completedAt: 0,
            challengerCardId: uint48(cardId),
            winner: address(0),
            opponentCardId: 0,
            battleId: battleId
        });

        activeChallenges[msg.sender].push(battleId);
        pendingChallenges[opponent].push(battleId);

        emit BattleCreated(battleId, msg.sender, opponent, cardId);
        emit ChallengeCreated(battleId, msg.sender, opponent, cardId);

        return battleId;
    }

    /**
     * @notice Accept a battle challenge and immediately execute the battle
     * @dev Validates ownership, timeout, and executes battle with type advantages
     * @param battleId Battle ID to accept (must be pending and not expired)
     * @param cardId Opponent's card token ID (must be owned by msg.sender)
     
    function acceptChallenge(uint256 battleId, uint256 cardId)
        external
        override
        nonReentrant
        whenNotPaused
    {
        Battle storage battle = battles[battleId];

        require(battle.status == BattleStatus.Pending, "Battle not pending");
        require(battle.opponent == msg.sender, "Not the opponent");
        require(
            cardContract.ownerOf(cardId) == msg.sender,
            "Not card owner"
        );
        require(
            block.timestamp <= uint256(battle.createdAt) + challengeTimeout,
            "Challenge expired"
        );

        // Verify challenger still owns their card
        require(
            cardContract.ownerOf(uint256(battle.challengerCardId)) == battle.challenger,
            "Challenger no longer owns card"
        );

        require(cardId <= type(uint48).max, "Card ID too large");
        battle.opponentCardId = uint48(cardId);
        battle.status = BattleStatus.Active;

        emit BattleAccepted(battleId, msg.sender, cardId);
        emit ChallengeAccepted(battleId, msg.sender, cardId);

        // Execute battle immediately
        _executeBattle(battleId);
    }*/

    /**
     * @notice Cancel a pending challenge
     * @dev Can be cancelled by challenger anytime, or by anyone after timeout expires.
     *      Follows CEI pattern for reentrancy safety.
     * @param battleId Battle ID to cancel (must be pending)
     */
    function cancelChallenge(uint256 battleId)
        external
        override
        nonReentrant
    {
        Battle storage battle = battles[battleId];

        require(battle.status == BattleStatus.Pending, "Battle not pending");
        require(
            battle.challenger == msg.sender ||
            block.timestamp > uint256(battle.createdAt) + challengeTimeout,
            "Cannot cancel"
        );

        // CHECKS-EFFECTS-INTERACTIONS PATTERN
        // Cache values before state changes for the external call
        BattleBet storage bet = battleBets[battleId];
        bool shouldRefund = bet.bettingEnabled && bet.challengerStake > 0 && !bet.paid;
        uint256 refundAmount = bet.challengerStake;
        address refundRecipient = battle.challenger;

        // EFFECTS: Update all state BEFORE any external calls
        battle.status = BattleStatus.Cancelled;

        if (shouldRefund) {
            bet.paid = true;
        }

        _removeFromArray(activeChallenges[battle.challenger], battleId);
        _removeFromArray(pendingChallenges[battle.opponent], battleId);

        emit BattleCancelled(battleId);

        // INTERACTIONS: External call LAST
        if (shouldRefund) {
            (bool success, ) = payable(refundRecipient).call{value: refundAmount}("");
            require(success, "Refund failed");
        }
    }

    // =============================================================================
    // BETTING FUNCTIONS
    // =============================================================================

    /**
     * @notice Create a battle challenge with ETH betting stake
     * @dev Creates a betting battle where opponent must match the stake to accept
     * @param opponent Opponent's address (cannot be msg.sender or zero address)
     * @param cardId Challenger's card token ID (must be owned by msg.sender)
     * @return battleId The unique identifier for the created battle
     */
    function createChallengeWithBet(address opponent, uint256 cardId)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        require(msg.value >= MIN_BET, "Stake below minimum");
        require(msg.value <= MAX_BET, "Stake above maximum");
        require(opponent != address(0), "Invalid opponent");
        require(opponent != msg.sender, "Cannot challenge yourself");
        require(cardContract.ownerOf(cardId) == msg.sender, "Not card owner");

        uint256 battleId = ++_battleIdCounter;
        require(cardId <= type(uint48).max, "Card ID too large");

        battles[battleId] = Battle({
            challenger: msg.sender,
            createdAt: uint48(block.timestamp),
            status: BattleStatus.Pending,
            opponent: opponent,
            completedAt: 0,
            challengerCardId: uint48(cardId),
            winner: address(0),
            opponentCardId: 0,
            battleId: battleId
        });

        battleBets[battleId] = BattleBet({
            challengerStake: msg.value,
            opponentStake: 0,
            bettingEnabled: true,
            paid: false
        });

        activeChallenges[msg.sender].push(battleId);
        pendingChallenges[opponent].push(battleId);

        emit BattleCreated(battleId, msg.sender, opponent, cardId);
        emit ChallengeCreated(battleId, msg.sender, opponent, cardId);
        emit BattleBetCreated(battleId, msg.sender, msg.value);
        emit BetPlaced(battleId, msg.sender, msg.value);

        return battleId;
    }

    /**
     * @notice Accept a battle challenge with matching stake
     * @dev Must send exactly the same amount as challenger's stake
     * @param battleId Battle ID to accept (must be pending betting battle)
     * @param cardId Opponent's card token ID (must be owned by msg.sender)
     
    function acceptChallengeWithBet(uint256 battleId, uint256 cardId)
        external
        payable
        override
        nonReentrant
        whenNotPaused
    {
        Battle storage battle = battles[battleId];
        BattleBet storage bet = battleBets[battleId];

        require(battle.status == BattleStatus.Pending, "Battle not pending");
        require(battle.opponent == msg.sender, "Not the opponent");
        require(bet.bettingEnabled, "Not a betting battle");
        require(msg.value == bet.challengerStake, "Must match challenger stake");
        require(cardContract.ownerOf(cardId) == msg.sender, "Not card owner");
        require(
            block.timestamp <= uint256(battle.createdAt) + challengeTimeout,
            "Challenge expired"
        );
        require(
            cardContract.ownerOf(uint256(battle.challengerCardId)) == battle.challenger,
            "Challenger no longer owns card"
        );

        require(cardId <= type(uint48).max, "Card ID too large");
        bet.opponentStake = msg.value;
        battle.opponentCardId = uint48(cardId);
        battle.status = BattleStatus.Active;

        emit BattleAccepted(battleId, msg.sender, cardId);
        emit ChallengeAccepted(battleId, msg.sender, cardId);
        emit BetPlaced(battleId, msg.sender, msg.value);

        // Execute battle and distribute payouts
        _executeBattleWithBetting(battleId);
    }*/

    /**
     * @notice Get battle bet details
     * @dev Returns the BattleBet struct for a given battle
     * @param battleId Battle ID to query
     * @return The BattleBet struct containing stake and payout information
     */
    function getBattleBet(uint256 battleId)
        external
        view
        override
        returns (BattleBet memory)
    {
        return battleBets[battleId];
    }

    /**
     * @notice Set betting fee (only admin)
     * @dev Fee is in basis points (100 = 1%, max 1000 = 10%)
     * @param newFee Fee in basis points
     */
    function setBettingFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFee <= 1000, "Fee too high"); // Max 10%
        uint256 oldFee = bettingFee;
        bettingFee = newFee;
        emit BettingFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Set fee recipient address
     * @dev Only admin can update the fee recipient
     * @param newRecipient New fee recipient address (cannot be zero)
     */
    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "Invalid recipient");
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @notice Withdraw collected fees to fee recipient
     * @dev Only admin can withdraw, follows CEI pattern
     */
    function withdrawFees() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 amount = totalFeesCollected;
        require(amount > 0, "No fees to withdraw");

        address recipient = feeRecipient;
        totalFeesCollected = 0;

        emit FeesWithdrawn(recipient, amount);

        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "Withdraw failed");
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get battle details by ID
     * @param battleId Battle ID to query
     * @return The Battle struct containing all battle information
     */
    function getBattle(uint256 battleId)
        external
        view
        override
        returns (Battle memory)
    {
        return battles[battleId];
    }

    /**
     * @notice Get player stats
     * @param player Player address to query
     * @return The PlayerStats struct containing wins, losses, streaks, etc.
     */
    function getPlayerStats(address player)
        external
        view
        override
        returns (PlayerStats memory)
    {
        return playerStats[player];
    }

    /**
     * @notice Get leaderboard with limit
     * @dev Returns top players sorted by wins
     * @param limit Maximum number of entries to return
     * @return addresses Array of player addresses
     * @return wins Array of corresponding win counts
     */
    function getLeaderboard(uint256 limit)
        external
        view
        override
        returns (address[] memory addresses, uint256[] memory wins)
    {
        uint256 count = limit < leaderboardAddresses.length
            ? limit
            : leaderboardAddresses.length;

        addresses = new address[](count);
        wins = new uint256[](count);

        // Simple copy (already sorted by insertion)
        for (uint256 i = 0; i < count; i++) {
            addresses[i] = leaderboardAddresses[i];
            wins[i] = playerStats[leaderboardAddresses[i]].wins;
        }

        return (addresses, wins);
    }

    /**
     * @notice Get player's pending challenges (returns all - use paginated version for large lists)
     * @dev WARNING: Can cause DoS if array is very large. Use getPlayerPendingChallengesPaginated for safety.
     * @param player Player address
     * @return Array of battle IDs
     */
    function getPlayerPendingChallenges(address player)
        external
        view
        returns (uint256[] memory)
    {
        return pendingChallenges[player];
    }

    /**
     * @notice Get player's pending challenges with pagination to prevent DoS
     * @dev Returns a slice of the pending challenges array
     * @param player Player address to query
     * @param offset Starting index (0-based)
     * @param limit Maximum number of entries to return (capped at DEFAULT_PAGINATION_LIMIT)
     * @return battleIds Array of battle IDs
     * @return total Total number of pending challenges for the player
     */
    function getPlayerPendingChallengesPaginated(
        address player,
        uint256 offset,
        uint256 limit
    )
        external
        view
        returns (uint256[] memory battleIds, uint256 total)
    {
        uint256[] storage challenges = pendingChallenges[player];
        total = challenges.length;

        if (offset >= total) {
            return (new uint256[](0), total);
        }

        if (limit > DEFAULT_PAGINATION_LIMIT) {
            limit = DEFAULT_PAGINATION_LIMIT;
        }

        uint256 remaining = total - offset;
        uint256 count = remaining < limit ? remaining : limit;

        battleIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            battleIds[i] = challenges[offset + i];
        }

        return (battleIds, total);
    }

    /**
     * @notice Get player's active challenges as challenger (returns all - use paginated version for large lists)
     * @dev WARNING: Can cause DoS if array is very large. Use getPlayerActiveChallengesPaginated for safety.
     * @param player Player address
     * @return Array of battle IDs
     */
    function getPlayerActiveChallenges(address player)
        external
        view
        returns (uint256[] memory)
    {
        return activeChallenges[player];
    }

    /**
     * @notice Get player's active challenges (as challenger) with pagination to prevent DoS
     * @dev Returns a slice of the active challenges array
     * @param player Player address to query
     * @param offset Starting index (0-based)
     * @param limit Maximum number of entries to return (capped at DEFAULT_PAGINATION_LIMIT)
     * @return battleIds Array of battle IDs
     * @return total Total number of active challenges for the player
     */
    function getPlayerActiveChallengesPaginated(
        address player,
        uint256 offset,
        uint256 limit
    )
        external
        view
        returns (uint256[] memory battleIds, uint256 total)
    {
        uint256[] storage challenges = activeChallenges[player];
        total = challenges.length;

        if (offset >= total) {
            return (new uint256[](0), total);
        }

        if (limit > DEFAULT_PAGINATION_LIMIT) {
            limit = DEFAULT_PAGINATION_LIMIT;
        }

        uint256 remaining = total - offset;
        uint256 count = remaining < limit ? remaining : limit;

        battleIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            battleIds[i] = challenges[offset + i];
        }

        return (battleIds, total);
    }

    /**
     * @notice Get the count of pending challenges for a player
     * @dev Useful for pagination - get total before fetching pages
     * @param player Player address to query
     * @return The number of pending challenges
     */
    function getPlayerPendingChallengesCount(address player)
        external
        view
        returns (uint256)
    {
        return pendingChallenges[player].length;
    }

    /**
     * @notice Get the count of active challenges for a player
     * @dev Useful for pagination - get total before fetching pages
     * @param player Player address to query
     * @return The number of active challenges
     */
    function getPlayerActiveChallengesCount(address player)
        external
        view
        returns (uint256)
    {
        return activeChallenges[player].length;
    }

    /**
     * @notice Verify that the contract has the required role on the card contract
     * @dev Checks if this contract has STATS_UPDATER_ROLE to award experience
     * @return True if this contract has STATS_UPDATER_ROLE on cardContract
     */
    function verifySetup() external view returns (bool) {
        bytes32 STATS_UPDATER_ROLE = keccak256("STATS_UPDATER_ROLE");
        return IAccessControl(address(cardContract)).hasRole(STATS_UPDATER_ROLE, address(this));
    }

    /**
     * @notice Get the current battle ID counter
     * @dev Useful for knowing how many battles have been created
     * @return The current battle ID counter value
     */
    function getBattleCount() external view returns (uint256) {
        return _battleIdCounter;
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Set experience rewards for battles
     * @dev Only REWARDS_ROLE can update experience values
     * @param _winnerExp Experience points awarded to winner
     * @param _loserExp Experience points awarded to loser
     */
    function setExpRewards(uint32 _winnerExp, uint32 _loserExp)
        external
        onlyRole(REWARDS_ROLE)
    {
        winnerExpReward = _winnerExp;
        loserExpReward = _loserExp;
        emit ExpRewardsUpdated(_winnerExp, _loserExp);
    }

    /**
     * @notice Set challenge timeout duration
     * @dev Only admin can update, minimum 1 hour
     * @param _timeout New timeout in seconds
     */
    function setChallengeTimeout(uint256 _timeout)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_timeout >= 1 hours, "Timeout too short");
        uint256 oldTimeout = challengeTimeout;
        challengeTimeout = _timeout;
        emit ChallengeTimeoutUpdated(oldTimeout, _timeout);
    }

    /**
     * @notice Pause the contract
     * @dev Only admin can pause, prevents new challenges and acceptances
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the contract
     * @dev Only admin can unpause
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================================
    // TWO-STEP ADMIN TRANSFER
    // =============================================================================

    /**
     * @notice Initiates admin transfer to a new address (step 1)
     * @dev Only callable by current admin. The new admin must call acceptAdminTransfer() to complete.
     * @param newAdmin The address to transfer admin role to
     */
    function initiateAdminTransfer(address newAdmin)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(newAdmin != address(0), "Invalid new admin");
        require(newAdmin != msg.sender, "Cannot transfer to self");
        _pendingAdmin = newAdmin;
        emit AdminTransferInitiated(msg.sender, newAdmin);
    }

    /**
     * @notice Completes admin transfer (step 2) - must be called by pending admin
     * @dev Grants DEFAULT_ADMIN_ROLE to pending admin and revokes from the initiating admin
     */
    function acceptAdminTransfer() external override {
        require(msg.sender == _pendingAdmin, "Not pending admin");
        require(_pendingAdmin != address(0), "No pending transfer");

        // Get current admins (there could be multiple, but we handle the common case)
        address pendingAdmin_ = _pendingAdmin;
        _pendingAdmin = address(0);

        // Grant role to new admin
        _grantRole(DEFAULT_ADMIN_ROLE, pendingAdmin_);
        _grantRole(REWARDS_ROLE, pendingAdmin_);

        // Note: The old admin should renounce their role separately if desired
        // This design allows for multi-sig scenarios where multiple admins exist

        emit AdminTransferCompleted(msg.sender, pendingAdmin_);
    }

    /**
     * @notice Cancels pending admin transfer
     * @dev Only callable by current admin
     */
    function cancelAdminTransfer()
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_pendingAdmin != address(0), "No pending transfer");
        address cancelledPending = _pendingAdmin;
        _pendingAdmin = address(0);
        emit AdminTransferCancelled(msg.sender, cancelledPending);
    }

    /**
     * @notice Get pending admin address
     * @return The address of the pending admin, or zero address if none
     */
    function pendingAdmin() external view override returns (address) {
        return _pendingAdmin;
    }

    // =============================================================================
    // INTERNAL BATTLE EXECUTION
    // =============================================================================

    

    /**
     * @dev Execute a battle and determine winner
     * @param battleId Battle ID to execute
     
    function _executeBattle(uint256 battleId) internal {
        Battle storage battle = battles[battleId];


        // Get card stats
        IPokeDEXCard.CardStats memory challengerStats =
            cardContract.getCardStats(battle.challengerCardId);
        IPokeDEXCard.CardStats memory opponentStats =
            cardContract.getCardStats(battle.opponentCardId);

        // Calculate battle power with type advantage
        uint256 challengerPower = _calculatePowerWithTypeAdvantage(
            battle.challengerCardId,
            challengerStats,
            opponentStats.pokemonType
        );
        uint256 opponentPower = _calculatePowerWithTypeAdvantage(
            battle.opponentCardId,
            opponentStats,
            challengerStats.pokemonType
        );

        // Store original powers for event
        uint256 originalChallengerPower = challengerPower;
        uint256 originalOpponentPower = opponentPower;

        // Add speed tiebreaker
        if (challengerPower == opponentPower) {
            challengerPower += challengerStats.speed;
            opponentPower += opponentStats.speed;
        }

        // Determine winner
        address winner;
        address loser;
        uint256 winnerCardId;
        uint256 loserCardId;
        uint256 winnerPower;
        uint256 loserPower;

        if (challengerPower >= opponentPower) {
            winner = battle.challenger;
            loser = battle.opponent;
            winnerCardId = battle.challengerCardId;
            loserCardId = battle.opponentCardId;
            winnerPower = originalChallengerPower;
            loserPower = originalOpponentPower;
        } else {
            winner = battle.opponent;
            loser = battle.challenger;
            winnerCardId = battle.opponentCardId;
            loserCardId = battle.challengerCardId;
            winnerPower = originalOpponentPower;
            loserPower = originalChallengerPower;
        }

        // Update battle state
        battle.winner = winner;
        battle.status = BattleStatus.Completed;
        battle.completedAt = uint48(block.timestamp);

        // Update player stats
        _updatePlayerStats(winner, loser);

        // Award experience (non-critical - use try-catch to not block battle completion)
        try cardContract.addExperience(winnerCardId, winnerExpReward) {} catch {}
        try cardContract.addExperience(loserCardId, loserExpReward) {} catch {}

        // Clean up pending/active arrays
        _removeFromArray(activeChallenges[battle.challenger], battleId);
        _removeFromArray(pendingChallenges[battle.opponent], battleId);

        emit BattleCompleted(battleId, winner, winnerCardId);
        emit BattleResult(battleId, winner, winnerPower, loserPower);
    }*/

    struct ExecuteBattleVars{
        uint256 challengerPower;
        uint256 opponentPower;
        uint256 originalChallengerPower;
        uint256 originalOpponentPower;
        address winner;
        address loser;
        uint256 winnerCardId;
        uint256 loserCardId;
        uint256 winnerPower;
        uint256 loserPower;
        uint256 totalPool;
        uint256 fee;
        uint256 payout;

    }

    /**
     * @dev Execute a battle with betting and distribute payouts
     * @param battleId Battle ID to execute
     * @notice Follows Checks-Effects-Interactions pattern for reentrancy safety
     
    function _executeBattleWithBetting(uint256 battleId) internal {
        Battle storage battle = battles[battleId];
        BattleBet storage bet = battleBets[battleId];

        ExecuteBattleVars memory executeBattleVars;

        // Get card stats
        IPokeDEXCard.CardStats memory challengerStats =
            cardContract.getCardStats(battle.challengerCardId);
        IPokeDEXCard.CardStats memory opponentStats =
            cardContract.getCardStats(battle.opponentCardId);

        // Calculate battle power with type advantage and metrics
        executeBattleVars.challengerPower = _calculatePowerWithMetrics(
            battle.challengerCardId,
            challengerStats,
            opponentStats.pokemonType
        );
        executeBattleVars.opponentPower = _calculatePowerWithMetrics(
            battle.opponentCardId,
            opponentStats,
            challengerStats.pokemonType
        );

        // Store original powers for event
        executeBattleVars.originalChallengerPower = executeBattleVars.challengerPower;
        executeBattleVars.originalOpponentPower = executeBattleVars.opponentPower;

        // Deterministic tiebreaker: speed first, then card age (lower ID = older = wins)
        // Note: This is intentionally deterministic to prevent miner manipulation.
        // For randomized outcomes with high stakes, integrate VRF/QRNG.
        if (executeBattleVars.challengerPower == executeBattleVars.opponentPower) {
            // First tiebreaker: speed stat
            if (challengerStats.speed != opponentStats.speed) {
                executeBattleVars.challengerPower += challengerStats.speed;
                executeBattleVars.opponentPower += opponentStats.speed;
            } else {
                // Second tiebreaker: older card (lower ID) wins
                // This rewards early adopters and is fully predictable
                if (battle.challengerCardId < battle.opponentCardId) {
                    executeBattleVars.challengerPower += 1;
                } else {
                    executeBattleVars.opponentPower += 1;
                }
            }
        }

        // Determine winner
        if (executeBattleVars.challengerPower >= executeBattleVars.opponentPower) {
            executeBattleVars.winner = battle.challenger;
            executeBattleVars.loser = battle.opponent;
            executeBattleVars.winnerCardId = battle.challengerCardId;
            executeBattleVars.loserCardId = battle.opponentCardId;
            executeBattleVars.winnerPower = executeBattleVars.originalChallengerPower;
            executeBattleVars.loserPower = executeBattleVars.originalOpponentPower;
        } else {
            executeBattleVars.winner = battle.opponent;
            executeBattleVars.loser = battle.challenger;
            executeBattleVars.winnerCardId = battle.opponentCardId;
            executeBattleVars.loserCardId = battle.challengerCardId;
            executeBattleVars.winnerPower = executeBattleVars.originalOpponentPower;
            executeBattleVars.loserPower = executeBattleVars.originalChallengerPower;
        }

        // Calculate payout before state changes
        executeBattleVars.totalPool = bet.challengerStake + bet.opponentStake;
        executeBattleVars.fee = (executeBattleVars.totalPool * bettingFee) / 10000;
        executeBattleVars.payout = executeBattleVars.totalPool - executeBattleVars.fee;

        // EFFECTS: Update ALL state BEFORE any external calls
        battle.winner = executeBattleVars.winner;
        battle.status = BattleStatus.Completed;
        battle.completedAt = uint48(block.timestamp);
        bet.paid = true;
        totalFeesCollected += executeBattleVars.fee;

        // Update player stats
        _updatePlayerStats(executeBattleVars.winner, executeBattleVars.loser);

        // Clean up pending/active arrays
        _removeFromArray(activeChallenges[battle.challenger], battleId);
        _removeFromArray(pendingChallenges[battle.opponent], battleId);

        // Emit events before external calls
        emit BattleCompleted(battleId, executeBattleVars.winner, executeBattleVars.winnerCardId);
        emit BattleResult(battleId, executeBattleVars.winner, executeBattleVars.winnerPower, executeBattleVars.loserPower);
        emit BattlePayout(battleId, executeBattleVars.winner, executeBattleVars.payout, executeBattleVars.fee);
        emit WinningsDistributed(battleId, executeBattleVars.winner, executeBattleVars.payout);

        // INTERACTIONS: External calls LAST
        // Pay winner first (critical - must succeed)
        (bool success, ) = payable(executeBattleVars.winner).call{value: executeBattleVars.payout}("");
        require(success, "Payout failed");

        // Experience rewards (non-critical - use try-catch to not block payouts)
        // Experience can fail if card is burned or at max level, but payout is already done
        try cardContract.addExperience(executeBattleVars.winnerCardId, winnerExpReward) {
            // Success - experience added
        } catch {
            // Silently fail - payout already done, experience is bonus
        }

        try cardContract.addExperience(executeBattleVars.loserCardId, loserExpReward) {
            // Success - experience added
        } catch {
            // Silently fail - card might be burned or at max level
        }
    }*/

    // =============================================================================
    // INTERNAL HELPER FUNCTIONS
    // =============================================================================

    /**
     * @dev Calculate power with type advantage and trade metrics
     * @param cardId Card token ID
     * @param stats Card stats
     * @param defenderType Defender's Pokemon type
     * @return Modified battle power with metrics
     
    function _calculatePowerWithMetrics(
        uint256 cardId,
        IPokeDEXCard.CardStats memory stats,
        IPokeDEXCard.PokemonType defenderType
    ) internal view returns (uint256) {
        // Try to use the new metrics-based calculation
        try cardContract.calculateBattlePowerWithMetrics(cardId) returns (uint256 power) {
            uint8 effectiveness = typeChart[stats.pokemonType][defenderType];
            if (effectiveness == 1) {
                return (power * 200) / 100;
            } else if (effectiveness == 2) {
                return (power * 50) / 100;
            } else if (effectiveness == 3) {
                return 0;
            }
            return power;
        } catch {
            // Fallback to basic calculation
            return _calculatePowerWithTypeAdvantage(cardId, stats, defenderType);
        }
    }
*/
    /**
     * @dev Calculate power with type advantage modifier
     * @param cardId Card token ID
     * @param stats Card stats
     * @param defenderType Defender's Pokemon type
     * @return Modified battle power
     
    function _calculatePowerWithTypeAdvantage(
        uint256 cardId,
        IPokeDEXCard.CardStats memory stats,
        IPokeDEXCard.PokemonType defenderType
    ) internal view returns (uint256) {
        uint256 basePower = cardContract.calculateBattlePower(cardId);

        // Get type effectiveness
        uint8 effectiveness = typeChart[stats.pokemonType][defenderType];

        // Apply type modifier
        if (effectiveness == 1) {
            return (basePower * 200) / 100; // Super effective: 2x
        } else if (effectiveness == 2) {
            return (basePower * 50) / 100; // Not very effective: 0.5x
        } else if (effectiveness == 3) {
            return 0; // Immune
        }

        return basePower; // Normal: 1x
    }
*/
    /**
     * @dev Update player statistics after battle
     * @param winner Winner address
     * @param loser Loser address
     */
    function _updatePlayerStats(address winner, address loser) internal {
        // Update winner
        PlayerStats storage winnerStats = playerStats[winner];
        winnerStats.wins++;
        winnerStats.totalBattles++;
        winnerStats.currentStreak++;
        if (winnerStats.currentStreak > winnerStats.bestStreak) {
            winnerStats.bestStreak = winnerStats.currentStreak;
        }

        // Update loser
        PlayerStats storage loserStats = playerStats[loser];
        loserStats.losses++;
        loserStats.totalBattles++;
        loserStats.currentStreak = 0;

        // Update leaderboard
        _updateLeaderboard(winner);
        _updateLeaderboard(loser);
    }

    /**
     * @dev Update leaderboard position for a player (capped at MAX_LEADERBOARD_SIZE)
     * @param player Player address
     */
    function _updateLeaderboard(address player) internal {
        uint256 wins = playerStats[player].wins;
        uint256 currentPos = leaderboardPosition[player];

        if (currentPos > 0) {
            // Already in leaderboard - bubble up if needed
            uint256 index = currentPos - 1; // Convert to 0-indexed
            while (
                index > 0 &&
                playerStats[leaderboardAddresses[index - 1]].wins < wins
            ) {
                // Swap with previous
                address prev = leaderboardAddresses[index - 1];
                leaderboardAddresses[index - 1] = player;
                leaderboardAddresses[index] = prev;
                leaderboardPosition[player] = index; // index is now 0-indexed position
                leaderboardPosition[prev] = index + 1;
                index--;
            }
            leaderboardPosition[player] = index + 1; // Convert back to 1-indexed
        } else if (leaderboardAddresses.length < MAX_LEADERBOARD_SIZE) {
            // Not in leaderboard and space available - add to end
            leaderboardAddresses.push(player);
            leaderboardPosition[player] = leaderboardAddresses.length;
            _bubbleUpLeaderboard(leaderboardAddresses.length - 1);
        } else if (wins > playerStats[leaderboardAddresses[MAX_LEADERBOARD_SIZE - 1]].wins) {
            // Replace last position if player has more wins
            address removed = leaderboardAddresses[MAX_LEADERBOARD_SIZE - 1];
            leaderboardPosition[removed] = 0;
            leaderboardAddresses[MAX_LEADERBOARD_SIZE - 1] = player;
            leaderboardPosition[player] = MAX_LEADERBOARD_SIZE;
            _bubbleUpLeaderboard(MAX_LEADERBOARD_SIZE - 1);
        }
    }

    /**
     * @dev Bubble up a player from given index to correct position
     * @param index Starting index (0-indexed)
     */
    function _bubbleUpLeaderboard(uint256 index) internal {
        address player = leaderboardAddresses[index];
        uint256 wins = playerStats[player].wins;

        while (
            index > 0 &&
            playerStats[leaderboardAddresses[index - 1]].wins < wins
        ) {
            address prev = leaderboardAddresses[index - 1];
            leaderboardAddresses[index - 1] = player;
            leaderboardAddresses[index] = prev;
            leaderboardPosition[prev] = index + 1;
            index--;
        }
        leaderboardPosition[player] = index + 1;
    }

    /**
     * @dev Remove element from array using swap and pop
     * @param arr Array to modify
     * @param element Element to remove
     */
    function _removeFromArray(uint256[] storage arr, uint256 element) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == element) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                break;
            }
        }
    }

    /**
     * @dev Initialize the Pokemon type effectiveness chart
     * @notice Simplified version with key type matchups
     */
    function _initializeTypeChart() internal {
        // Fire type matchups
        typeChart[IPokeDEXCard.PokemonType.Fire][IPokeDEXCard.PokemonType.Grass] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fire][IPokeDEXCard.PokemonType.Ice] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fire][IPokeDEXCard.PokemonType.Bug] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fire][IPokeDEXCard.PokemonType.Steel] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fire][IPokeDEXCard.PokemonType.Water] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fire][IPokeDEXCard.PokemonType.Rock] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fire][IPokeDEXCard.PokemonType.Dragon] = 2;

        // Water type matchups
        typeChart[IPokeDEXCard.PokemonType.Water][IPokeDEXCard.PokemonType.Fire] = 1;
        typeChart[IPokeDEXCard.PokemonType.Water][IPokeDEXCard.PokemonType.Ground] = 1;
        typeChart[IPokeDEXCard.PokemonType.Water][IPokeDEXCard.PokemonType.Rock] = 1;
        typeChart[IPokeDEXCard.PokemonType.Water][IPokeDEXCard.PokemonType.Grass] = 2;
        typeChart[IPokeDEXCard.PokemonType.Water][IPokeDEXCard.PokemonType.Dragon] = 2;

        // Grass type matchups
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Water] = 1;
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Ground] = 1;
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Rock] = 1;
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Fire] = 2;
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Poison] = 2;
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Flying] = 2;
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Bug] = 2;
        typeChart[IPokeDEXCard.PokemonType.Grass][IPokeDEXCard.PokemonType.Steel] = 2;

        // Electric type matchups
        typeChart[IPokeDEXCard.PokemonType.Electric][IPokeDEXCard.PokemonType.Water] = 1;
        typeChart[IPokeDEXCard.PokemonType.Electric][IPokeDEXCard.PokemonType.Flying] = 1;
        typeChart[IPokeDEXCard.PokemonType.Electric][IPokeDEXCard.PokemonType.Grass] = 2;
        typeChart[IPokeDEXCard.PokemonType.Electric][IPokeDEXCard.PokemonType.Dragon] = 2;
        typeChart[IPokeDEXCard.PokemonType.Electric][IPokeDEXCard.PokemonType.Ground] = 3;

        // Ground type matchups
        typeChart[IPokeDEXCard.PokemonType.Ground][IPokeDEXCard.PokemonType.Fire] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ground][IPokeDEXCard.PokemonType.Electric] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ground][IPokeDEXCard.PokemonType.Poison] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ground][IPokeDEXCard.PokemonType.Rock] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ground][IPokeDEXCard.PokemonType.Steel] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ground][IPokeDEXCard.PokemonType.Grass] = 2;
        typeChart[IPokeDEXCard.PokemonType.Ground][IPokeDEXCard.PokemonType.Flying] = 3;

        // Fighting type matchups
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Normal] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Ice] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Rock] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Dark] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Steel] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Poison] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Flying] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Psychic] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Fairy] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fighting][IPokeDEXCard.PokemonType.Ghost] = 3;

        // Psychic type matchups
        typeChart[IPokeDEXCard.PokemonType.Psychic][IPokeDEXCard.PokemonType.Fighting] = 1;
        typeChart[IPokeDEXCard.PokemonType.Psychic][IPokeDEXCard.PokemonType.Poison] = 1;
        typeChart[IPokeDEXCard.PokemonType.Psychic][IPokeDEXCard.PokemonType.Steel] = 2;
        typeChart[IPokeDEXCard.PokemonType.Psychic][IPokeDEXCard.PokemonType.Dark] = 3;

        // Ghost type matchups
        typeChart[IPokeDEXCard.PokemonType.Ghost][IPokeDEXCard.PokemonType.Psychic] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ghost][IPokeDEXCard.PokemonType.Ghost] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ghost][IPokeDEXCard.PokemonType.Dark] = 2;
        typeChart[IPokeDEXCard.PokemonType.Ghost][IPokeDEXCard.PokemonType.Normal] = 3;

        // Dragon type matchups
        typeChart[IPokeDEXCard.PokemonType.Dragon][IPokeDEXCard.PokemonType.Dragon] = 1;
        typeChart[IPokeDEXCard.PokemonType.Dragon][IPokeDEXCard.PokemonType.Steel] = 2;
        typeChart[IPokeDEXCard.PokemonType.Dragon][IPokeDEXCard.PokemonType.Fairy] = 3;

        // Dark type matchups
        typeChart[IPokeDEXCard.PokemonType.Dark][IPokeDEXCard.PokemonType.Psychic] = 1;
        typeChart[IPokeDEXCard.PokemonType.Dark][IPokeDEXCard.PokemonType.Ghost] = 1;
        typeChart[IPokeDEXCard.PokemonType.Dark][IPokeDEXCard.PokemonType.Fighting] = 2;
        typeChart[IPokeDEXCard.PokemonType.Dark][IPokeDEXCard.PokemonType.Fairy] = 2;

        // Fairy type matchups
        typeChart[IPokeDEXCard.PokemonType.Fairy][IPokeDEXCard.PokemonType.Fighting] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fairy][IPokeDEXCard.PokemonType.Dragon] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fairy][IPokeDEXCard.PokemonType.Dark] = 1;
        typeChart[IPokeDEXCard.PokemonType.Fairy][IPokeDEXCard.PokemonType.Fire] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fairy][IPokeDEXCard.PokemonType.Poison] = 2;
        typeChart[IPokeDEXCard.PokemonType.Fairy][IPokeDEXCard.PokemonType.Steel] = 2;

        // Steel type matchups
        typeChart[IPokeDEXCard.PokemonType.Steel][IPokeDEXCard.PokemonType.Ice] = 1;
        typeChart[IPokeDEXCard.PokemonType.Steel][IPokeDEXCard.PokemonType.Rock] = 1;
        typeChart[IPokeDEXCard.PokemonType.Steel][IPokeDEXCard.PokemonType.Fairy] = 1;
        typeChart[IPokeDEXCard.PokemonType.Steel][IPokeDEXCard.PokemonType.Fire] = 2;
        typeChart[IPokeDEXCard.PokemonType.Steel][IPokeDEXCard.PokemonType.Water] = 2;
        typeChart[IPokeDEXCard.PokemonType.Steel][IPokeDEXCard.PokemonType.Electric] = 2;

        // Ice type matchups
        typeChart[IPokeDEXCard.PokemonType.Ice][IPokeDEXCard.PokemonType.Grass] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ice][IPokeDEXCard.PokemonType.Ground] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ice][IPokeDEXCard.PokemonType.Flying] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ice][IPokeDEXCard.PokemonType.Dragon] = 1;
        typeChart[IPokeDEXCard.PokemonType.Ice][IPokeDEXCard.PokemonType.Fire] = 2;
        typeChart[IPokeDEXCard.PokemonType.Ice][IPokeDEXCard.PokemonType.Water] = 2;
        typeChart[IPokeDEXCard.PokemonType.Ice][IPokeDEXCard.PokemonType.Steel] = 2;

        // Flying type matchups
        typeChart[IPokeDEXCard.PokemonType.Flying][IPokeDEXCard.PokemonType.Grass] = 1;
        typeChart[IPokeDEXCard.PokemonType.Flying][IPokeDEXCard.PokemonType.Fighting] = 1;
        typeChart[IPokeDEXCard.PokemonType.Flying][IPokeDEXCard.PokemonType.Bug] = 1;
        typeChart[IPokeDEXCard.PokemonType.Flying][IPokeDEXCard.PokemonType.Electric] = 2;
        typeChart[IPokeDEXCard.PokemonType.Flying][IPokeDEXCard.PokemonType.Rock] = 2;
        typeChart[IPokeDEXCard.PokemonType.Flying][IPokeDEXCard.PokemonType.Steel] = 2;

        // Poison type matchups
        typeChart[IPokeDEXCard.PokemonType.Poison][IPokeDEXCard.PokemonType.Grass] = 1;
        typeChart[IPokeDEXCard.PokemonType.Poison][IPokeDEXCard.PokemonType.Fairy] = 1;
        typeChart[IPokeDEXCard.PokemonType.Poison][IPokeDEXCard.PokemonType.Poison] = 2;
        typeChart[IPokeDEXCard.PokemonType.Poison][IPokeDEXCard.PokemonType.Ground] = 2;
        typeChart[IPokeDEXCard.PokemonType.Poison][IPokeDEXCard.PokemonType.Rock] = 2;
        typeChart[IPokeDEXCard.PokemonType.Poison][IPokeDEXCard.PokemonType.Ghost] = 2;
        typeChart[IPokeDEXCard.PokemonType.Poison][IPokeDEXCard.PokemonType.Steel] = 3;

        // Bug type matchups
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Grass] = 1;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Psychic] = 1;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Dark] = 1;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Fire] = 2;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Fighting] = 2;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Poison] = 2;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Flying] = 2;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Ghost] = 2;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Steel] = 2;
        typeChart[IPokeDEXCard.PokemonType.Bug][IPokeDEXCard.PokemonType.Fairy] = 2;

        // Rock type matchups
        typeChart[IPokeDEXCard.PokemonType.Rock][IPokeDEXCard.PokemonType.Fire] = 1;
        typeChart[IPokeDEXCard.PokemonType.Rock][IPokeDEXCard.PokemonType.Ice] = 1;
        typeChart[IPokeDEXCard.PokemonType.Rock][IPokeDEXCard.PokemonType.Flying] = 1;
        typeChart[IPokeDEXCard.PokemonType.Rock][IPokeDEXCard.PokemonType.Bug] = 1;
        typeChart[IPokeDEXCard.PokemonType.Rock][IPokeDEXCard.PokemonType.Fighting] = 2;
        typeChart[IPokeDEXCard.PokemonType.Rock][IPokeDEXCard.PokemonType.Ground] = 2;
        typeChart[IPokeDEXCard.PokemonType.Rock][IPokeDEXCard.PokemonType.Steel] = 2;

        // Normal type - no super effective, immune to Ghost
        typeChart[IPokeDEXCard.PokemonType.Normal][IPokeDEXCard.PokemonType.Rock] = 2;
        typeChart[IPokeDEXCard.PokemonType.Normal][IPokeDEXCard.PokemonType.Steel] = 2;
        typeChart[IPokeDEXCard.PokemonType.Normal][IPokeDEXCard.PokemonType.Ghost] = 3;
    }
}
