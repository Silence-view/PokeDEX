// =============================================================================
// NOTIFICHE DI VENDITA - Listener eventi on-chain per vendite marketplace
// SALE NOTIFICATIONS - On-chain event listener for marketplace sales
//
// Questo servizio ascolta gli eventi NFTSold emessi dal contratto
// PokeDEXMarketplace. Quando una carta viene venduta, il contratto emette
// un evento con i dettagli della transazione. Questo servizio cattura
// l'evento e invia una notifica Telegram al venditore.
//
// This service listens for NFTSold events emitted by the PokeDEXMarketplace
// contract. When a card is sold, the contract emits an event with transaction
// details. This service captures the event and sends a Telegram notification
// to the seller.
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
// 3. Il provider ethers.js riceve l'evento tramite il WebSocket/polling
//    The ethers.js provider receives the event via WebSocket/polling
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
//
// NOTA IMPORTANTE / IMPORTANT NOTE:
// L'evento NFTSold viene emesso DOPO che il listing e' stato disattivato
// (listing.active = false). I dati del listing restano nella mappatura
// del contratto, quindi possiamo ancora leggerli per ottenere il tokenId.
//
// The NFTSold event is emitted AFTER the listing is deactivated
// (listing.active = false). The listing data remains in the contract's
// mapping, so we can still read it to get the tokenId.
// =============================================================================

import { ethers } from "ethers";
import { marketplaceContract, customCardsContract } from "../contracts/provider.js";
import { bot } from "../bot/setup.js";
import { sessionStore } from "../storage/index.js";
import { formatAddress, getEtherscanLink } from "../bot/helpers.js";
import { CONTRACTS } from "../config.js";
import { fetchNFTMetadata } from "./ipfs.js";

// Flag per evitare registrazioni multiple del listener
// Flag to prevent multiple listener registrations
let isListening = false;

// =============================================================================
// AVVIO LISTENER
// START LISTENER
// =============================================================================

/**
 * Avvia il listener per gli eventi NFTSold sul contratto marketplace.
 * Starts the listener for NFTSold events on the marketplace contract.
 *
 * Usa contract.on() di ethers.js per sottoscriversi agli eventi in tempo reale.
 * Il provider JSON-RPC effettua polling periodico per nuovi blocchi e controlla
 * se contengono log che corrispondono al filtro dell'evento NFTSold.
 *
 * Uses ethers.js contract.on() to subscribe to events in real-time.
 * The JSON-RPC provider periodically polls for new blocks and checks
 * if they contain logs matching the NFTSold event filter.
 */
export function startSaleNotifications(): void {
  if (!marketplaceContract) {
    console.warn("[SaleNotifications] Marketplace contract not available, skipping");
    return;
  }

  if (isListening) {
    console.warn("[SaleNotifications] Already listening for sale events");
    return;
  }

  console.log("[SaleNotifications] Starting NFTSold event listener...");

  // Registra il listener per l'evento NFTSold
  // Register the listener for the NFTSold event
  //
  // Parametri dell'evento (dal contratto Solidity):
  // Event parameters (from the Solidity contract):
  //   listingId (uint256 indexed) - ID del listing venduto
  //   buyer     (address indexed) - Indirizzo del compratore
  //   seller    (address indexed) - Indirizzo del venditore
  //   price     (uint256)         - Prezzo pagato in wei
  //   event     (ContractEventPayload) - Metadati dell'evento (log, tx hash, ecc.)
  marketplaceContract.on("NFTSold", async (
    listingId: bigint,
    buyer: string,
    seller: string,
    price: bigint,
    event: ethers.ContractEventPayload
  ) => {
    try {
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
        // Il listing e' ora inattivo (active=false) ma i dati sono ancora nel mapping
        // The listing is now inactive (active=false) but data is still in the mapping
        const listing = await marketplaceContract!.getListing(listingId);
        tokenId = Number(listing.tokenId);

        // Prova a ottenere il nome della carta dai metadati IPFS
        // Try to get the card name from IPFS metadata
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

      // Costruisce il messaggio di notifica
      // Build the notification message
      const priceEth = ethers.formatEther(price);
      const txHash = event.log?.transactionHash;
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

      // Invia il messaggio al venditore via Telegram
      // Send the message to the seller via Telegram
      await bot.api.sendMessage(session.telegramUserId, message, {
        parse_mode: "Markdown",
      });

      console.log(`[SaleNotifications] Notification sent to user ${session.telegramUserId}`);
    } catch (error) {
      console.error("[SaleNotifications] Error processing NFTSold event:", error);
    }
  });

  isListening = true;
  console.log("[SaleNotifications] \u2705 NFTSold event listener active");
}

// =============================================================================
// ARRESTO LISTENER
// STOP LISTENER
// =============================================================================

/**
 * Ferma il listener degli eventi NFTSold.
 * Stops the NFTSold event listener.
 *
 * Deve essere chiamato durante lo shutdown del bot per rilasciare
 * le risorse del provider (connessioni, polling, ecc.).
 *
 * Should be called during bot shutdown to release provider resources
 * (connections, polling, etc.).
 */
export function stopSaleNotifications(): void {
  if (marketplaceContract && isListening) {
    marketplaceContract.removeAllListeners("NFTSold");
    isListening = false;
    console.log("[SaleNotifications] Event listener stopped");
  }
}
