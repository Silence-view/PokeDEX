// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBattleArena
 * @dev Interface for the PvP Battle Arena contract
 */
interface IBattleArena {
    /// @notice Battle status enum
    enum BattleStatus {
        Pending,    // Challenge created, waiting for acceptance
        Active,     // Battle in progress
        Completed,  // Battle finished
        Cancelled   // Battle cancelled
    }

    /// @notice Battle structure (optimized: 4 storage slots instead of 8)
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

    /// @notice Emitted when a battle with betting is created
    event BattleBetCreated(
        uint256 indexed battleId,
        address indexed challenger,
        uint256 stake
    );

    /// @notice Emitted when betting payout is made
    event BattlePayout(
        uint256 indexed battleId,
        address indexed winner,
        uint256 totalPayout,
        uint256 fee
    );

    /// @notice Emitted when a battle challenge is created
    event BattleCreated(
        uint256 indexed battleId,
        address indexed challenger,
        address indexed opponent,
        uint256 challengerCardId
    );

    /// @notice Emitted when a battle is accepted
    event BattleAccepted(
        uint256 indexed battleId,
        address indexed opponent,
        uint256 opponentCardId
    );

    /// @notice Emitted when a battle is completed
    event BattleCompleted(
        uint256 indexed battleId,
        address indexed winner,
        uint256 winnerCardId
    );

    /// @notice Emitted when a battle is cancelled
    event BattleCancelled(uint256 indexed battleId);

    /// @notice Create a battle challenge
    function createChallenge(address opponent, uint256 cardId) external returns (uint256 battleId);

    /// @notice Accept a battle challenge
    function acceptChallenge(uint256 battleId, uint256 cardId) external;

    /// @notice Cancel a pending challenge
    function cancelChallenge(uint256 battleId) external;

    /// @notice Get battle details
    function getBattle(uint256 battleId) external view returns (Battle memory);

    /// @notice Get player stats
    function getPlayerStats(address player) external view returns (PlayerStats memory);

    /// @notice Get leaderboard
    function getLeaderboard(uint256 limit) external view returns (address[] memory, uint256[] memory);

    /// @notice Create a battle challenge with betting stake
    function createChallengeWithBet(address opponent, uint256 cardId) external payable returns (uint256 battleId);

    /// @notice Accept a battle challenge with matching stake
    function acceptChallengeWithBet(uint256 battleId, uint256 cardId) external payable;

    /// @notice Get battle bet details
    function getBattleBet(uint256 battleId) external view returns (BattleBet memory);
}
