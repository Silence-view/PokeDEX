import { describe, it } from "node:test";
import hre from "hardhat";
import { getAddress, parseEther, formatEther } from "viem";
import assert from "node:assert/strict";

const {viem, networkHelpers} =  await hre.network.connect();

describe("PokeDEXCard", async function () {
  // Enums matching the contract
  const PokemonType = {
    Normal: 0,
    Fire: 1,
    Water: 2,
    Electric: 3,
    Grass: 4,
    Ice: 5,
    Fighting: 6,
    Poison: 7,
    Ground: 8,
    Flying: 9,
    Psychic: 10,
    Bug: 11,
    Rock: 12,
    Ghost: 13,
    Dragon: 14,
    Dark: 15,
    Steel: 16,
    Fairy: 17
  };

  const Rarity = {
    Common: 0,
    Uncommon: 1,
    Rare: 2,
    UltraRare: 3,
    Legendary: 4
  };

  // Helper function to create sample card stats
  function createCardStats(overrides = {}) {
    return {
      pokemonType: overrides.pokemonType ?? PokemonType.Fire,
      rarity: overrides.rarity ?? Rarity.Common,
      generation: overrides.generation ?? 1,
      hp: overrides.hp ?? 100,
      attack: overrides.attack ?? 50,
      defense: overrides.defense ?? 50,
      speed: overrides.speed ?? 50,
      experience: overrides.experience ?? 0
    };
  }

  // Fixture for deploying the contract
  async function deployPokeDEXCardFixture() {
    const [owner, minter, statsUpdater, marketplace, user1, user2, user3] = await viem.getWalletClients();

    const pokeDEXCard = await viem.deployContract("PokeDEXCard", [owner.account.address]);
    const publicClient = await viem.getPublicClient();

    // Grant roles
    const MINTER_ROLE = await pokeDEXCard.read.MINTER_ROLE();
    const STATS_UPDATER_ROLE = await pokeDEXCard.read.STATS_UPDATER_ROLE();
    const MARKETPLACE_ROLE = await pokeDEXCard.read.MARKETPLACE_ROLE();

    await pokeDEXCard.write.grantRole([MINTER_ROLE, minter.account.address], { account: owner.account });
    await pokeDEXCard.write.grantRole([STATS_UPDATER_ROLE, statsUpdater.account.address], { account: owner.account });
    await pokeDEXCard.write.grantRole([MARKETPLACE_ROLE, marketplace.account.address], { account: owner.account });
    

    return {
      pokeDEXCard,
      owner,
      minter,
      statsUpdater,
      marketplace,
      user1,
      user2,
      user3,
      MINTER_ROLE,
      STATS_UPDATER_ROLE,
      MARKETPLACE_ROLE,
      publicClient
    };
  }

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      const { pokeDEXCard } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const name = await pokeDEXCard.read.name();
      const symbol = await pokeDEXCard.read.symbol();
      
      assert.equal(name, "PokeDEX Card");
      assert.equal(symbol, "PDEX");
    });

    it("Should grant admin roles correctly", async function () {
      const { pokeDEXCard, owner } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const DEFAULT_ADMIN_ROLE = await pokeDEXCard.read.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await pokeDEXCard.read.MINTER_ROLE();
      const STATS_UPDATER_ROLE = await pokeDEXCard.read.STATS_UPDATER_ROLE();

      const hasDefaultAdmin = await pokeDEXCard.read.hasRole([DEFAULT_ADMIN_ROLE, owner.account.address]);
      const hasMinterRole = await pokeDEXCard.read.hasRole([MINTER_ROLE, owner.account.address]);
      const hasStatsUpdaterRole = await pokeDEXCard.read.hasRole([STATS_UPDATER_ROLE, owner.account.address]);

      assert.ok(hasDefaultAdmin);
      assert.ok(hasMinterRole);
      assert.ok(hasStatsUpdaterRole);
    });

    it("Should revert if admin address is zero", async function () {
      const zeroAddress = "0x0000000000000000000000000000000000000000";

      await assert.rejects(
        async () => {
          await viem.deployContract("PokeDEXCard", [zeroAddress]);
        },
        (error) => {
          assert.match(error.message, /Invalid admin address/);
          return true;
        }
      );
    });

    it("Should set correct constants", async function () {
      const { pokeDEXCard } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const maxStat = await pokeDEXCard.read.MAX_STAT();
      const maxExperience = await pokeDEXCard.read.MAX_EXPERIENCE();
      const maxTradeCount = await pokeDEXCard.read.MAX_TRADE_COUNT();
      
      assert.equal(maxStat, 255);
      assert.equal(maxExperience, 1000000);
      assert.equal(maxTradeCount, 4294967294);
    });
  });

  describe("Minting", function () {
    describe("Single Card Minting", function () {
      it("Should mint a card successfully", async function () {
        const { pokeDEXCard, publicClient, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        const stats = createCardStats();
        const uri = "ipfs://QmTest123";

        const hash = await pokeDEXCard.write.mintCard(
          [user1.account.address, uri, stats],
          { account: minter.account }
        );
        
        // Wait for transaction and get receipt
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        
        // Check for CardMinted event
        const logs = await pokeDEXCard.getEvents.CardMinted();
        const mintEvent = logs.find(log => log.transactionHash === hash);

        
        assert.ok(mintEvent, "CardMinted event should be emitted");
        assert.equal(mintEvent.args.tokenId, 1n);
        assert.equal(mintEvent.args.owner.toLowerCase(), user1.account.address.toLowerCase());
        assert.equal(mintEvent.args.pokemonType, stats.pokemonType);
        assert.equal(mintEvent.args.rarity, stats.rarity);

        const owner = await pokeDEXCard.read.ownerOf([1n]);
        const tokenUri = await pokeDEXCard.read.tokenURI([1n]);
        
        assert.equal(owner.toLowerCase(), user1.account.address.toLowerCase());
        assert.equal(tokenUri, uri);
      });

      it("Should store card stats correctly", async function () {
        const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        const stats = createCardStats({
          pokemonType: PokemonType.Water,
          rarity: Rarity.Rare,
          hp: 120,
          attack: 80,
          defense: 70,
          speed: 90,
          generation: 3,
          experience: 1000
        });

        await pokeDEXCard.write.mintCard(
          [user1.account.address, "ipfs://test", stats],
          { account: minter.account }
        );
        
        const retrievedStats = await pokeDEXCard.read.getCardStats([1n]);

        assert.equal(retrievedStats.pokemonType, stats.pokemonType);
        assert.equal(retrievedStats.rarity, stats.rarity);
        assert.equal(retrievedStats.hp, stats.hp);
        assert.equal(retrievedStats.attack, stats.attack);
        assert.equal(retrievedStats.defense, stats.defense);
        assert.equal(retrievedStats.speed, stats.speed);
        assert.equal(retrievedStats.generation, stats.generation);
        assert.equal(retrievedStats.experience, stats.experience);
      });

      it("Should revert if minter role is missing", async function () {
        const { pokeDEXCard, user1, user2 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        const stats = createCardStats();

        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user2.account.address, "ipfs://test", stats],
              { account: user1.account }
            );
          }
        );
      });

      it("Should revert if minting to zero address", async function () {
        const { pokeDEXCard, minter } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        const stats = createCardStats();
        const zeroAddress = "0x0000000000000000000000000000000000000000";

        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [zeroAddress, "ipfs://test", stats],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Cannot mint to zero address/);
            return true;
          }
        );
      });

      it("Should revert if URI is empty", async function () {
        const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        const stats = createCardStats();

        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, "", stats],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /URI cannot be empty/);
            return true;
          }
        );
      });

      it("Should revert if stats are invalid", async function () {
        const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

        // Invalid HP (0)
        let stats = createCardStats({ hp: 0 });
        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, "ipfs://test", stats],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Invalid HP/);
            return true;
          }
        );

        // Invalid HP (> MAX_STAT)
        stats = createCardStats({ hp: 256 });
        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, "ipfs://test", stats],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Invalid HP/);
            return true;
          }
        );

        // Invalid generation (0)
        stats = createCardStats({ generation: 0 });
        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, "ipfs://test", stats],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Invalid generation/);
            return true;
          }
        );

        // Invalid generation (> 9)
        stats = createCardStats({ generation: 10 });
        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, "ipfs://test", stats],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Invalid generation/);
            return true;
          }
        );
      });

      it("Should revert if contract is paused", async function () {
        const { pokeDEXCard, owner, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        const stats = createCardStats();

        await pokeDEXCard.write.pause([], { account: owner.account });
        
        await assert.rejects(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, "ipfs://test", stats],
              { account: minter.account }
            );
          }
        );
      });

      it("Should increment token IDs correctly", async function () {
        const { pokeDEXCard, publicClient, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        const stats1 = createCardStats({ hp: 100 });
        const stats2 = createCardStats({ hp: 150 });

        // Mint first card
        const hash1 = await pokeDEXCard.write.mintCard(
          [user1.account.address, "ipfs://card1", stats1],
          { account: minter.account }
        );

        // Check first card event
        const logs1 = await pokeDEXCard.getEvents.CardMinted();
        const event1 = logs1.find(log => log.transactionHash === hash1);
        assert.ok(event1, "First CardMinted event should be emitted");
        assert.equal(event1.args.tokenId, 1n); // First token ID should be 1

        // Mint second card
        const hash2 = await pokeDEXCard.write.mintCard(
          [user1.account.address, "ipfs://card2", stats2],
          { account: minter.account }
        );

        // Check second card event
        const logs2 = await pokeDEXCard.getEvents.CardMinted();
        const event2 = logs2.find(log => log.transactionHash === hash2);
        assert.ok(event2, "Second CardMinted event should be emitted");
        assert.equal(event2.args.tokenId, 2n); // Second token ID should be 2

        // Verify both cards exist and belong to user1
        const owner1 = await pokeDEXCard.read.ownerOf([1n]);
        const owner2 = await pokeDEXCard.read.ownerOf([2n]);
        
        assert.equal(owner1.toLowerCase(), user1.account.address.toLowerCase());
        assert.equal(owner2.toLowerCase(), user1.account.address.toLowerCase());

        // Verify different stats were stored
        const retrievedStats1 = await pokeDEXCard.read.getCardStats([1n]);
        const retrievedStats2 = await pokeDEXCard.read.getCardStats([2n]);
        
        assert.equal(retrievedStats1.hp, 100);
        assert.equal(retrievedStats2.hp, 150);
        assert.notEqual(event1.args.tokenId, event2.args.tokenId);
        assert.equal(await pokeDEXCard.read.totalSupply(), 2n);
    });

    });

    describe("Batch Minting", function () {
      it("Should batch mint multiple cards", async function () {
        const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        
        const uris = ["ipfs://test1", "ipfs://test2", "ipfs://test3"];
        const statsArray = [
          createCardStats({ hp: 100 }),
          createCardStats({ hp: 120 }),
          createCardStats({ hp: 140 })
        ];

        await pokeDEXCard.write.batchMintCards(
          [user1.account.address, uris, statsArray],
          { account: minter.account }
        );

        // Check that cards were minted
        const owner1 = await pokeDEXCard.read.ownerOf([1n]);
        const owner2 = await pokeDEXCard.read.ownerOf([2n]);
        const owner3 = await pokeDEXCard.read.ownerOf([3n]);
        
        assert.equal(owner1.toLowerCase(), user1.account.address.toLowerCase());
        assert.equal(owner2.toLowerCase(), user1.account.address.toLowerCase());
        assert.equal(owner3.toLowerCase(), user1.account.address.toLowerCase());

        // Check stats
        const stats1 = await pokeDEXCard.read.getCardStats([1n]);
        const stats2 = await pokeDEXCard.read.getCardStats([2n]);
        const stats3 = await pokeDEXCard.read.getCardStats([3n]);

        assert.equal(stats1.hp, 100);
        assert.equal(stats2.hp, 120);
        assert.equal(stats3.hp, 140);
      });

      it("Should revert if arrays length mismatch", async function () {
        const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        
        const uris = ["ipfs://test1", "ipfs://test2"];
        const statsArray = [createCardStats()];

        await assert.rejects(
          async () => {
            await pokeDEXCard.write.batchMintCards(
              [user1.account.address, uris, statsArray],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Arrays length mismatch/);
            return true;
          }
        );
      });

      it("Should revert if batch size is 0", async function () {
        const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        
        await assert.rejects(
          async () => {
            await pokeDEXCard.write.batchMintCards(
              [user1.account.address, [], []],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Invalid batch size/);
            return true;
          }
        );
      });

      it("Should revert if batch size exceeds 20", async function () {
        const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
        
        const uris = Array(21).fill("ipfs://test");
        const statsArray = Array(21).fill(createCardStats());

        await assert.rejects(
          async () => {
            await pokeDEXCard.write.batchMintCards(
              [user1.account.address, uris, statsArray],
              { account: minter.account }
            );
          },
          (error) => {
            assert.match(error.message, /Invalid batch size/);
            return true;
          }
        );
      });
    });
  });

  describe("Transfer and Trade Tracking", function () {
    it("Should track trade count on transfer", async function () {
      const { pokeDEXCard, minter, user1, user2 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      const tradeCountBefore = await pokeDEXCard.read.getTradeCount([1n]);
      assert.equal(tradeCountBefore, 0);

      const hash = await pokeDEXCard.write.transferFrom(
        [user1.account.address, user2.account.address, 1n],
        { account: user1.account }
      );

      // Check for CardTransferred event
      const logs = await pokeDEXCard.getEvents.CardTransferred();
      const transferEvent = logs.find(log => log.transactionHash === hash);
      
      assert.ok(transferEvent, "CardTransferred event should be emitted");
      // Access event args by array index: [tokenId, from, to, tradeCount]
      assert.equal(transferEvent.args.tokenId, 1n); // tokenId
      assert.equal(transferEvent.args.from?.toLowerCase(), user1.account.address.toLowerCase()); // from
      assert.equal(transferEvent.args.to?.toLowerCase(), user2.account.address.toLowerCase()); // to
      assert.equal(transferEvent.args.tradeCount, 1); // tradeCount

      const tradeCountAfter = await pokeDEXCard.read.getTradeCount([1n]);
      assert.equal(tradeCountAfter, 1);
    });

    it("Should not increment trade count on mint", async function () {
      const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      const tradeCount = await pokeDEXCard.read.getTradeCount([1n]);
      assert.equal(tradeCount, 0);
    });

    it("Should cap trade count at MAX_TRADE_COUNT", async function () {
      const { pokeDEXCard } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      
      // We can't actually do 4+ billion transfers in a test, so we'll verify the constant is set correctly
      const maxTradeCount = await pokeDEXCard.read.MAX_TRADE_COUNT();
      assert.equal(maxTradeCount, 4294967294);
    });

    it("Should update acquired timestamp on transfer", async function () {
      const { pokeDEXCard, minter, user1, user2 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      const metricsBefore = await pokeDEXCard.read.getCardMetrics([1n]);
      
      // Advance time
      await networkHelpers.time.increase(86400); // 1 day
      
      await pokeDEXCard.write.transferFrom(
        [user1.account.address, user2.account.address, 1n],
        { account: user1.account }
      );
      
      const metricsAfter = await pokeDEXCard.read.getCardMetrics([1n]);
      
      // After transfer, holder days should reset to 0
      assert.equal(metricsAfter.holderDays, 0n);
    });
  });

  describe("Card Metrics", function () {
    it("Should return correct card metrics", async function () {
      const { pokeDEXCard, minter, user1, user2 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      // Initial metrics
      let metrics = await pokeDEXCard.read.getCardMetrics([1n]);
      assert.equal(metrics.tradeCount, 0);
      assert.equal(metrics.holderDays, 0n);
      assert.equal(metrics.isVeteranCard, false);

      // Advance time and check holder days
      await networkHelpers.time.increase(86400 * 35); // 35 days
      
      metrics = await pokeDEXCard.read.getCardMetrics([1n]);
      assert.equal(metrics.holderDays, 35n);
      assert.equal(metrics.isVeteranCard, true);

      // Transfer and check trade count
      await pokeDEXCard.write.transferFrom(
        [user1.account.address, user2.account.address, 1n],
        { account: user1.account }
      );
      
      metrics = await pokeDEXCard.read.getCardMetrics([1n]);
      assert.equal(metrics.tradeCount, 1);
      assert.equal(metrics.holderDays, 0n); // Reset after transfer
      assert.equal(metrics.isVeteranCard, false);
    });

    it("Should track last sale price", async function () {
      const { pokeDEXCard, minter, marketplace, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      const salePrice = parseEther("1.5");
      await pokeDEXCard.write.setLastSalePrice(
        [1n, salePrice],
        { account: marketplace.account }
      );

      const metrics = await pokeDEXCard.read.getCardMetrics([1n]);
      assert.equal(metrics.lastSalePrice, salePrice);
    });

    it("Should revert setLastSalePrice without marketplace role", async function () {
      const { pokeDEXCard, minter, user1, user2 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      await assert.rejects(
        async () => {
          await pokeDEXCard.write.setLastSalePrice(
            [1n, parseEther("1")],
            { account: user2.account }
          );
        }
      );
    });
  });

  describe("Access Control", function () {
    it("Should allow admin to grant roles", async function () {
      const { pokeDEXCard, owner, user1, MINTER_ROLE } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

      await pokeDEXCard.write.grantRole(
        [MINTER_ROLE, user1.account.address],
        { account: owner.account }
      );
      
      const hasRole = await pokeDEXCard.read.hasRole([MINTER_ROLE, user1.account.address]);
      assert.ok(hasRole);
    });

    it("Should allow admin to revoke roles", async function () {
      const { pokeDEXCard, owner, minter, MINTER_ROLE } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

      await pokeDEXCard.write.revokeRole(
        [MINTER_ROLE, minter.account.address],
        { account: owner.account }
      );
      
      const hasRole = await pokeDEXCard.read.hasRole([MINTER_ROLE, minter.account.address]);
      assert.ok(!hasRole);
    });

    it("Should not allow non-admin to grant roles", async function () {
      const { pokeDEXCard, user1, user2, MINTER_ROLE } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

      await assert.rejects(
        async () => {
          await pokeDEXCard.write.grantRole(
            [MINTER_ROLE, user2.account.address],
            { account: user1.account }
          );
        }
      );
    });
  });

  describe("Pausable", function () {
    it("Should allow admin to pause and unpause", async function () {
      const { pokeDEXCard, owner } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

      await pokeDEXCard.write.pause([], { account: owner.account });
      const pausedAfterPause = await pokeDEXCard.read.paused();
      assert.ok(pausedAfterPause);

      await pokeDEXCard.write.unpause([], { account: owner.account });
      const pausedAfterUnpause = await pokeDEXCard.read.paused();
      assert.ok(!pausedAfterUnpause);
    });

    it("Should prevent minting when paused", async function () {
      const { pokeDEXCard, owner, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.pause([], { account: owner.account });

      await assert.rejects(
        async () => {
          await pokeDEXCard.write.mintCard(
            [user1.account.address, "ipfs://test", stats],
            { account: minter.account }
          );
        }
      );
    });

    it("Should prevent adding experience when paused", async function () {
      const { pokeDEXCard, owner, minter, statsUpdater, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      await pokeDEXCard.write.pause([], { account: owner.account });

      await assert.rejects(
        async () => {
          await pokeDEXCard.write.addExperience(
            [1n, 100],
            { account: statsUpdater.account }
          );
        }
      );
    });

    it("Should not allow non-admin to pause", async function () {
      const { pokeDEXCard, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

      await assert.rejects(
        async () => {
          await pokeDEXCard.write.pause([], { account: user1.account });
        }
      );
    });
  });

  describe("ERC721 Standard Functions", function () {
    it("Should support ERC721 interface", async function () {
      const { pokeDEXCard } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      
      // ERC721 interface ID
      const supportsInterface = await pokeDEXCard.read.supportsInterface(["0x80ac58cd"]);
      assert.ok(supportsInterface);
    });

    it("Should allow approved address to transfer", async function () {
      const { pokeDEXCard, minter, user1, user2 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      await pokeDEXCard.write.approve(
        [user2.account.address, 1n],
        { account: user1.account }
      );
      
      await pokeDEXCard.write.transferFrom(
        [user1.account.address, user2.account.address, 1n],
        { account: user2.account }
      );

      const owner = await pokeDEXCard.read.ownerOf([1n]);
      assert.equal(owner.toLowerCase(), user2.account.address.toLowerCase());
    });

    it("Should allow operator to transfer", async function () {
      const { pokeDEXCard, minter, user1, user2 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      await pokeDEXCard.write.setApprovalForAll(
        [user2.account.address, true],
        { account: user1.account }
      );
      
      await pokeDEXCard.write.transferFrom(
        [user1.account.address, user2.account.address, 1n],
        { account: user2.account }
      );

      const owner = await pokeDEXCard.read.ownerOf([1n]);
      assert.equal(owner.toLowerCase(), user2.account.address.toLowerCase());
    });

    it("Should revert transfer from non-owner without approval", async function () {
      const { pokeDEXCard, minter, user1, user2, user3 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      await assert.rejects(
        async () => {
          await pokeDEXCard.write.transferFrom(
            [user1.account.address, user3.account.address, 1n],
            { account: user2.account }
          );
        }
      );
    });
  });

  describe("Token URI", function () {
    it("Should return correct token URI", async function () {
      const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats();
      const uri = "ipfs://QmTest123";

      await pokeDEXCard.write.mintCard(
        [user1.account.address, uri, stats],
        { account: minter.account }
      );
      
      const tokenUri = await pokeDEXCard.read.tokenURI([1n]);
      assert.equal(tokenUri, uri);
    });

    it("Should revert for non-existent token", async function () {
      const { pokeDEXCard } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      
      await assert.rejects(
        async () => {
          await pokeDEXCard.read.tokenURI([999n]);
        }
      );
    });
  });

  describe("Edge Cases and Gas Optimization", function () {
    it("Should handle maximum stat values", async function () {
      const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats({
        hp: 255,
        attack: 255,
        defense: 255,
        speed: 255
      });

      await assert.doesNotReject(
        async () => {
          await pokeDEXCard.write.mintCard(
            [user1.account.address, "ipfs://test", stats],
            { account: minter.account }
          );
        }
      );
    });

    it("Should handle maximum experience", async function () {
      const { pokeDEXCard, minter, statsUpdater, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);
      const stats = createCardStats({ experience: 1000000 });

      await pokeDEXCard.write.mintCard(
        [user1.account.address, "ipfs://test", stats],
        { account: minter.account }
      );
      
      // Try adding more experience
      await pokeDEXCard.write.addExperience(
        [1n, 1000],
        { account: statsUpdater.account }
      );
      
      const updatedStats = await pokeDEXCard.read.getCardStats([1n]);
      assert.equal(updatedStats.experience, 1000000);
    });

    it("Should handle all Pokemon types", async function () {
      const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

      for (let type = 0; type <= 17; type++) {
        const stats = createCardStats({ pokemonType: type });
        await assert.doesNotReject(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, `ipfs://type${type}`, stats],
              { account: minter.account }
            );
          }
        );
      }
    });

    it("Should handle all rarities", async function () {
      const { pokeDEXCard, minter, user1 } = await networkHelpers.loadFixture(deployPokeDEXCardFixture);

      for (let rarity = 0; rarity <= 4; rarity++) {
        const stats = createCardStats({ rarity: rarity });
        await assert.doesNotReject(
          async () => {
            await pokeDEXCard.write.mintCard(
              [user1.account.address, `ipfs://rarity${rarity}`, stats],
              { account: minter.account }
            );
          }
        );
      }
    });
  });

  /*

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
  */
});
