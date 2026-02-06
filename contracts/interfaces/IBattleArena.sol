// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBattleArena
 * @author PokeDEX Team
 * @notice Interface for the PvP Battle Arena contract
 * @dev Turn-based battles with type advantages, stat calculations, and optional betting
 */
interface IBattleArena {
    // =============================================================================
    // ENUMS
    // =============================================================================

    /// @notice Battle status enum tracking the lifecycle of a battle
    enum BattleStatus {
        Pending,    // Challenge created, waiting for acceptance
        Active,     // Battle in progress
        Completed,  // Battle finished
        Cancelled   // Battle cancelled
    }

    // =============================================================================
    // STRUCTS
    // =============================================================================

    /// @notice Battle structure (optimized: 4 storage slots instead of 8)
    /// @dev Packed for gas efficiency using smaller uint types
    struct Battle {
        // Slot 1: address (20) + uint48 (6) + BattleStatus (1) = 27 bytes
        address challenger;
        uint48 createdAt;
        BattleStatus status;

        // Slot 2: address (20) + uint48 (6) + uint48 (6) = 32 bytes
        address opponent;
        uint48 completedAt;
        uint48 challengerCardId;

        // Slot 3: address (20) + uint48 (6) = 26 bytes
        address winner;
        uint48 opponentCardId;

        // Slot 4: battleId kept as uint256 for compatibility
        uint256 battleId;
    }

    /// @notice Player stats structure (optimized: 1 storage slot instead of 5)
    /// @dev All stats packed into a single 256-bit slot
    struct PlayerStats {
        uint64 wins;
        uint64 losses;
        uint64 totalBattles;
        uint32 currentStreak;
        uint32 bestStreak;
    }

    /// @notice Battle bet structure for staking on battles
    struct BattleBet {
        uint256 challengerStake;
        uint256 opponentStake;
        bool bettingEnabled;
        bool paid;
    }

    // =============================================================================
    // EVENTS
    // =============================================================================

    /**
     * @notice Emitted when a battle challenge is created
     * @param battleId Unique identifier for the battle
     * @param challenger Address of the player initiating the challenge
     * @param opponent Address of the challenged player
     * @param challengerCardId Token ID of the challenger's card
     */
    event BattleCreated(
        uint256 indexed battleId,
        address indexed challenger,
        address indexed opponent,
        uint256 challengerCardId
    );

    /**
     * @notice Emitted when a battle is accepted
     * @param battleId Unique identifier for the battle
     * @param opponent Address of the opponent accepting
     * @param opponentCardId Token ID of the opponent's card
     */
    event BattleAccepted(
        uint256 indexed battleId,
        address indexed opponent,
        uint256 opponentCardId
    );

    /**
     * @notice Emitted when a battle is completed
     * @param battleId Unique identifier for the battle
     * @param winner Address of the winning player
     * @param winnerCardId Token ID of the winning card
     */
    event BattleCompleted(
        uint256 indexed battleId,
        address indexed winner,
        uint256 winnerCardId
    );

    /**
     * @notice Emitted when a battle is cancelled
     * @param battleId Unique identifier for the cancelled battle
     */
    event BattleCancelled(uint256 indexed battleId);

    /**
     * @notice Emitted when a battle with betting is created
     * @param battleId Unique identifier for the battle
     * @param challenger Address of the player initiating the bet
     * @param stake Amount staked by the challenger
     */
    event BattleBetCreated(
        uint256 indexed battleId,
        address indexed challenger,
        uint256 stake
    );

    /**
     * @notice Emitted when betting payout is made
     * @param battleId Unique identifier for the battle
     * @param winner Address of the winner receiving payout
     * @param totalPayout Total amount paid to winner
     * @param fee Fee amount collected by the platform
     */
    event BattlePayout(
        uint256 indexed battleId,
        address indexed winner,
        uint256 totalPayout,
        uint256 fee
    );

    /**
     * @notice Emitted when experience rewards are updated
     * @param winnerExp New experience reward for winner
     * @param loserExp New experience reward for loser
     */
    event ExpRewardsUpdated(uint32 winnerExp, uint32 loserExp);

