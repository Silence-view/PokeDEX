import { ethers } from "hardhat";

/**
 * Deploy new contracts: PokeDEXCustomCards, PokeDEXMarketplace, CardPackQRNG
 * These extend the base PokeDEX platform with user-created cards and marketplace
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("━".repeat(60));
  console.log("🚀 PokeDEX Extended Platform Deployment");
  console.log("━".repeat(60));
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Get existing contract addresses from env
  const POKEDEX_CARD = process.env.POKEDEX_CARD_ADDRESS;

  if (!POKEDEX_CARD) {
    console.log("\n⚠️  POKEDEX_CARD_ADDRESS not set. Deploy base contracts first.");
    console.log("Run: npm run deploy:sepolia");
    return;
  }

  // API3 QRNG Configuration for Sepolia
  // See: https://docs.api3.org/reference/qrng/chains.html
  const API3_AIRNODE_RRP = process.env.API3_AIRNODE_RRP || "0xa0AD79D995DdeeB18a14eAef56A549A04e3Aa1Bd";

  console.log("\n📋 Configuration:");
  console.log("   PokeDEXCard:", POKEDEX_CARD);
  console.log("   API3 Airnode RRP:", API3_AIRNODE_RRP);

  // 1. Deploy PokeDEXCustomCards
  console.log("\n1️⃣  Deploying PokeDEXCustomCards...");
  const CustomCards = await ethers.getContractFactory("PokeDEXCustomCards");
  const customCards = await CustomCards.deploy(
    deployer.address,  // admin
    deployer.address   // fee recipient
  );
  await customCards.waitForDeployment();
  const customCardsAddress = await customCards.getAddress();
  console.log("   ✅ PokeDEXCustomCards:", customCardsAddress);

  // 2. Deploy PokeDEXMarketplace
  console.log("\n2️⃣  Deploying PokeDEXMarketplace...");
  const Marketplace = await ethers.getContractFactory("PokeDEXMarketplace");
  const marketplace = await Marketplace.deploy(
    deployer.address,  // admin
    deployer.address   // fee recipient
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("   ✅ PokeDEXMarketplace:", marketplaceAddress);

  // 3. Deploy CardPackQRNG (free randomness!)
  console.log("\n3️⃣  Deploying CardPackQRNG...");
  const CardPackQRNG = await ethers.getContractFactory("CardPackQRNG");
  const cardPackQRNG = await CardPackQRNG.deploy(
    API3_AIRNODE_RRP,  // Airnode RRP contract
    POKEDEX_CARD,      // PokeDEXCard contract
    deployer.address   // admin
  );
  await cardPackQRNG.waitForDeployment();
  const cardPackQRNGAddress = await cardPackQRNG.getAddress();
  console.log("   ✅ CardPackQRNG:", cardPackQRNGAddress);

  // 4. Grant roles on PokeDEXCard
  console.log("\n4️⃣  Granting roles...");
  const pokeDEXCard = await ethers.getContractAt("PokeDEXCard", POKEDEX_CARD);
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const MARKETPLACE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MARKETPLACE_ROLE"));

  try {
    const tx = await pokeDEXCard.grantRole(MINTER_ROLE, cardPackQRNGAddress);
    await tx.wait();
    console.log("   ✅ Granted MINTER_ROLE to CardPackQRNG");
  } catch (error: any) {
    console.log("   ⚠️  Could not grant MINTER_ROLE. You may need to do this manually.");
    console.log("      Error:", error.message);
  }

  // Grant MARKETPLACE_ROLE to Marketplace for setLastSalePrice
  try {
    const tx = await pokeDEXCard.grantRole(MARKETPLACE_ROLE, marketplaceAddress);
    await tx.wait();
    console.log("   ✅ Granted MARKETPLACE_ROLE to Marketplace");
  } catch (error: any) {
    console.log("   ⚠️  Could not grant MARKETPLACE_ROLE. You may need to do this manually.");
    console.log("      Error:", error.message);
  }

  // 5. Summary
  console.log("\n" + "━".repeat(60));
  console.log("✅ Deployment Complete!");
  console.log("━".repeat(60));
  console.log("\n📜 New Contract Addresses:");
  console.log("   CUSTOM_CARDS_ADDRESS=" + customCardsAddress);
  console.log("   MARKETPLACE_ADDRESS=" + marketplaceAddress);
  console.log("   CARD_PACK_QRNG_ADDRESS=" + cardPackQRNGAddress);

  console.log("\n📝 Add these to your .env file:");
  console.log(`CUSTOM_CARDS_ADDRESS=${customCardsAddress}`);
  console.log(`MARKETPLACE_ADDRESS=${marketplaceAddress}`);
  console.log(`CARD_PACK_QRNG_ADDRESS=${cardPackQRNGAddress}`);

  console.log("\n⚠️  IMPORTANT: Configure API3 QRNG!");
  console.log("   After deployment, call setQRNGParameters on CardPackQRNG:");
  console.log("   - airnode: API3 QRNG Airnode address");
  console.log("   - endpointIdUint256Array: Endpoint ID for uint256[] requests");
  console.log("   - sponsorWallet: Your sponsor wallet (derive from your address)");
  console.log("\n   See: https://docs.api3.org/reference/qrng/providers.html");

  // Deployment info
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      PokeDEXCustomCards: customCardsAddress,
      PokeDEXMarketplace: marketplaceAddress,
      CardPackQRNG: cardPackQRNGAddress,
    },
    existingContracts: {
      PokeDEXCard: POKEDEX_CARD,
    },
  };

  console.log("\n📋 Deployment Info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
