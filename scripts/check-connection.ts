import { ethers } from "hardhat";

async function main() {
  console.log("Checking Sepolia connection...\n");

  try {
    const [signer] = await ethers.getSigners();
    const address = await signer.getAddress();
    const balance = await ethers.provider.getBalance(address);
    const network = await ethers.provider.getNetwork();

    console.log("✅ Connection successful!");
    console.log("─".repeat(40));
    console.log("Network:", network.name);
    console.log("Chain ID:", network.chainId.toString());
    console.log("Wallet:", address);
    console.log("Balance:", ethers.formatEther(balance), "ETH");
    console.log("─".repeat(40));

    if (balance === 0n) {
      console.log("\n⚠️  Balance is 0 - you need Sepolia ETH for deployment");
      console.log("Get free ETH at: https://sepoliafaucet.com/");
    } else {
      console.log("\n✅ Ready for deployment!");
    }
  } catch (error: any) {
    console.log("❌ Connection failed!");
    console.log("Error:", error.message);
  }
}

main();
