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
 * @dev PvP battle system for Pokemon card battles
 * @notice Turn-based battles with type advantages and stat calculations
 */
contract BattleArena is
    AccessControl,
    ReentrancyGuard,
    Pausable,
    IBattleArena
{
    /// @notice Role for managing battle rewards
    bytes32 public constant REWARDS_ROLE = keccak256("REWARDS_ROLE");

    /// @notice Emitted when experience rewards are updated
    event ExpRewardsUpdated(uint32 winnerExp, uint32 loserExp);

    /// @notice Emitted when challenge timeout is updated
    event ChallengeTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);

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
    /// 0 = normal (1x), 1 = super effective (2x), 2 = not very effective (0.5x), 3 = immune (0x)
    mapping(IPokeDEXCard.PokemonType => mapping(IPokeDEXCard.PokemonType => uint8))
        public typeChart;

    /// @notice Maximum leaderboard size to prevent DoS
    uint256 public constant MAX_LEADERBOARD_SIZE = 100;

    /// @notice Leaderboard tracking
    address[] public leaderboardAddresses;
    mapping(address => uint256) public leaderboardPosition; // 1-indexed, 0 = not in leaderboard

    /**
     * @notice Contract constructor
     * @param _cardContract Address of PokeDEXCard contract
     * @param admin Admin address
     */
    constructor(address _cardContract, address admin) {
        require(_cardContract != address(0), "Invalid card contract");
        require(admin != address(0), "Invalid admin");

        cardContract = PokeDEXCard(_cardContract);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REWARDS_ROLE, admin);

        // Initialize type chart
        _initializeTypeChart();
    }

    /**
     * @notice Create a battle challenge
     * @param opponent Opponent's address
     * @param cardId Challenger's card token ID
     * @return battleId Created battle ID
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

        return battleId;
    }

    /**
     * @notice Accept a battle challenge
     * @param battleId Battle ID to accept
     * @param cardId Opponent's card token ID
     */
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

        // Execute battle immediately
        _executeBattle(battleId);
    }

    /**
     * @notice Cancel a pending challenge
     * @param battleId Battle ID to cancel
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

        battle.status = BattleStatus.Cancelled;

        _removeFromArray(activeChallenges[battle.challenger], battleId);
        _removeFromArray(pendingChallenges[battle.opponent], battleId);

        emit BattleCancelled(battleId);
    }

    /**
     * @notice Get battle details
     * @param battleId Battle ID to query
     * @return Battle struct
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
     * @param player Player address
     * @return PlayerStats struct
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
     * @notice Get leaderboard
     * @param limit Maximum number of entries
     * @return addresses Array of player addresses
     * @return wins Array of win counts
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
     * @notice Get player's pending challenges
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
     * @notice Get player's active challenges (as challenger)
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
     * @notice Verify that the contract has the required role on the card contract
     * @return True if this contract has STATS_UPDATER_ROLE on cardContract
     */
    function verifySetup() external view returns (bool) {
        bytes32 STATS_UPDATER_ROLE = keccak256("STATS_UPDATER_ROLE");
        return IAccessControl(address(cardContract)).hasRole(STATS_UPDATER_ROLE, address(this));
    }

    /**
     * @notice Set experience rewards
     * @param _winnerExp Winner exp reward
     * @param _loserExp Loser exp reward
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
     * @notice Set challenge timeout
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
     * @dev Execute a battle and determine winner
     * @param battleId Battle ID to execute
     */
    function _executeBattle(uint256 battleId) internal {
        Battle storage battle = battles[battleId];

        uint256 challengerCardId = uint256(battle.challengerCardId);
        uint256 opponentCardId = uint256(battle.opponentCardId);

        // Get card stats
        IPokeDEXCard.CardStats memory challengerStats =
            cardContract.getCardStats(challengerCardId);
        IPokeDEXCard.CardStats memory opponentStats =
            cardContract.getCardStats(opponentCardId);

        // Calculate battle power with type advantage
        uint256 challengerPower = _calculatePowerWithTypeAdvantage(
            challengerCardId,
            challengerStats,
            opponentStats.pokemonType
        );
        uint256 opponentPower = _calculatePowerWithTypeAdvantage(
            opponentCardId,
            opponentStats,
            challengerStats.pokemonType
        );

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

        if (challengerPower >= opponentPower) {
            winner = battle.challenger;
            loser = battle.opponent;
            winnerCardId = challengerCardId;
            loserCardId = opponentCardId;
        } else {
            winner = battle.opponent;
            loser = battle.challenger;
            winnerCardId = opponentCardId;
            loserCardId = challengerCardId;
        }

        // Update battle state
        battle.winner = winner;
        battle.status = BattleStatus.Completed;
        battle.completedAt = uint48(block.timestamp);

        // Update player stats
        _updatePlayerStats(winner, loser);

        // Award experience
        cardContract.addExperience(winnerCardId, winnerExpReward);
        cardContract.addExperience(loserCardId, loserExpReward);

        // Clean up pending/active arrays
        _removeFromArray(activeChallenges[battle.challenger], battleId);
        _removeFromArray(pendingChallenges[battle.opponent], battleId);

        emit BattleCompleted(battleId, winner, winnerCardId);
    }

    /**
     * @dev Calculate power with type advantage modifier
     * @param cardId Card token ID
     * @param stats Card stats
     * @param defenderType Defender's Pokemon type
     * @return Modified battle power
     */
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
     * @dev Remove element from array
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
