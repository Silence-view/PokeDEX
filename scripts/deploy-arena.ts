import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying BattleArena with account:", deployer.address);

  const POKEDEX_CARD = process.env.POKEDEX_CARD_ADDRESS;

  if (!POKEDEX_CARD) {
    throw new Error("POKEDEX_CARD_ADDRESS not set in .env");
  }

  console.log("Using PokeDEXCard at:", POKEDEX_CARD);

  // Deploy BattleArena
  const BattleArena = await ethers.getContractFactory("BattleArena");
  const battleArena = await BattleArena.deploy(POKEDEX_CARD, deployer.address);
  await battleArena.waitForDeployment();

  const arenaAddress = await battleArena.getAddress();
  console.log("BattleArena deployed to:", arenaAddress);

  // Grant STATS_UPDATER_ROLE to BattleArena on PokeDEXCard
  console.log("\nGranting STATS_UPDATER_ROLE...");
  const pokeDEXCard = await ethers.getContractAt("PokeDEXCard", POKEDEX_CARD);
  const STATS_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STATS_UPDATER_ROLE"));
  await pokeDEXCard.grantRole(STATS_UPDATER_ROLE, arenaAddress);
  console.log("✅ Role granted!");

  console.log("\n========================================");
  console.log("Add to .env:");
  console.log(`BATTLE_ARENA_ADDRESS=${arenaAddress}`);
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
