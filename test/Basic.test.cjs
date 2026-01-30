const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PokeDEX Contracts", function () {
  describe("PokeDEXCard", function () {
    let pokeDEXCard;
    let owner, user1, user2;

    beforeEach(async function () {
      [owner, user1, user2] = await ethers.getSigners();

      const PokeDEXCard = await ethers.getContractFactory("PokeDEXCard");
      pokeDEXCard = await PokeDEXCard.deploy(owner.address);
      await pokeDEXCard.waitForDeployment();
    });

    it("Should deploy correctly", async function () {
      expect(await pokeDEXCard.name()).to.equal("PokeDEX Card");
      expect(await pokeDEXCard.symbol()).to.equal("PDEX");
    });

    it("Should mint a card", async function () {
      const stats = {
        hp: 100,
        attack: 80,
        defense: 70,
        speed: 90,
        pokemonType: 1,
        rarity: 2,
        generation: 1,
        experience: 0
      };

      await pokeDEXCard.mintCard(user1.address, "ipfs://card1", stats);
      expect(await pokeDEXCard.balanceOf(user1.address)).to.equal(1);
      expect(await pokeDEXCard.ownerOf(1)).to.equal(user1.address);
    });

    it("Should track trade count on transfer", async function () {
      const stats = {
        hp: 100,
        attack: 80,
        defense: 70,
        speed: 90,
        pokemonType: 1,
        rarity: 2,
        generation: 1,
        experience: 0
      };

      await pokeDEXCard.mintCard(user1.address, "ipfs://card1", stats);

      // Initial trade count should be 0
      expect(await pokeDEXCard.getTradeCount(1)).to.equal(0);

      // Transfer from user1 to user2
      await pokeDEXCard.connect(user1).transferFrom(user1.address, user2.address, 1);

      // Trade count should be 1
      expect(await pokeDEXCard.getTradeCount(1)).to.equal(1);
    });

    it("Should calculate battle power with metrics", async function () {
      const stats = {
        hp: 100,
        attack: 80,
        defense: 70,
        speed: 90,
        pokemonType: 1,
        rarity: 2, // Rare
        generation: 1,
        experience: 1000
      };

      await pokeDEXCard.mintCard(user1.address, "ipfs://card1", stats);

      const power = await pokeDEXCard.calculateBattlePowerWithMetrics(1);
      expect(power).to.be.gt(0);
    });
  });

  describe("BattleArena", function () {
    let battleArena, pokeDEXCard;
    let owner, player1, player2;

    beforeEach(async function () {
      [owner, player1, player2] = await ethers.getSigners();

      // Deploy PokeDEXCard
      const PokeDEXCard = await ethers.getContractFactory("PokeDEXCard");
      pokeDEXCard = await PokeDEXCard.deploy(owner.address);
      await pokeDEXCard.waitForDeployment();

      // Deploy BattleArena (cardContract, admin)
      const BattleArena = await ethers.getContractFactory("BattleArena");
      battleArena = await BattleArena.deploy(
        await pokeDEXCard.getAddress(),
        owner.address
      );
      await battleArena.waitForDeployment();

      // Grant STATS_UPDATER_ROLE to BattleArena contract (for addExperience)
      const STATS_UPDATER_ROLE = await pokeDEXCard.STATS_UPDATER_ROLE();
      await pokeDEXCard.grantRole(STATS_UPDATER_ROLE, await battleArena.getAddress());

      // Mint cards for players
      const stats1 = {
        hp: 100, attack: 80, defense: 70, speed: 90,
        pokemonType: 1, rarity: 2, generation: 1, experience: 0
      };
      const stats2 = {
        hp: 120, attack: 70, defense: 80, speed: 85,
        pokemonType: 2, rarity: 2, generation: 1, experience: 0
      };

      await pokeDEXCard.mintCard(player1.address, "ipfs://card1", stats1);
      await pokeDEXCard.mintCard(player2.address, "ipfs://card2", stats2);
    });

    it("Should deploy correctly", async function () {
      expect(await battleArena.cardContract()).to.equal(await pokeDEXCard.getAddress());
    });

    it("Should create a challenge", async function () {
      await battleArena.connect(player1).createChallenge(player2.address, 1);

      const battle = await battleArena.getBattle(1);
      expect(battle.challenger).to.equal(player1.address);
      expect(battle.opponent).to.equal(player2.address);
      expect(battle.status).to.equal(0); // Pending
    });

    it("Should create a challenge with bet", async function () {
      const betAmount = ethers.parseEther("0.01");

      await battleArena.connect(player1).createChallengeWithBet(
        player2.address,
        1,
        { value: betAmount }
      );

      const bet = await battleArena.getBattleBet(1);
      expect(bet.challengerStake).to.equal(betAmount);
      expect(bet.bettingEnabled).to.be.true;
    });

    it("Should accept challenge with matching bet and distribute winnings", async function () {
      const betAmount = ethers.parseEther("0.01");

      // Create challenge with bet
      await battleArena.connect(player1).createChallengeWithBet(
        player2.address,
        1,
        { value: betAmount }
      );

      // Accept with matching bet
      await battleArena.connect(player2).acceptChallengeWithBet(
        1,
        2,
        { value: betAmount }
      );

      const battle = await battleArena.getBattle(1);
      expect(battle.status).to.equal(2); // Completed
      expect(battle.winner).to.not.equal(ethers.ZeroAddress);

      // Check bet is paid
      const bet = await battleArena.getBattleBet(1);
      expect(bet.paid).to.be.true;
    });

    it("Should track player stats", async function () {
      await battleArena.connect(player1).createChallenge(player2.address, 1);
      await battleArena.connect(player2).acceptChallenge(1, 2);

      const stats1 = await battleArena.getPlayerStats(player1.address);
      const stats2 = await battleArena.getPlayerStats(player2.address);

      expect(stats1.totalBattles).to.equal(1);
      expect(stats2.totalBattles).to.equal(1);
      expect(Number(stats1.wins) + Number(stats2.wins)).to.equal(1);
    });

    it("Should calculate battle power using metrics formula", async function () {
      // The battle power formula should use:
      // BaseStats × RarityMultiplier + TradeCount×10 + LastSalePrice/0.01ETH + Random

      await battleArena.connect(player1).createChallenge(player2.address, 1);
      await battleArena.connect(player2).acceptChallenge(1, 2);

      // After battle, one player should have a win
      const battle = await battleArena.getBattle(1);
      expect(battle.winner).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("PokeDEXMarketplace", function () {
    let marketplace, pokeDEXCard;
    let owner, seller, buyer, feeRecipient;

    beforeEach(async function () {
      [owner, seller, buyer, feeRecipient] = await ethers.getSigners();

      // Deploy PokeDEXCard
      const PokeDEXCard = await ethers.getContractFactory("PokeDEXCard");
      pokeDEXCard = await PokeDEXCard.deploy(owner.address);
      await pokeDEXCard.waitForDeployment();

      // Deploy Marketplace (admin, feeRecipient, pokeDEXCard)
      const Marketplace = await ethers.getContractFactory("PokeDEXMarketplace");
      marketplace = await Marketplace.deploy(
        owner.address,
        feeRecipient.address,
        await pokeDEXCard.getAddress()
      );
      await marketplace.waitForDeployment();

      // Grant MARKETPLACE_ROLE to marketplace
      const MARKETPLACE_ROLE = await pokeDEXCard.MARKETPLACE_ROLE();
      await pokeDEXCard.grantRole(MARKETPLACE_ROLE, await marketplace.getAddress());

      // Mint a card for seller
      const stats = {
        hp: 100, attack: 80, defense: 70, speed: 90,
        pokemonType: 1, rarity: 2, generation: 1, experience: 0
      };
      await pokeDEXCard.mintCard(seller.address, "ipfs://card1", stats);
    });

    it("Should deploy correctly", async function () {
      expect(await marketplace.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Should list an NFT with image", async function () {
      const price = ethers.parseEther("0.1");

      // Approve marketplace
      await pokeDEXCard.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

      // List NFT with image URI
      await marketplace.connect(seller).listNFT(
        await pokeDEXCard.getAddress(),
        1,
        price,
        "ipfs://QmImageHash123"
      );

      const listing = await marketplace.getListing(1);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(price);
      expect(listing.active).to.be.true;
      expect(listing.imageURI).to.equal("ipfs://QmImageHash123");
    });

    it("Should buy an NFT and pay fees", async function () {
      const price = ethers.parseEther("0.1");

      // Approve and list
      await pokeDEXCard.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
      await marketplace.connect(seller).listNFT(
        await pokeDEXCard.getAddress(),
        1,
        price,
        "ipfs://image"
      );

      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
      const feeRecipientBalanceBefore = await ethers.provider.getBalance(feeRecipient.address);

      // Buy
      await marketplace.connect(buyer).buyNFT(1, { value: price });

      // Verify ownership transfer
      expect(await pokeDEXCard.ownerOf(1)).to.equal(buyer.address);

      // Verify listing is inactive
      const listing = await marketplace.getListing(1);
      expect(listing.active).to.be.false;

      // Verify fees were paid
      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
      const feeRecipientBalanceAfter = await ethers.provider.getBalance(feeRecipient.address);

      // Seller should receive price minus fee
      expect(sellerBalanceAfter).to.be.gt(sellerBalanceBefore);
      // Fee recipient should receive fee
      expect(feeRecipientBalanceAfter).to.be.gt(feeRecipientBalanceBefore);
    });

    it("Should track NFT stats after sale", async function () {
      const price = ethers.parseEther("0.1");

      await pokeDEXCard.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
      await marketplace.connect(seller).listNFT(
        await pokeDEXCard.getAddress(),
        1,
        price,
        "ipfs://image"
      );

      await marketplace.connect(buyer).buyNFT(1, { value: price });

      const stats = await marketplace.nftStats(await pokeDEXCard.getAddress(), 1);
      expect(stats.tradeCount).to.equal(1);
      expect(stats.lastSalePrice).to.equal(price);
      expect(stats.lastBuyer).to.equal(buyer.address);
    });

    it("Should update card lastSalePrice in PokeDEXCard", async function () {
      const price = ethers.parseEther("0.1");

      await pokeDEXCard.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
      await marketplace.connect(seller).listNFT(
        await pokeDEXCard.getAddress(),
        1,
        price,
        "ipfs://image"
      );

      await marketplace.connect(buyer).buyNFT(1, { value: price });

      // The marketplace should have called setLastSalePrice on PokeDEXCard
      const metrics = await pokeDEXCard.getCardMetrics(1);
      expect(metrics.lastSalePrice).to.equal(price);
    });
  });
});
