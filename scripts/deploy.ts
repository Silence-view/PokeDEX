import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Chainlink VRF Configuration for Sepolia
  const VRF_COORDINATOR = process.env.VRF_COORDINATOR || "0x8103B0A8A00be2DDC778e6e7eaa21791Cd364625";
  const KEY_HASH = process.env.VRF_KEY_HASH || "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c";
  const SUBSCRIPTION_ID = process.env.VRF_SUBSCRIPTION_ID || "0";

  // 1. Deploy PokeDEXCard
  console.log("\n1. Deploying PokeDEXCard...");
  const PokeDEXCard = await ethers.getContractFactory("PokeDEXCard");
  const pokeDEXCard = await PokeDEXCard.deploy(deployer.address);
  await pokeDEXCard.waitForDeployment();
  const cardAddress = await pokeDEXCard.getAddress();
  console.log("PokeDEXCard deployed to:", cardAddress);

  // 2. Deploy CardPack
  console.log("\n2. Deploying CardPack...");
  const CardPack = await ethers.getContractFactory("CardPack");
  const cardPack = await CardPack.deploy(
    VRF_COORDINATOR,
    SUBSCRIPTION_ID,
    KEY_HASH,
    cardAddress,
    deployer.address
  );
  await cardPack.waitForDeployment();
  const packAddress = await cardPack.getAddress();
  console.log("CardPack deployed to:", packAddress);

  // 3. Deploy BattleArena
  console.log("\n3. Deploying BattleArena...");
  const BattleArena = await ethers.getContractFactory("BattleArena");
  const battleArena = await BattleArena.deploy(cardAddress, deployer.address);
  await battleArena.waitForDeployment();
  const arenaAddress = await battleArena.getAddress();
  console.log("BattleArena deployed to:", arenaAddress);

  // 4. Grant roles
  console.log("\n4. Setting up roles...");

  // Grant MINTER_ROLE to CardPack
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await pokeDEXCard.grantRole(MINTER_ROLE, packAddress);
  console.log("Granted MINTER_ROLE to CardPack");

  // Grant STATS_UPDATER_ROLE to BattleArena
  const STATS_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STATS_UPDATER_ROLE"));
  await pokeDEXCard.grantRole(STATS_UPDATER_ROLE, arenaAddress);
  console.log("Granted STATS_UPDATER_ROLE to BattleArena");

  // 5. Summary
  console.log("\n========================================");
  console.log("Deployment Complete!");
  console.log("========================================");
  console.log("PokeDEXCard:", cardAddress);
  console.log("CardPack:", packAddress);
  console.log("BattleArena:", arenaAddress);
  console.log("========================================");

  // Save deployment addresses
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    contracts: {
      PokeDEXCard: cardAddress,
      CardPack: packAddress,
      BattleArena: arenaAddress,
    },
    vrfConfig: {
      coordinator: VRF_COORDINATOR,
      keyHash: KEY_HASH,
      subscriptionId: SUBSCRIPTION_ID,
    },
    timestamp: new Date().toISOString(),
  };

  console.log("\nDeployment Info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
