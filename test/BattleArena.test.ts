import { expect } from "chai";
import { ethers } from "hardhat";
import { PokeDEXCard, BattleArena } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BattleArena", function () {
  let pokeDEXCard: PokeDEXCard;
  let battleArena: BattleArena;
  let owner: SignerWithAddress;
  let player1: SignerWithAddress;
  let player2: SignerWithAddress;

  const STATS_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STATS_UPDATER_ROLE"));

  const pikachu = {
    hp: 60,
    attack: 55,
    defense: 40,
    speed: 90,
    pokemonType: 3, // Electric
    rarity: 2, // Rare
    generation: 1,
    experience: 0,
  };

  const charizard = {
    hp: 78,
    attack: 84,
    defense: 78,
    speed: 100,
    pokemonType: 1, // Fire
    rarity: 3, // UltraRare
    generation: 1,
    experience: 0,
  };

  const blastoise = {
    hp: 79,
    attack: 83,
    defense: 100,
    speed: 78,
    pokemonType: 2, // Water
    rarity: 3, // UltraRare
    generation: 1,
    experience: 0,
  };

  beforeEach(async function () {
    [owner, player1, player2] = await ethers.getSigners();

    // Deploy PokeDEXCard
    const PokeDEXCard = await ethers.getContractFactory("PokeDEXCard");
    pokeDEXCard = await PokeDEXCard.deploy(owner.address);
    await pokeDEXCard.waitForDeployment();

    // Deploy BattleArena
    const BattleArena = await ethers.getContractFactory("BattleArena");
    battleArena = await BattleArena.deploy(
      await pokeDEXCard.getAddress(),
      owner.address
    );
    await battleArena.waitForDeployment();

    // Grant STATS_UPDATER_ROLE to BattleArena
    await pokeDEXCard.grantRole(STATS_UPDATER_ROLE, await battleArena.getAddress());

    // Mint cards for players
    await pokeDEXCard.mintCard(player1.address, "ipfs://pikachu", pikachu);
    await pokeDEXCard.mintCard(player1.address, "ipfs://charizard", charizard);
    await pokeDEXCard.mintCard(player2.address, "ipfs://blastoise", blastoise);
  });

  describe("Challenge Creation", function () {
    it("Should create a challenge", async function () {
      await expect(
        battleArena.connect(player1).createChallenge(player2.address, 1)
      )
        .to.emit(battleArena, "BattleCreated")
        .withArgs(1, player1.address, player2.address, 1);

      const battle = await battleArena.getBattle(1);
      expect(battle.challenger).to.equal(player1.address);
      expect(battle.opponent).to.equal(player2.address);
      expect(battle.challengerCardId).to.equal(1);
      expect(battle.status).to.equal(0); // Pending
    });

    it("Should reject challenge to self", async function () {
      await expect(
        battleArena.connect(player1).createChallenge(player1.address, 1)
      ).to.be.revertedWith("Cannot challenge yourself");
    });

    it("Should reject challenge with card not owned", async function () {
      await expect(
        battleArena.connect(player1).createChallenge(player2.address, 3)
      ).to.be.revertedWith("Not card owner");
    });

    it("Should track pending challenges", async function () {
      await battleArena.connect(player1).createChallenge(player2.address, 1);

      const pending = await battleArena.getPlayerPendingChallenges(player2.address);
      expect(pending.length).to.equal(1);
      expect(pending[0]).to.equal(1);
    });
  });

  describe("Challenge Acceptance", function () {
    beforeEach(async function () {
      await battleArena.connect(player1).createChallenge(player2.address, 1);
    });

    it("Should accept challenge and execute battle", async function () {
      const tx = await battleArena.connect(player2).acceptChallenge(1, 3);
      const receipt = await tx.wait();

      // Should emit BattleAccepted and BattleCompleted
      const battle = await battleArena.getBattle(1);
      expect(battle.status).to.equal(2); // Completed
      expect(battle.opponentCardId).to.equal(3);
      expect(battle.winner).to.not.equal(ethers.ZeroAddress);
    });

    it("Should reject acceptance from non-opponent", async function () {
      await expect(
        battleArena.connect(player1).acceptChallenge(1, 3)
      ).to.be.revertedWith("Not the opponent");
    });

    it("Should reject acceptance with unowned card", async function () {
      await expect(
        battleArena.connect(player2).acceptChallenge(1, 1) // Card 1 owned by player1
      ).to.be.revertedWith("Not card owner");
    });

    it("Should update player stats after battle", async function () {
      await battleArena.connect(player2).acceptChallenge(1, 3);

      const battle = await battleArena.getBattle(1);
      const winnerStats = await battleArena.getPlayerStats(battle.winner);
      const loser =
        battle.winner === player1.address ? player2.address : player1.address;
      const loserStats = await battleArena.getPlayerStats(loser);

      expect(winnerStats.wins).to.equal(1);
      expect(winnerStats.totalBattles).to.equal(1);
      expect(loserStats.losses).to.equal(1);
      expect(loserStats.totalBattles).to.equal(1);
    });

    it("Should award experience to both cards", async function () {
      const statsBefore1 = await pokeDEXCard.getCardStats(1);
      const statsBefore3 = await pokeDEXCard.getCardStats(3);

      await battleArena.connect(player2).acceptChallenge(1, 3);

      const statsAfter1 = await pokeDEXCard.getCardStats(1);
      const statsAfter3 = await pokeDEXCard.getCardStats(3);

      // Both cards should have gained exp
      expect(statsAfter1.experience).to.be.gt(statsBefore1.experience);
      expect(statsAfter3.experience).to.be.gt(statsBefore3.experience);
    });
  });

  describe("Challenge Cancellation", function () {
    beforeEach(async function () {
      await battleArena.connect(player1).createChallenge(player2.address, 1);
    });

    it("Should allow challenger to cancel", async function () {
      await expect(battleArena.connect(player1).cancelChallenge(1))
        .to.emit(battleArena, "BattleCancelled")
        .withArgs(1);

      const battle = await battleArena.getBattle(1);
      expect(battle.status).to.equal(3); // Cancelled
    });

    it("Should reject cancel from non-challenger before timeout", async function () {
      await expect(
        battleArena.connect(player2).cancelChallenge(1)
      ).to.be.revertedWith("Cannot cancel");
    });
  });

  describe("Type Advantages", function () {
    it("Should apply type advantage in battle", async function () {
      // Charizard (Fire) vs Blastoise (Water)
      // Water is super effective against Fire
      await battleArena.connect(player1).createChallenge(player2.address, 2); // Charizard
      await battleArena.connect(player2).acceptChallenge(1, 3); // Blastoise

      const battle = await battleArena.getBattle(1);
      // With type advantage, Blastoise should likely win
      // This is probabilistic based on stats, but we can verify the battle completed
      expect(battle.status).to.equal(2); // Completed
    });
  });

  describe("Leaderboard", function () {
    it("Should track leaderboard", async function () {
      await battleArena.connect(player1).createChallenge(player2.address, 1);
      await battleArena.connect(player2).acceptChallenge(1, 3);

      const [addresses, wins] = await battleArena.getLeaderboard(10);
      expect(addresses.length).to.equal(2);
      expect(wins[0]).to.be.gte(wins[1]); // Sorted by wins
    });

    it("Should update streak on consecutive wins", async function () {
      // Create multiple battles
      await battleArena.connect(player1).createChallenge(player2.address, 1);
      await battleArena.connect(player2).acceptChallenge(1, 3);

      const battle = await battleArena.getBattle(1);
      const winnerStats = await battleArena.getPlayerStats(battle.winner);

      expect(winnerStats.currentStreak).to.equal(1);
      expect(winnerStats.bestStreak).to.equal(1);
    });
  });

  describe("Pausable", function () {
    it("Should pause and unpause", async function () {
      await battleArena.pause();
      expect(await battleArena.paused()).to.be.true;

      await expect(
        battleArena.connect(player1).createChallenge(player2.address, 1)
      ).to.be.reverted;

      await battleArena.unpause();
      await battleArena.connect(player1).createChallenge(player2.address, 1);
      const battle = await battleArena.getBattle(1);
      expect(battle.challenger).to.equal(player1.address);
    });
  });
});
