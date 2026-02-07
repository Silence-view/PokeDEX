import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    throw new Error("Missing SEPOLIA_RPC_URL or PRIVATE_KEY in .env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log("━".repeat(60));
  console.log("Deploying PokeDEXCustomCards v2 (with tokensOfOwner)");
  console.log("━".repeat(60));
  console.log("Deployer:", signer.address);

  const balance = await provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Load compiled artifact
  const artifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/PokeDEXCustomCards.sol/PokeDEXCustomCards.json"
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error("Artifact not found. Run `npx hardhat compile` first.");
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));

  console.log("\nDeploying PokeDEXCustomCards...");

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer
  );

  const contract = await factory.deploy(
    signer.address, // admin
    signer.address  // fee recipient
  );

  console.log("Tx hash:", contract.deploymentTransaction()?.hash);
  console.log("Waiting for confirmation...");

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n" + "━".repeat(60));
  console.log("PokeDEXCustomCards v2 deployed to:", address);
  console.log("━".repeat(60));
  console.log("\nUpdate your .env:");
  console.log(`CUSTOM_CARDS_ADDRESS=${address}`);
  console.log("\nOld address was:", process.env.CUSTOM_CARDS_ADDRESS);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deploy failed:", error);
    process.exit(1);
  });
