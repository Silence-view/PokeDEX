// =============================================================================
// NOTIFICHE DI VENDITA - Polling eventi on-chain per vendite marketplace
// SALE NOTIFICATIONS - On-chain event polling for marketplace sales
//
// Questo servizio controlla periodicamente gli eventi NFTSold emessi dal
// contratto PokeDEXMarketplace usando queryFilter() (stateless eth_getLogs).
// Questo approccio e' piu' robusto di contract.on() che usa eth_newFilter,
// perche' i filtri scadono sui nodi RPC pubblici (Sepolia, Alchemy free, ecc.)
// causando errori -32001 "resource not found" infiniti.
//
// This service periodically checks NFTSold events emitted by the
// PokeDEXMarketplace contract using queryFilter() (stateless eth_getLogs).
// This approach is more robust than contract.on() which uses eth_newFilter,
// because filters expire on public RPC nodes (Sepolia, Alchemy free, etc.)
// causing infinite -32001 "resource not found" errors.
//
// FLUSSO / FLOW:
//
// 1. Il compratore chiama buyNFT() sul contratto marketplace
//    The buyer calls buyNFT() on the marketplace contract
//
// 2. Il contratto trasferisce l'NFT, distribuisce i pagamenti e emette
//    l'evento NFTSold(listingId, buyer, seller, price)
//    The contract transfers the NFT, distributes payments and emits
//    the NFTSold(listingId, buyer, seller, price) event
//
// 3. Il polling controlla ogni 15 secondi i nuovi blocchi per eventi NFTSold
//    The polling checks every 15 seconds for new blocks with NFTSold events
//
// 4. Il servizio cerca il venditore nel SessionStore tramite il suo
//    indirizzo wallet (reverse lookup)
//    The service looks up the seller in SessionStore via their
//    wallet address (reverse lookup)
//
// 5. Se il venditore ha notifiche abilitate, invia un messaggio Telegram
//    con nome carta, prezzo, indirizzo compratore e link alla transazione
//    If the seller has notifications enabled, sends a Telegram message
//    with card name, price, buyer address and transaction link
// =============================================================================

import { ethers } from "ethers";
import { marketplaceContract, customCardsContract, provider } from "../contracts/provider.js";
import { bot } from "../bot/setup.js";
import { sessionStore } from "../storage/index.js";
import { formatAddress, getEtherscanLink } from "../bot/helpers.js";
import { CONTRACTS } from "../config.js";
import { fetchNFTMetadata } from "./ipfs.js";

// Flag e timer per il polling
// Flag and timer for polling
let isListening = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastCheckedBlock = 0;

// Intervallo di polling in millisecondi (15 secondi)
// Polling interval in milliseconds (15 seconds)
const POLL_INTERVAL = 15_000;

// =============================================================================
// AVVIO LISTENER (POLLING-BASED)
// START LISTENER (POLLING-BASED)
// =============================================================================

/**
 * Avvia il polling per gli eventi NFTSold sul contratto marketplace.
 * Starts polling for NFTSold events on the marketplace contract.
 *
 * Usa queryFilter() con intervalli di blocco per controllare nuovi eventi.
 * Questo evita il problema dei filtri scaduti su nodi RPC pubblici.
 *
 * Uses queryFilter() with block ranges to check for new events.
 * This avoids the expired filter problem on public RPC nodes.
 */
export async function startSaleNotifications(): Promise<void> {
  if (!marketplaceContract) {
    console.warn("[SaleNotifications] Marketplace contract not available, skipping");
    return;
  }

  if (isListening) {
    console.warn("[SaleNotifications] Already listening for sale events");
    return;
  }

  console.log("[SaleNotifications] Starting NFTSold event listener...");

  // Inizia dal blocco corrente
  // Start from the current block
  try {
    lastCheckedBlock = await provider.getBlockNumber();
  } catch {
    lastCheckedBlock = 0;
  }

  // Polling periodico con queryFilter (stateless, nessun filtro da mantenere)
  // Periodic polling with queryFilter (stateless, no filter to maintain)
  pollTimer = setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock <= lastCheckedBlock) return;

      // Cerca eventi NFTSold nei blocchi nuovi
      // Search for NFTSold events in new blocks
      const events = await marketplaceContract!.queryFilter(
        "NFTSold",
        lastCheckedBlock + 1,
        currentBlock
      );

      lastCheckedBlock = currentBlock;

      for (const event of events) {
        try {
          await processNFTSoldEvent(event);
        } catch (err) {
          console.error("[SaleNotifications] Error processing event:", err);
        }
      }
    } catch (err) {
      // Errori di rete sono temporanei, il prossimo polling riproverà
      // Network errors are temporary, the next poll will retry
      // Non logghiamo per evitare spam nei log
    }
  }, POLL_INTERVAL);

  isListening = true;
  console.log("[SaleNotifications] \u2705 NFTSold event listener active");
}

