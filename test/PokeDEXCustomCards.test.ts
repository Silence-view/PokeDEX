import hre from "hardhat";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";



const {viem, networkHelpers} =  await hre.network.connect();


describe("PokeDEXCustomCards", function () {
    // Fixture to deploy the contract
  async function deployPokeDEXCustomCardsFixture() {
    const [owner, feeRecipient, user1, user2, moderator] = await viem.getWalletClients();
    
    const publicClient = await viem.getPublicClient();

    const pokeDEXCustomCards = await viem.deployContract("PokeDEXCustomCards", [
      owner.account.address,
      feeRecipient.account.address,
    ]);

    return {
      pokeDEXCustomCards,
      owner,
      feeRecipient,
      user1,
      user2,
      moderator,
      publicClient,
    };
  }

  describe("Deployment", function () {
    it("Should set the correct admin and fee recipient", async function () {
      const { pokeDEXCustomCards, owner, feeRecipient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
      
      const hasAdminRole = await pokeDEXCustomCards.read.hasRole([
        DEFAULT_ADMIN_ROLE as `0x${string}`,
        owner.account.address,
      ]);
      assert.equal(hasAdminRole, true, "Owner should have admin role");

      const storedFeeRecipient = await pokeDEXCustomCards.read.feeRecipient();
      assert.equal(
        storedFeeRecipient.toLowerCase(),
        feeRecipient.account.address.toLowerCase(),
        "Fee recipient should be set correctly"
      );
    });

    it("Should set the correct name and symbol", async function () {
      const { pokeDEXCustomCards } = await networkHelpers.loadFixture(deployPokeDEXCustomCardsFixture);

      const name = await pokeDEXCustomCards.read.name();
      const symbol = await pokeDEXCustomCards.read.symbol();

      assert.equal(name, "PokeDEX Custom Cards", "Name should be PokeDEX Custom Cards");
      assert.equal(symbol, "PDEXC", "Symbol should be PDEXC");
    });

    it("Should set the default minting fee", async function () {
      const { pokeDEXCustomCards } = await networkHelpers.loadFixture(deployPokeDEXCustomCardsFixture);

      const mintingFee = await pokeDEXCustomCards.read.mintingFee();
      assert.equal(mintingFee, parseEther("0.001"), "Minting fee should be 0.001 ether");
    });

    it("Should set the default royalty", async function () {
      const { pokeDEXCustomCards } = await networkHelpers.loadFixture(deployPokeDEXCustomCardsFixture);

      const defaultRoyalty = await pokeDEXCustomCards.read.defaultRoyalty();
      assert.equal(defaultRoyalty, 500n, "Default royalty should be 500 basis points (5%)");
    });

    it("Should grant moderator role to admin", async function () {
      const { pokeDEXCustomCards, owner } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const MODERATOR_ROLE = await pokeDEXCustomCards.read.MODERATOR_ROLE();
      const hasModeratorRole = await pokeDEXCustomCards.read.hasRole([
        MODERATOR_ROLE,
        owner.account.address,
      ]);
      assert.equal(hasModeratorRole, true, "Admin should have moderator role");
    });
  });

  describe("Card Creation", function () {
    it("Should create a card with correct stats", async function () {
      const { pokeDEXCustomCards, user1, feeRecipient, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const metadataURI = "ipfs://QmTest123";
      const hp = 150;
      const attack = 100;
      const defense = 80;
      const speed = 120;
      const cardType = 3; // Electric
      const rarity = 2; // Rare
      const royaltyPercentage = 750; // 7.5%

      const hash = await pokeDEXCustomCards.write.createCard(
        [metadataURI, hp, attack, defense, speed, cardType, rarity, royaltyPercentage],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const totalSupply = await pokeDEXCustomCards.read.totalSupply();
      assert.equal(totalSupply, 1n, "Total supply should be 1");

      const cardStats = await pokeDEXCustomCards.read.cardStats([1n]);
      assert.equal(cardStats[0], hp, "HP should match");
      assert.equal(cardStats[1], attack, "Attack should match");
      assert.equal(cardStats[2], defense, "Defense should match");
      assert.equal(cardStats[3], speed, "Speed should match");
      assert.equal(cardStats[4], cardType, "Card type should match");
      assert.equal(cardStats[5], rarity, "Rarity should match");
      assert.equal(
        cardStats[6].toLowerCase(),
        user1.account.address.toLowerCase(),
        "Creator should match"
      );
      assert.equal(cardStats[8], false, "Should not be verified initially");
    });

    it("Should emit CardCreated event", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const metadataURI = "ipfs://QmTest123";
      const hash = await pokeDEXCustomCards.write.createCard(
        [metadataURI, 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const logs = await pokeDEXCustomCards.getEvents.CardCreated();
      
      assert.equal(logs.length > 0, true, "CardCreated event should be emitted");
    });

    it("Should revert if minting fee is insufficient", async function () {
      const { pokeDEXCustomCards, user1 } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.createCard(
          ["ipfs://test", 100, 50, 50, 50, 0, 0, 500],
          {
            account: user1.account,
            value: parseEther("0.0005"), // Insufficient fee
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Insufficient minting fee/, "Should revert with correct error");
      }
    });

    it("Should revert if HP is zero", async function () {
      const { pokeDEXCustomCards, user1 } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.createCard(
          ["ipfs://test", 0, 50, 50, 50, 0, 0, 500],
          {
            account: user1.account,
            value: parseEther("0.001"),
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Invalid HP/, "Should revert with correct error");
      }
    });

    it("Should revert if HP exceeds 255", async function () {
      const { pokeDEXCustomCards, user1 } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.createCard(
          ["ipfs://test", 256, 50, 50, 50, 0, 0, 500],
          {
            account: user1.account,
            value: parseEther("0.001"),
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Invalid HP/, "Should revert with correct error");
      }
    });

    it("Should revert if royalty is too high", async function () {
      const { pokeDEXCustomCards, user1 } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.createCard(
          ["ipfs://test", 100, 50, 50, 50, 0, 0, 1001],
          {
            account: user1.account,
            value: parseEther("0.001"),
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Royalty too high/, "Should revert with correct error");
      }
    });

    it("Should refund excess payment", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const balanceBefore = await publicClient.getBalance({
        address: user1.account.address,
      });

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://test", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.002"), // Overpayment
        }
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const balanceAfter = await publicClient.getBalance({
        address: user1.account.address,
      });

      // Balance should decrease by approximately 0.001 ether plus gas
      const difference = balanceBefore - balanceAfter;
      assert.equal(
        difference < parseEther("0.0015"),
        true,
        "Excess should be refunded (accounting for gas)"
      );
    });

    it("Should transfer fee to fee recipient", async function () {
      const { pokeDEXCustomCards, user1, feeRecipient, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const balanceBefore = await publicClient.getBalance({
        address: feeRecipient.account.address,
      });

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://test", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const balanceAfter = await publicClient.getBalance({
        address: feeRecipient.account.address,
      });

      assert.equal(
        balanceAfter - balanceBefore,
        parseEther("0.001"),
        "Fee recipient should receive minting fee"
      );
    });

    it("Should set token URI correctly", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const metadataURI = "ipfs://QmTest123";
      const hash = await pokeDEXCustomCards.write.createCard(
        [metadataURI, 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const tokenURI = await pokeDEXCustomCards.read.tokenURI([1n]);
      assert.equal(tokenURI, metadataURI, "Token URI should be set correctly");
    });

    it("Should set royalty info correctly", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const royaltyPercentage = 750; // 7.5%
      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://test", 100, 50, 50, 50, 0, 0, royaltyPercentage],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const [receiver, royaltyAmount] = await pokeDEXCustomCards.read.royaltyInfo([
        1n,
        parseEther("1"),
      ]);

      assert.equal(
        receiver.toLowerCase(),
        user1.account.address.toLowerCase(),
        "Royalty receiver should be the creator"
      );
      assert.equal(
        royaltyAmount,
        parseEther("0.075"),
        "Royalty amount should be 7.5% of sale price"
      );
    });

    it("Should track creator cards", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      // Create first card
      const hash1 = await pokeDEXCustomCards.write.createCard(
        ["ipfs://test1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Create second card
      const hash2 = await pokeDEXCustomCards.write.createCard(
        ["ipfs://test2", 120, 60, 60, 60, 1, 1, 600],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      const creatorCards = await pokeDEXCustomCards.read.getCreatorCards([
        user1.account.address,
      ]);

      assert.equal(creatorCards.length, 2, "Creator should have 2 cards");
      assert.equal(creatorCards[0], 1n, "First card ID should be 1");
      assert.equal(creatorCards[1], 2n, "Second card ID should be 2");
    });
  });

  describe("Simple Card Creation", function () {
    it("Should create a simple card with default stats", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createSimpleCard(
        ["ipfs://simple", 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const cardStats = await pokeDEXCustomCards.read.cardStats([1n]);
      assert.equal(cardStats[0], 100, "HP should be default 100");
      assert.equal(cardStats[1], 50, "Attack should be default 50");
      assert.equal(cardStats[2], 50, "Defense should be default 50");
      assert.equal(cardStats[3], 50, "Speed should be default 50");
      assert.equal(cardStats[4], 0, "Card type should be Normal (0)");
      assert.equal(cardStats[5], 0, "Rarity should be Common (0)");
    });
  });


  describe("Batch Card Creation", function () {
    it("Should create multiple cards in batch", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const uris = ["ipfs://batch1", "ipfs://batch2", "ipfs://batch3"];
      const hash = await pokeDEXCustomCards.write.batchCreateCards(
        [uris, 500],
        {
          account: user1.account,
          value: parseEther("0.003"), // 3 cards * 0.001
        }
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const totalSupply = await pokeDEXCustomCards.read.totalSupply();
      assert.equal(totalSupply, 3n, "Should have created 3 cards");

      const ownerOf1 = await pokeDEXCustomCards.read.ownerOf([1n]);
      const ownerOf2 = await pokeDEXCustomCards.read.ownerOf([2n]);
      const ownerOf3 = await pokeDEXCustomCards.read.ownerOf([3n]);

      assert.equal(
        ownerOf1.toLowerCase(),
        user1.account.address.toLowerCase(),
        "User should own card 1"
      );
      assert.equal(
        ownerOf2.toLowerCase(),
        user1.account.address.toLowerCase(),
        "User should own card 2"
      );
      assert.equal(
        ownerOf3.toLowerCase(),
        user1.account.address.toLowerCase(),
        "User should own card 3"
      );
    });

    it("Should revert batch creation with empty array", async function () {
      const { pokeDEXCustomCards, user1 } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.batchCreateCards(
          [[], 500],
          {
            account: user1.account,
            value: parseEther("0.001"),
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Invalid batch size/, "Should revert with correct error");
      }
    });

    it("Should revert batch creation with insufficient fee", async function () {
      const { pokeDEXCustomCards, user1 } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.batchCreateCards(
          [["ipfs://1", "ipfs://2"], 500],
          {
            account: user1.account,
            value: parseEther("0.001"), // Need 0.002 for 2 cards
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Insufficient minting fee/, "Should revert with correct error");
      }
    });
  });

  describe("Owner Enumeration", function () {
    it("Should track owned tokens correctly", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash1 = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      const hash2 = await pokeDEXCustomCards.write.createCard(
        ["ipfs://2", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      const ownedTokens = await pokeDEXCustomCards.read.tokensOfOwner([
        user1.account.address,
      ]);

      assert.equal(ownedTokens.length, 2, "Should own 2 tokens");
      assert.equal(ownedTokens[0], 1n, "First token should be ID 1");
      assert.equal(ownedTokens[1], 2n, "Second token should be ID 2");
    });

    it("Should update owned tokens after transfer", async function () {
      const { pokeDEXCustomCards, user1, user2, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const transferHash = await pokeDEXCustomCards.write.transferFrom(
        [user1.account.address, user2.account.address, 1n],
        {
          account: user1.account,
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: transferHash });

      const user1Tokens = await pokeDEXCustomCards.read.tokensOfOwner([
        user1.account.address,
      ]);
      const user2Tokens = await pokeDEXCustomCards.read.tokensOfOwner([
        user2.account.address,
      ]);

      assert.equal(user1Tokens.length, 0, "User1 should own 0 tokens");
      assert.equal(user2Tokens.length, 1, "User2 should own 1 token");
      assert.equal(user2Tokens[0], 1n, "User2 should own token 1");
    });
  });


  describe("Battle Power Calculation", function () {
    it("Should calculate battle power correctly", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hp = 100;
      const attack = 80;
      const defense = 60;
      const speed = 70;
      const rarity = 0; // Common

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", hp, attack, defense, speed, 0, rarity, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const battlePower = await pokeDEXCustomCards.read.calculateBattlePower([1n]);

      // basePower = (100*2) + (80*3) + (60*2) + (70*3) = 200 + 240 + 120 + 210 = 770
      // rarityMultiplier = 100 (common)
      // verifiedBonus = 100 (not verified)
      // result = (770 * 100 * 100) / 10000 = 770
      assert.equal(battlePower, 770n, "Battle power should be calculated correctly");
    });

    it("Should apply rarity multiplier correctly", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 80, 60, 70, 0, 4, 500], // Legendary rarity
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const battlePower = await pokeDEXCustomCards.read.calculateBattlePower([1n]);

      // basePower = 770, rarityMultiplier = 300 (legendary), verifiedBonus = 100
      // result = (770 * 300 * 100) / 10000 = 2310
      assert.equal(battlePower, 2310n, "Legendary cards should have 3x multiplier");
    });

    it("Should apply verification bonus", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 80, 60, 70, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const verifyHash = await pokeDEXCustomCards.write.verifyCard([1n], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: verifyHash });

      const battlePower = await pokeDEXCustomCards.read.calculateBattlePower([1n]);

      // basePower = 770, rarityMultiplier = 100, verifiedBonus = 110
      // result = (770 * 100 * 110) / 10000 = 847
      assert.equal(battlePower, 847n, "Verified cards should have 10% bonus");
    });

    it("Should revert for banned cards", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 80, 60, 70, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const banHash = await pokeDEXCustomCards.write.banCard([1n, "inappropriate"], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: banHash });

      try {
        await pokeDEXCustomCards.read.calculateBattlePower([1n]);
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Card is banned/, "Should revert for banned card");
      }
    });
  });

  describe("Moderation", function () {
    it("Should allow moderator to verify card", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const verifyHash = await pokeDEXCustomCards.write.verifyCard([1n], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: verifyHash });

      const cardStats = await pokeDEXCustomCards.read.cardStats([1n]);
      assert.equal(cardStats[8], true, "Card should be verified");
    });

    it("Should emit CardVerified event", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const verifyHash = await pokeDEXCustomCards.write.verifyCard([1n], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: verifyHash });

      const logs = await pokeDEXCustomCards.getEvents.CardVerified();
      assert.equal(logs.length > 0, true, "CardVerified event should be emitted");
    });

    it("Should revert verify if not moderator", async function () {
      const { pokeDEXCustomCards, user1, user2, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      try {
        await pokeDEXCustomCards.write.verifyCard([1n], {
          account: user2.account,
        });
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(
          error.message,
          /AccessControlUnauthorizedAccount/,
          "Should revert without moderator role"
        );
      }
    });

    it("Should allow moderator to ban card", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const banHash = await pokeDEXCustomCards.write.banCard([1n, "inappropriate content"], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: banHash });

      const isBanned = await pokeDEXCustomCards.read.isBanned([1n]);
      assert.equal(isBanned, true, "Card should be banned");
    });

    it("Should emit CardBanned event", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const banHash = await pokeDEXCustomCards.write.banCard([1n, "test"], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: banHash });

      const logs = await pokeDEXCustomCards.getEvents.CardBanned();
      assert.equal(logs.length > 0, true, "CardBanned event should be emitted");
    });

    it("Should prevent transfer of banned cards", async function () {
      const { pokeDEXCustomCards, owner, user1, user2, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const banHash = await pokeDEXCustomCards.write.banCard([1n, "test"], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: banHash });

      try {
        await pokeDEXCustomCards.write.transferFrom(
          [user1.account.address, user2.account.address, 1n],
          {
            account: user1.account,
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Card is banned/, "Should prevent banned card transfer");
      }
    });

    it("Should allow moderator to unban card", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const banHash = await pokeDEXCustomCards.write.banCard([1n, "test"], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: banHash });

      const unbanHash = await pokeDEXCustomCards.write.unbanCard([1n], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: unbanHash });

      const isBanned = await pokeDEXCustomCards.read.isBanned([1n]);
      assert.equal(isBanned, false, "Card should be unbanned");
    });

    it("Should batch verify cards", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.batchCreateCards(
        [["ipfs://1", "ipfs://2", "ipfs://3"], 500],
        {
          account: user1.account,
          value: parseEther("0.003"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const verifyHash = await pokeDEXCustomCards.write.batchVerify([[1n, 2n, 3n]], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: verifyHash });

      const stats1 = await pokeDEXCustomCards.read.cardStats([1n]);
      const stats2 = await pokeDEXCustomCards.read.cardStats([2n]);
      const stats3 = await pokeDEXCustomCards.read.cardStats([3n]);

      assert.equal(stats1[8], true, "Card 1 should be verified");
      assert.equal(stats2[8], true, "Card 2 should be verified");
      assert.equal(stats3[8], true, "Card 3 should be verified");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set minting fee", async function () {
      const { pokeDEXCustomCards, owner, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const newFee = parseEther("0.002");
      const hash = await pokeDEXCustomCards.write.setMintingFee([newFee], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const mintingFee = await pokeDEXCustomCards.read.mintingFee();
      assert.equal(mintingFee, newFee, "Minting fee should be updated");
    });

    it("Should emit MintingFeeUpdated event", async function () {
      const { pokeDEXCustomCards, owner, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.setMintingFee([parseEther("0.002")], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const logs = await pokeDEXCustomCards.getEvents.MintingFeeUpdated();
      assert.equal(logs.length > 0, true, "MintingFeeUpdated event should be emitted");
    });

    it("Should allow admin to set default royalty", async function () {
      const { pokeDEXCustomCards, owner, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const newRoyalty = 750; // 7.5%
      const hash = await pokeDEXCustomCards.write.setDefaultRoyalty([newRoyalty], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const defaultRoyalty = await pokeDEXCustomCards.read.defaultRoyalty();
      assert.equal(defaultRoyalty, BigInt(newRoyalty), "Default royalty should be updated");
    });

    it("Should revert if default royalty exceeds max", async function () {
      const { pokeDEXCustomCards, owner } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.setDefaultRoyalty([1001], {
          account: owner.account,
        });
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /Royalty too high/, "Should revert with correct error");
      }
    });

    it("Should allow admin to set fee recipient", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.setFeeRecipient([user1.account.address], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const feeRecipient = await pokeDEXCustomCards.read.feeRecipient();
      assert.equal(
        feeRecipient.toLowerCase(),
        user1.account.address.toLowerCase(),
        "Fee recipient should be updated"
      );
    });

    it("Should allow admin to pause contract", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.pause({
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      try {
        await pokeDEXCustomCards.write.createCard(
          ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
          {
            account: user1.account,
            value: parseEther("0.001"),
          }
        );
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /EnforcedPause/, "Should be paused");
      }
    });

    it("Should allow admin to unpause contract", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const pauseHash = await pokeDEXCustomCards.write.pause({
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: pauseHash });

      const unpauseHash = await pokeDEXCustomCards.write.unpause({
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: unpauseHash });

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const totalSupply = await pokeDEXCustomCards.read.totalSupply();
      assert.equal(totalSupply, 1n, "Should be able to mint after unpause");
    });

    it("Should revert withdraw if no balance", async function () {
      const { pokeDEXCustomCards, owner } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.withdrawFees({
          account: owner.account,
        });
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(error.message, /No balance/, "Should revert with no balance");
      }
    });

    it("Should revert admin functions if not admin", async function () {
      const { pokeDEXCustomCards, user1 } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      try {
        await pokeDEXCustomCards.write.setMintingFee([parseEther("0.002")], {
          account: user1.account,
        });
        assert.fail("Should have reverted");
      } catch (error: any) {
        assert.match(
          error.message,
          /AccessControlUnauthorizedAccount/,
          "Should revert without admin role"
        );
      }
    });
  });

  describe("ERC721 & ERC2981 Compliance", function () {
    it("Should support ERC721 interface", async function () {
      const { pokeDEXCustomCards } = await networkHelpers.loadFixture(deployPokeDEXCustomCardsFixture);

      const ERC721_INTERFACE_ID = "0x80ac58cd";
      const supportsERC721 = await pokeDEXCustomCards.read.supportsInterface([
        ERC721_INTERFACE_ID,
      ]);
      assert.equal(supportsERC721, true, "Should support ERC721 interface");
    });

    it("Should support ERC2981 interface", async function () {
      const { pokeDEXCustomCards } = await networkHelpers.loadFixture(deployPokeDEXCustomCardsFixture);

      const ERC2981_INTERFACE_ID = "0x2a55205a";
      const supportsERC2981 = await pokeDEXCustomCards.read.supportsInterface([
        ERC2981_INTERFACE_ID,
      ]);
      assert.equal(supportsERC2981, true, "Should support ERC2981 interface");
    });

    it("Should allow safe transfer", async function () {
      const { pokeDEXCustomCards, user1, user2, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const transferHash = await pokeDEXCustomCards.write.safeTransferFrom(
        [user1.account.address, user2.account.address, 1n],
        {
          account: user1.account,
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: transferHash });

      const newOwner = await pokeDEXCustomCards.read.ownerOf([1n]);
      assert.equal(
        newOwner.toLowerCase(),
        user2.account.address.toLowerCase(),
        "Token should be transferred"
      );
    });

    it("Should return correct balance", async function () {
      const { pokeDEXCustomCards, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const hash1 = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      const hash2 = await pokeDEXCustomCards.write.createCard(
        ["ipfs://2", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user1.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      const balance = await pokeDEXCustomCards.read.balanceOf([user1.account.address]);
      assert.equal(balance, 2n, "Balance should be 2");
    });
  });

  describe("Access Control", function () {
    it("Should grant moderator role", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const MODERATOR_ROLE = await pokeDEXCustomCards.read.MODERATOR_ROLE();
      const hash = await pokeDEXCustomCards.write.grantRole(
        [MODERATOR_ROLE, user1.account.address],
        {
          account: owner.account,
        }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const hasRole = await pokeDEXCustomCards.read.hasRole([
        MODERATOR_ROLE,
        user1.account.address,
      ]);
      assert.equal(hasRole, true, "User should have moderator role");
    });

    it("Should allow new moderator to verify cards", async function () {
      const { pokeDEXCustomCards, owner, user1, user2, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const MODERATOR_ROLE = await pokeDEXCustomCards.read.MODERATOR_ROLE();
      const grantHash = await pokeDEXCustomCards.write.grantRole(
        [MODERATOR_ROLE, user1.account.address],
        {
          account: owner.account,
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: grantHash });

      const createHash = await pokeDEXCustomCards.write.createCard(
        ["ipfs://1", 100, 50, 50, 50, 0, 0, 500],
        {
          account: user2.account,
          value: parseEther("0.001"),
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: createHash });

      const verifyHash = await pokeDEXCustomCards.write.verifyCard([1n], {
        account: user1.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: verifyHash });

      const cardStats = await pokeDEXCustomCards.read.cardStats([1n]);
      assert.equal(cardStats[8], true, "Card should be verified by new moderator");
    });

    it("Should revoke moderator role", async function () {
      const { pokeDEXCustomCards, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployPokeDEXCustomCardsFixture
      );

      const MODERATOR_ROLE = await pokeDEXCustomCards.read.MODERATOR_ROLE();
      
      const grantHash = await pokeDEXCustomCards.write.grantRole(
        [MODERATOR_ROLE, user1.account.address],
        {
          account: owner.account,
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: grantHash });

      const revokeHash = await pokeDEXCustomCards.write.revokeRole(
        [MODERATOR_ROLE, user1.account.address],
        {
          account: owner.account,
        }
      );
      await publicClient.waitForTransactionReceipt({ hash: revokeHash });

      const hasRole = await pokeDEXCustomCards.read.hasRole([
        MODERATOR_ROLE,
        user1.account.address,
      ]);
      assert.equal(hasRole, false, "User should not have moderator role");
    });
  });
});