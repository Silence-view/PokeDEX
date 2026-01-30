import { expect } from "chai";
import { ethers } from "hardhat";
import { PokeDEXCard, CardPack } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Mock VRF Coordinator for testing
const VRF_MOCK_ADDRESS = "0x8103B0A8A00be2DDC778e6e7eaa21791Cd364625"; // Sepolia VRF
const KEY_HASH = "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c";
const SUBSCRIPTION_ID = 1;

describe("CardPack", function () {
  let pokeDEXCard: PokeDEXCard;
  let cardPack: CardPack;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const CONFIG_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CONFIG_ROLE"));

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy PokeDEXCard
    const PokeDEXCard = await ethers.getContractFactory("PokeDEXCard");
    pokeDEXCard = await PokeDEXCard.deploy(owner.address);
    await pokeDEXCard.waitForDeployment();

    // Deploy CardPack
    // Note: In production, this would use real VRF Coordinator
    // For testing, we'll test the view functions and configuration
    const CardPack = await ethers.getContractFactory("CardPack");
    cardPack = await CardPack.deploy(
      VRF_MOCK_ADDRESS,
      SUBSCRIPTION_ID,
      KEY_HASH,
      await pokeDEXCard.getAddress(),
      owner.address
    );
    await cardPack.waitForDeployment();

    // Grant MINTER_ROLE to CardPack
    await pokeDEXCard.grantRole(MINTER_ROLE, await cardPack.getAddress());
  });

  describe("Deployment", function () {
    it("Should set correct card contract address", async function () {
      expect(await cardPack.cardContract()).to.equal(
        await pokeDEXCard.getAddress()
      );
    });

    it("Should set default pack prices", async function () {
      expect(await cardPack.getPackPrice(0)).to.equal(ethers.parseEther("0.01")); // Basic
      expect(await cardPack.getPackPrice(1)).to.equal(ethers.parseEther("0.025")); // Premium
      expect(await cardPack.getPackPrice(2)).to.equal(ethers.parseEther("0.05")); // Legendary
    });

    it("Should grant roles correctly", async function () {
      const DEFAULT_ADMIN_ROLE = await cardPack.DEFAULT_ADMIN_ROLE();
      expect(await cardPack.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await cardPack.hasRole(CONFIG_ROLE, owner.address)).to.be.true;
    });
  });

  describe("Pack Prices", function () {
    it("Should update pack price", async function () {
      const newPrice = ethers.parseEther("0.02");
      await cardPack.setPackPrice(0, newPrice);
      expect(await cardPack.getPackPrice(0)).to.equal(newPrice);
    });

    it("Should reject zero price", async function () {
      await expect(cardPack.setPackPrice(0, 0)).to.be.revertedWith(
        "Price must be positive"
      );
    });

    it("Should reject price update from non-config role", async function () {
      await expect(
        cardPack.connect(user1).setPackPrice(0, ethers.parseEther("0.02"))
      ).to.be.reverted;
    });
  });

  describe("Configuration", function () {
    it("Should set rarity base URI", async function () {
      await cardPack.setRarityBaseURI(0, "ipfs://common/");
      expect(await cardPack.rarityBaseURIs(0)).to.equal("ipfs://common/");
    });

    it("Should set callback gas limit", async function () {
      await cardPack.setCallbackGasLimit(600000);
      expect(await cardPack.callbackGasLimit()).to.equal(600000);
    });
  });

  describe("Pack Purchase (Validation)", function () {
    it("Should reject purchase with insufficient payment", async function () {
      const price = await cardPack.getPackPrice(0);
      await expect(
        cardPack.connect(user1).purchasePack(0, { value: price - 1n })
      ).to.be.revertedWith("Insufficient payment");
    });

    // Note: Full purchase tests require VRF mock which is complex to set up
    // In production, use Chainlink's VRF mock for comprehensive testing
  });

  describe("Withdraw", function () {
    it("Should withdraw contract balance", async function () {
      // Send some ETH to contract
      await owner.sendTransaction({
        to: await cardPack.getAddress(),
        value: ethers.parseEther("1"),
      });

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      await cardPack.withdraw(user1.address);
      const balanceAfter = await ethers.provider.getBalance(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1"));
    });

    it("Should reject withdraw to zero address", async function () {
      await expect(cardPack.withdraw(ethers.ZeroAddress)).to.be.revertedWith(
        "Invalid address"
      );
    });

    it("Should reject withdraw from non-admin", async function () {
      await expect(cardPack.connect(user1).withdraw(user1.address)).to.be
        .reverted;
    });
  });

  describe("Pausable", function () {
    it("Should pause and unpause", async function () {
      await cardPack.pause();
      expect(await cardPack.paused()).to.be.true;

      await cardPack.unpause();
      expect(await cardPack.paused()).to.be.false;
    });
  });

  describe("Pending Requests", function () {
    it("Should return empty array for new user", async function () {
      const pending = await cardPack.getUserPendingRequests(user1.address);
      expect(pending.length).to.equal(0);
    });
  });
});
