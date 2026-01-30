import { run } from "hardhat";

// Update these addresses after deployment
const POKEDEX_CARD_ADDRESS = "";
const CARD_PACK_ADDRESS = "";
const BATTLE_ARENA_ADDRESS = "";
const DEPLOYER_ADDRESS = "";

// VRF Config
const VRF_COORDINATOR = "0x8103B0A8A00be2DDC778e6e7eaa21791Cd364625";
const KEY_HASH = "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c";
const SUBSCRIPTION_ID = ""; // Add your subscription ID

async function main() {
  console.log("Verifying contracts on Etherscan...\n");

  // Verify PokeDEXCard
  console.log("1. Verifying PokeDEXCard...");
  try {
    await run("verify:verify", {
      address: POKEDEX_CARD_ADDRESS,
      constructorArguments: [DEPLOYER_ADDRESS],
    });
    console.log("PokeDEXCard verified!\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("PokeDEXCard already verified\n");
    } else {
      console.error("Error verifying PokeDEXCard:", error.message);
    }
  }

  // Verify CardPack
  console.log("2. Verifying CardPack...");
  try {
    await run("verify:verify", {
      address: CARD_PACK_ADDRESS,
      constructorArguments: [
        VRF_COORDINATOR,
        SUBSCRIPTION_ID,
        KEY_HASH,
        POKEDEX_CARD_ADDRESS,
        DEPLOYER_ADDRESS,
      ],
    });
    console.log("CardPack verified!\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("CardPack already verified\n");
    } else {
      console.error("Error verifying CardPack:", error.message);
    }
  }

  // Verify BattleArena
  console.log("3. Verifying BattleArena...");
  try {
    await run("verify:verify", {
      address: BATTLE_ARENA_ADDRESS,
      constructorArguments: [POKEDEX_CARD_ADDRESS, DEPLOYER_ADDRESS],
    });
    console.log("BattleArena verified!\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("BattleArena already verified\n");
    } else {
      console.error("Error verifying BattleArena:", error.message);
    }
  }

  console.log("Verification complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