    /**
     * @notice Emitted when challenge timeout is updated
     * @param oldTimeout Previous timeout duration
     * @param newTimeout New timeout duration
     */
    event ChallengeTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);

    // =============================================================================
    // BATTLE FUNCTIONS
    // =============================================================================

    /**
     * @notice Create a battle challenge
     * @dev Challenger must own the specified card
     * @param opponent Opponent's address (cannot be self)
     * @param cardId Challenger's card token ID
     * @return battleId Created battle ID
     */
    function createChallenge(address opponent, uint256 cardId) external returns (uint256 battleId);

    /**
     * @notice Accept a battle challenge
     * @dev Opponent must own the specified card
     * @dev Challenge must not be expired
     * @param battleId Battle ID to accept
     * @param cardId Opponent's card token ID
     
    function acceptChallenge(uint256 battleId, uint256 cardId) external;
*/
    /**
     * @notice Cancel a pending challenge
     * @dev Can only be cancelled by challenger or if timeout has passed
     * @param battleId Battle ID to cancel
     */
    function cancelChallenge(uint256 battleId) external;

    // =============================================================================
    // BETTING FUNCTIONS
    // =============================================================================

    /**
     * @notice Create a battle challenge with betting stake
     * @dev Stake must be between MIN_BET and MAX_BET
     * @param opponent Opponent's address
     * @param cardId Challenger's card token ID
     * @return battleId Created battle ID
     */
    function createChallengeWithBet(address opponent, uint256 cardId) external payable returns (uint256 battleId);

    /**
     * @notice Accept a battle challenge with matching stake
     * @dev Must send exact same amount as challenger's stake
     * @param battleId Battle ID to accept
     * @param cardId Opponent's card token ID
     
    function acceptChallengeWithBet(uint256 battleId, uint256 cardId) external payable;
*/
    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get battle details
     * @param battleId Battle ID to query
     * @return Battle struct containing all battle data
     */
    function getBattle(uint256 battleId) external view returns (Battle memory);

    /**
     * @notice Get player stats
     * @param player Player address
     * @return PlayerStats struct with wins, losses, streaks
     */
    function getPlayerStats(address player) external view returns (PlayerStats memory);

    /**
     * @notice Get leaderboard
     * @dev Returns top players sorted by wins
     * @param limit Maximum number of entries to return
     * @return addresses Array of player addresses
     * @return wins Array of win counts corresponding to addresses
     */
    function getLeaderboard(uint256 limit) external view returns (address[] memory addresses, uint256[] memory wins);

    /**
     * @notice Get battle bet details
     * @param battleId Battle ID to query
     * @return BattleBet struct with stake amounts and status
     */
    function getBattleBet(uint256 battleId) external view returns (BattleBet memory);

    /**
     * @notice Get player's pending challenges (as opponent)
     * @param player Player address
     * @return Array of battle IDs waiting for player's acceptance
     */
    function getPlayerPendingChallenges(address player) external view returns (uint256[] memory);

    /**
     * @notice Get player's active challenges (as challenger)
     * @param player Player address
     * @return Array of battle IDs created by player
     */
    function getPlayerActiveChallenges(address player) external view returns (uint256[] memory);

    /**
     * @notice Verify that the contract has the required role on the card contract
     * @return True if this contract has STATS_UPDATER_ROLE on cardContract
     */
    function verifySetup() external view returns (bool);

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Set experience rewards for battles
     * @dev Only callable by REWARDS_ROLE
     * @param winnerExp Winner experience reward
     * @param loserExp Loser experience reward
     */
    function setExpRewards(uint32 winnerExp, uint32 loserExp) external;

    /**
     * @notice Set challenge timeout duration
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @dev Minimum timeout is 1 hour
     * @param timeout New timeout in seconds
     */
    function setChallengeTimeout(uint256 timeout) external;

    /**
     * @notice Set betting fee percentage
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @dev Maximum fee is 10% (1000 basis points)
     * @param newFee Fee in basis points (100 = 1%)
     */
    function setBettingFee(uint256 newFee) external;

    /**
     * @notice Set fee recipient address
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external;

    /**
     * @notice Withdraw collected betting fees
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function withdrawFees() external;

    /**
     * @notice Pause contract operations
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function pause() external;

    /**
     * @notice Unpause contract operations
     * @dev Only callable by DEFAULT_ADMIN_ROLE
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
