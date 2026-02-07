// =============================================================================
// SERVIZIO STATISTICHE WALLET - NFTs, listing attivi e profitti di vendita
// WALLET STATS SERVICE - NFTs, active listings and sale profits
// =============================================================================

import { ethers } from "ethers";
import { CONTRACTS } from "../config.js";
import { provider, customCardsContract, marketplaceContract } from "../contracts/provider.js";
import { MARKETPLACE_ABI } from "../contracts/abis.js";

export interface WalletStats {
  nftsHeld: number;
  nftsListed: number;
  totalSalesETH: string; // formatted ETH string
}

/**
 * Recupera le statistiche di un wallet: NFT posseduti, listing attivi e profitti.
 * Fetches wallet stats: held NFTs, active listings, and sale profits.
 *
 * @param walletAddress - L'indirizzo Ethereum del wallet / The wallet's Ethereum address
 * @returns Statistiche aggregate del wallet / Aggregated wallet stats
 */
export async function getWalletStats(walletAddress: string): Promise<WalletStats> {
  const stats: WalletStats = {
    nftsHeld: 0,
    nftsListed: 0,
    totalSalesETH: "0",
  };

  // --- NFTs posseduti / Held NFTs ---
  if (customCardsContract) {
    try {
      const cardIds = await customCardsContract.tokensOfOwner(walletAddress);
      stats.nftsHeld = cardIds.length;
    } catch {}
  }

  // --- Listing attivi / Active listings ---
  if (marketplaceContract) {
    try {
      const listingIds = await marketplaceContract.getSellerListings(walletAddress);
      let activeCount = 0;
      // Controlla solo gli ultimi 20 listing (per performance)
      // Check only the last 20 listings (for performance)
      const recentIds = [...listingIds].slice(-20).reverse();
      for (const id of recentIds) {
        try {
          const listing = await marketplaceContract.getListing(Number(id));
          if (listing.active) activeCount++;
        } catch {}
      }
      stats.nftsListed = activeCount;
    } catch {}
  }

  // --- Profitti di vendita tramite eventi NFTSold / Sale profits via NFTSold events ---
  if (CONTRACTS.MARKETPLACE) {
    try {
      const iface = new ethers.Interface(MARKETPLACE_ABI);
      const nftSoldTopic = iface.getEvent("NFTSold")!.topicHash;
      // seller e' il terzo parametro indexed (topic[3])
      // seller is the third indexed parameter (topic[3])
      const sellerTopic = ethers.zeroPadValue(walletAddress, 32);

      const logs = await provider.getLogs({
        address: CONTRACTS.MARKETPLACE,
        topics: [nftSoldTopic, null, null, sellerTopic],
        fromBlock: 0,
        toBlock: "latest",
      });

      let totalWei = 0n;
      for (const log of logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed) {
            totalWei += parsed.args.price;
          }
        } catch {}
      }

      if (totalWei > 0n) {
        stats.totalSalesETH = ethers.formatEther(totalWei);
      }
    } catch (e) {
      console.error("[WalletStats] Error scanning NFTSold events:", e);
    }
  }

  return stats;
}