/**
 * Processa un singolo evento NFTSold e invia la notifica al venditore.
 * Processes a single NFTSold event and sends notification to the seller.
 */
async function processNFTSoldEvent(event: ethers.EventLog | ethers.Log): Promise<void> {
  // Decodifica i parametri dell'evento
  // Decode event parameters
  let listingId: bigint, buyer: string, seller: string, price: bigint;

  if ("args" in event && event.args) {
    [listingId, buyer, seller, price] = event.args;
  } else {
    // Decodifica manuale dai log grezzi
    // Manual decode from raw logs
    const iface = marketplaceContract!.interface;
    const parsed = iface.parseLog({ topics: event.topics as string[], data: event.data });
    if (!parsed) return;
    [listingId, buyer, seller, price] = parsed.args;
  }

  console.log(
    `[SaleNotifications] NFTSold: listing #${listingId}, ` +
    `seller: ${formatAddress(seller)}, ` +
    `buyer: ${formatAddress(buyer)}, ` +
    `price: ${ethers.formatEther(price)} ETH`
  );

  // Cerca la sessione del venditore tramite il suo indirizzo wallet
  // Look up the seller's session via their wallet address
  const session = sessionStore.findByWalletAddress(seller);
  if (!session) {
    console.log(`[SaleNotifications] No session for seller ${formatAddress(seller)}, skipping`);
    return;
  }

  // Controlla se l'utente ha le notifiche abilitate
  // Check if the user has notifications enabled
  if (!session.notificationsEnabled) {
    console.log(`[SaleNotifications] Notifications disabled for user ${session.telegramUserId}`);
    return;
  }

  // Recupera i dettagli della carta venduta
  // Fetch details about the sold card
  let cardName = "Card";
  let tokenId: number | null = null;

  try {
    const listing = await marketplaceContract!.getListing(listingId);
    tokenId = Number(listing.tokenId);

    const customCardsAddr = (CONTRACTS.CUSTOM_CARDS || "").toLowerCase();
    if (customCardsContract && listing.nftContract.toLowerCase() === customCardsAddr) {
      try {
        const tokenURI = await customCardsContract.tokenURI(tokenId);
        const metadata = await fetchNFTMetadata(tokenURI);
        cardName = metadata?.name || `Card #${tokenId}`;
      } catch {
        cardName = `Card #${tokenId}`;
      }
    } else {
      cardName = `NFT #${tokenId}`;
    }
  } catch (err) {
    console.error("[SaleNotifications] Error fetching listing details:", err);
    cardName = `Listing #${listingId}`;
  }

  // Costruisce e invia il messaggio di notifica
  // Build and send the notification message
  const priceEth = ethers.formatEther(price);
  const txHash = event.transactionHash;
  const txLink = txHash ? getEtherscanLink("tx", txHash) : "";

  const message =
`\u{1F389} *Card Sold!*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

\u{1F4DB} *${cardName}*
\u{1F4B0} *Price:* ${priceEth} ETH
\u{1F6D2} *Buyer:* \`${formatAddress(buyer)}\`
${txLink ? `\u{1F517} [View Transaction](${txLink})` : ""}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
_Your card has been sold on the PokeDEX marketplace!_`;

  await bot.api.sendMessage(session.telegramUserId, message, {
    parse_mode: "Markdown",
  });

  console.log(`[SaleNotifications] Notification sent to user ${session.telegramUserId}`);
}

// =============================================================================
// ARRESTO LISTENER
// STOP LISTENER
// =============================================================================

/**
 * Ferma il polling degli eventi NFTSold.
 * Stops the NFTSold event polling.
 */
export function stopSaleNotifications(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (marketplaceContract && isListening) {
    marketplaceContract.removeAllListeners("NFTSold");
  }
  isListening = false;
  console.log("[SaleNotifications] Event listener stopped");
}
