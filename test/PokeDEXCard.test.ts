import { expect } from "chai";
import { ethers } from "hardhat";
import { PokeDEXCard } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PokeDEXCard", function () {
  let pokeDEXCard: PokeDEXCard;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const STATS_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STATS_UPDATER_ROLE"));

  const sampleStats = {
    hp: 100,
    attack: 80,
    defense: 60,
    speed: 90,
    pokemonType: 3, // Electric
    rarity: 2, // Rare
    generation: 1,
    experience: 0,
  };

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const PokeDEXCard = await ethers.getContractFactory("PokeDEXCard");
    pokeDEXCard = await PokeDEXCard.deploy(owner.address);
    await pokeDEXCard.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await pokeDEXCard.name()).to.equal("PokeDEX Card");
      expect(await pokeDEXCard.symbol()).to.equal("PDEX");
    });

    it("Should grant admin roles to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await pokeDEXCard.DEFAULT_ADMIN_ROLE();
      expect(await pokeDEXCard.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await pokeDEXCard.hasRole(MINTER_ROLE, owner.address)).to.be.true;
      expect(await pokeDEXCard.hasRole(STATS_UPDATER_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero total supply", async function () {
      expect(await pokeDEXCard.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should mint a card with correct stats", async function () {
      const uri = "ipfs://QmTest/1.json";

      await expect(pokeDEXCard.mintCard(user1.address, uri, sampleStats))
        .to.emit(pokeDEXCard, "CardMinted")
        .withArgs(1, user1.address, sampleStats.pokemonType, sampleStats.rarity);

      expect(await pokeDEXCard.ownerOf(1)).to.equal(user1.address);
      expect(await pokeDEXCard.tokenURI(1)).to.equal(uri);

      const stats = await pokeDEXCard.getCardStats(1);
      expect(stats.hp).to.equal(sampleStats.hp);
      expect(stats.attack).to.equal(sampleStats.attack);
      expect(stats.pokemonType).to.equal(sampleStats.pokemonType);
      expect(stats.rarity).to.equal(sampleStats.rarity);
    });

    it("Should reject minting to zero address", async function () {
      await expect(
        pokeDEXCard.mintCard(ethers.ZeroAddress, "ipfs://test", sampleStats)
      ).to.be.revertedWith("Cannot mint to zero address");
    });

    it("Should reject minting with empty URI", async function () {
      await expect(
        pokeDEXCard.mintCard(user1.address, "", sampleStats)
      ).to.be.revertedWith("URI cannot be empty");
    });

    it("Should reject minting with invalid stats", async function () {
      const invalidStats = { ...sampleStats, hp: 0 };
      await expect(
        pokeDEXCard.mintCard(user1.address, "ipfs://test", invalidStats)
      ).to.be.revertedWith("Invalid HP");

      const invalidGenStats = { ...sampleStats, generation: 10 };
      await expect(
        pokeDEXCard.mintCard(user1.address, "ipfs://test", invalidGenStats)
      ).to.be.revertedWith("Invalid generation");
    });

    it("Should reject minting from non-minter", async function () {
      await expect(
        pokeDEXCard.connect(user1).mintCard(user1.address, "ipfs://test", sampleStats)
      ).to.be.reverted;
    });

    it("Should increment token IDs correctly", async function () {
      await pokeDEXCard.mintCard(user1.address, "ipfs://1", sampleStats);
      await pokeDEXCard.mintCard(user2.address, "ipfs://2", sampleStats);

      expect(await pokeDEXCard.ownerOf(1)).to.equal(user1.address);
      expect(await pokeDEXCard.ownerOf(2)).to.equal(user2.address);
      expect(await pokeDEXCard.totalSupply()).to.equal(2);
    });
  });

  describe("Batch Minting", function () {
    it("Should batch mint multiple cards", async function () {
      const uris = ["ipfs://1", "ipfs://2", "ipfs://3"];
      const statsArray = [sampleStats, sampleStats, sampleStats];

      const tx = await pokeDEXCard.batchMintCards(user1.address, uris, statsArray);
      await tx.wait();

      expect(await pokeDEXCard.totalSupply()).to.equal(3);
      expect(await pokeDEXCard.ownerOf(1)).to.equal(user1.address);
      expect(await pokeDEXCard.ownerOf(2)).to.equal(user1.address);
      expect(await pokeDEXCard.ownerOf(3)).to.equal(user1.address);
    });

    it("Should reject batch with mismatched arrays", async function () {
      const uris = ["ipfs://1", "ipfs://2"];
      const statsArray = [sampleStats];

      await expect(
        pokeDEXCard.batchMintCards(user1.address, uris, statsArray)
      ).to.be.revertedWith("Arrays length mismatch");
    });

    it("Should reject batch larger than 20", async function () {
      const uris = Array(21).fill("ipfs://test");
      const statsArray = Array(21).fill(sampleStats);

      await expect(
        pokeDEXCard.batchMintCards(user1.address, uris, statsArray)
      ).to.be.revertedWith("Invalid batch size");
    });
  });

  describe("Experience", function () {
    beforeEach(async function () {
      await pokeDEXCard.mintCard(user1.address, "ipfs://1", sampleStats);
    });

    it("Should add experience to card", async function () {
      await expect(pokeDEXCard.addExperience(1, 100))
        .to.emit(pokeDEXCard, "CardStatsUpdated")
        .withArgs(1, 100);

      const stats = await pokeDEXCard.getCardStats(1);
      expect(stats.experience).to.equal(100);
    });

    it("Should cap experience at maximum", async function () {
      const MAX_EXP = 1000000;
      await pokeDEXCard.addExperience(1, MAX_EXP + 1000);

      const stats = await pokeDEXCard.getCardStats(1);
      expect(stats.experience).to.equal(MAX_EXP);
    });

    it("Should reject experience update from non-updater", async function () {
      await expect(
        pokeDEXCard.connect(user1).addExperience(1, 100)
      ).to.be.reverted;
    });
  });

  describe("Battle Power", function () {
    it("Should calculate battle power correctly", async function () {
      await pokeDEXCard.mintCard(user1.address, "ipfs://1", sampleStats);

      const power = await pokeDEXCard.calculateBattlePower(1);
      expect(power).to.be.gt(0);

      // Base power = (100*2) + (80*3) + (60*2) + (90*3) = 200 + 240 + 120 + 270 = 830
      // Rare multiplier = 150
      // Exp bonus = 0 (no exp)
      // Final = 830 * 150 * 100 / 10000 = 1245
      expect(power).to.equal(1245);
    });

    it("Should apply rarity multiplier", async function () {
      const commonStats = { ...sampleStats, rarity: 0 }; // Common
      const legendaryStats = { ...sampleStats, rarity: 4 }; // Legendary

      await pokeDEXCard.mintCard(user1.address, "ipfs://1", commonStats);
      await pokeDEXCard.mintCard(user2.address, "ipfs://2", legendaryStats);

      const commonPower = await pokeDEXCard.calculateBattlePower(1);
      const legendaryPower = await pokeDEXCard.calculateBattlePower(2);

      expect(legendaryPower).to.be.gt(commonPower);
    });
  });

  describe("Pausable", function () {
    it("Should pause and unpause", async function () {
      await pokeDEXCard.pause();
      expect(await pokeDEXCard.paused()).to.be.true;

      await expect(
        pokeDEXCard.mintCard(user1.address, "ipfs://1", sampleStats)
      ).to.be.reverted;

      await pokeDEXCard.unpause();
      expect(await pokeDEXCard.paused()).to.be.false;

      await pokeDEXCard.mintCard(user1.address, "ipfs://1", sampleStats);
      expect(await pokeDEXCard.totalSupply()).to.equal(1);
    });

    it("Should reject pause from non-admin", async function () {
      await expect(pokeDEXCard.connect(user1).pause()).to.be.reverted;
    });
  });
});
