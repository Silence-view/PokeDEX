// =============================================================================
// HANDLER CALLBACK MARKETPLACE - Navigazione, acquisto e vendita NFT
// MARKETPLACE CALLBACK HANDLERS - NFT browsing, buying, and selling
// =============================================================================
//
// Questo modulo gestisce tutte le callback query relative al marketplace:
// sfogliare le inserzioni, acquistare NFT e mettere in vendita le proprie carte.
//
// This module handles all marketplace-related callback queries:
// browsing listings, buying NFTs, and listing own cards for sale.
//
// Estratto da callbacks.ts per migliorare la manutenibilita' del codice.
// Extracted from callbacks.ts to improve code maintainability.
// =============================================================================

import { InlineKeyboard, InputMediaBuilder } from "grammy";
import { ethers } from "ethers";
import { CONTRACTS, NETWORK } from "../config.js";
import { sessionStore } from "../storage/index.js";
import { getUserWalletAddress, getUserWalletWithBalance } from "../services/wallet-helpers.js";
import { getEnrichedListing, buyNFTOnChain } from "../services/marketplace.js";
import { formatAddress } from "../bot/helpers.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import { bot } from "../bot/setup.js";
import { getWalletManager } from "../wallet/index.js";
import { marketplaceContract } from "../contracts/provider.js";
import { MARKETPLACE_ABI } from "../contracts/abis.js";
import { showMarketplaceBrowser, buildMyListingView } from "./actions.js";
import { marketplaceRateLimiter } from "../wallet/index.js";
import type { MarketplaceListing } from "../types.js";

// =============================================================================
// REGISTRAZIONE CALLBACK MARKETPLACE
// MARKETPLACE CALLBACK REGISTRATION
// =============================================================================

/**
 * Registra gli handler per le callback query del marketplace.
 * Registers handlers for marketplace callback queries.
 *
 * Handler registrati / Registered handlers:
 *   - browse_market_{page}  : Sfoglia inserzioni / Browse listings
 *   - buy_listing_{id}      : Schermata conferma acquisto / Purchase confirmation screen
 *   - confirm_buy_{id}      : Esecuzione acquisto on-chain / On-chain purchase execution
 *   - cancel_buy            : Annulla acquisto / Cancel purchase
 *   - sell_card_{tokenId}   : Avvia flusso vendita / Start selling flow
 */
export function registerMarketplaceCallbacks() {

  /**
   * Sfoglia le inserzioni del marketplace con paginazione.
   * Browses marketplace listings with pagination.
   *
   * callback_data: "browse_market_{pageNumber}" (regex match)
   * Esempio: "browse_market_0" = prima pagina, "browse_market_1" = seconda, ecc.
   * Example: "browse_market_0" = first page, "browse_market_1" = second, etc.
   */
  bot.callbackQuery(/^browse_market_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = ctx.callbackQuery.data.match(/^browse_market_(\d+)$/);
    if (!match) return;
    const page = parseInt(match[1]);
    await showMarketplaceBrowser(ctx, page);
  });

  /**
   * Mostra la schermata di conferma acquisto per un listing.
   * Shows the purchase confirmation screen for a listing.
   *
   * callback_data: "buy_listing_{listingId}" (regex match)
   *
   * Flusso / Flow:
   * 1. Verifica che l'utente abbia un wallet con saldo
   *    Verifies the user has a wallet with balance
   * 2. Recupera i dettagli del listing dal contratto
   *    Retrieves listing details from the contract
   * 3. Verifica che l'utente non stia comprando la propria carta
   *    Verifies the user is not buying their own card
   * 4. Mostra prezzo, saldo e pulsante di conferma
   *    Shows price, balance, and confirmation button
   */
  bot.callbackQuery(/^buy_listing_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const userId = ctx.from?.id;
    if (!userId) return;

    // Verifica wallet e saldo dell'utente
    // Verify user's wallet and balance
    const walletInfo = await getUserWalletWithBalance(userId);
    if (!walletInfo) {
      await ctx.reply("❌ Create your wallet first!", {
        reply_markup: new InlineKeyboard().text("👛 Create Wallet", "wallet_create")
      });
      return;
    }

    const { address: walletAddress, balanceFormatted: userBalance } = walletInfo;

    const match = ctx.callbackQuery.data.match(/^buy_listing_(\d+)$/);
    if (!match) return;

    const listingId = parseInt(match[1]);

    // Recupera i dettagli arricchiti del listing (nome, prezzo, seller, ecc.)
    // Retrieve enriched listing details (name, price, seller, etc.)
    const listing = await getEnrichedListing(listingId);
    if (!listing || !listing.active) {
      await ctx.reply("❌ Listing no longer available.");
      return;
    }

    // Impedisci all'utente di comprare la propria carta
    // Prevent the user from buying their own card
    if (listing.seller.toLowerCase() === walletAddress.toLowerCase()) {
      await ctx.reply("❌ You cannot buy your own listing!");
      return;
    }

    const priceEth = ethers.formatEther(listing.price);
    const hasEnoughBalance = parseFloat(userBalance) >= parseFloat(priceEth);

    // Tastiera di conferma con pulsanti Conferma / Annulla
    // Confirmation keyboard with Confirm / Cancel buttons
    const confirmKeyboard = new InlineKeyboard()
      .text(`✅ Confirm Purchase`, `confirm_buy_${listingId}`)
      .row()
      .text("❌ Cancel", "cancel_buy");

    await ctx.reply(
      `🛒 *Confirm Purchase*

🎴 *Card:* ${listing.name || `#${listing.tokenId}`}
💰 *Price:* ${priceEth} ETH
👤 *Seller:* \`${formatAddress(listing.seller)}\`

👛 *Your wallet:* \`${formatAddress(walletAddress)}\`
💰 *Balance:* ${userBalance} ETH ${hasEnoughBalance ? "✅" : "⚠️ Insufficient"}

${hasEnoughBalance ? "The NFT will be transferred directly to your wallet!" : "⚠️ Deposit more ETH to your wallet before proceeding."}`,
      { parse_mode: "Markdown", reply_markup: confirmKeyboard }
    );
  });

  /**
   * Conferma ed esegue l'acquisto di un NFT on-chain.
   * Confirms and executes the NFT purchase on-chain.
   *
   * callback_data: "confirm_buy_{listingId}" (regex match)
   *
   * Flusso / Flow:
   * 1. Verifica che il listing sia ancora attivo
   *    Verifies the listing is still active
   * 2. Chiama buyNFTOnChain() che firma e invia la transazione
   *    Calls buyNFTOnChain() which signs and sends the transaction
   * 3. In caso di successo: mostra txHash e link Etherscan
   *    On success: shows txHash and Etherscan link
   * 4. In caso di errore: mostra errore e pulsante retry
   *    On error: shows error and retry button
   */
  bot.callbackQuery(/^confirm_buy_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery("Processing purchase...");

    const userId = ctx.from?.id;
    const match = ctx.callbackQuery.data.match(/^confirm_buy_(\d+)$/);
    if (!match) return;

    const listingId = parseInt(match[1]);

    // Ricontrolla che il listing sia ancora disponibile (potrebbe essere stato
    // comprato da un altro utente nel frattempo)
    // Re-check that the listing is still available (it may have been bought
    // by another user in the meantime)
    const listing = await getEnrichedListing(listingId);
    if (!listing || !listing.active) {
      await ctx.editMessageText("❌ Listing no longer available.");
      return;
    }

    // Mostra messaggio di attesa durante la transazione
    // Show waiting message during the transaction
    await ctx.editMessageText("🔄 *Purchase in progress...*\n\nPlease wait while the transaction is being processed.", { parse_mode: "Markdown" });

    // Esegui l'acquisto on-chain (firma tx, invia, attendi conferma)
    // Execute the on-chain purchase (sign tx, send, await confirmation)
    const result = await buyNFTOnChain(listingId, listing.price, userId);

    if (result.success) {
      const successKeyboard = new InlineKeyboard()
        .url("🔍 View Transaction", `${NETWORK.explorer}/tx/${result.txHash}`)
        .row()
        .text("🛍️ Continue Shopping", "browse_market_0")
        .text("🏠 Menu", "main_menu");

      await ctx.editMessageText(
        `✅ *Purchase Complete!*

🎴 *Card:* ${listing.name || `#${listing.tokenId}`}
💰 *Price:* ${ethers.formatEther(listing.price)} ETH
📜 *TX:* \`${result.txHash?.slice(0, 20)}...\`

The NFT is now in your wallet!`,
        { parse_mode: "Markdown", reply_markup: successKeyboard }
      );
    } else {
      await ctx.editMessageText(
        `❌ *Purchase Failed*

${result.error}

Try again or contact support.`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("🔄 Retry", `buy_listing_${listingId}`)
            .text("🏠 Menu", "main_menu")
        }
      );
    }
  });

  /**
   * Annulla un acquisto in corso e torna al browser del marketplace.
   * Cancels an ongoing purchase and returns to the marketplace browser.
   *
   * callback_data: "cancel_buy"
   */
  bot.callbackQuery("cancel_buy", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("❌ Purchase cancelled.", {
      reply_markup: new InlineKeyboard()
        .text("🛍️ Continue Browsing", "browse_market_0")
        .text("🏠 Menu", "main_menu")
    });
  });

  // ===========================================================================
  // NAVIGAZIONE CAROUSEL "MY LISTINGS"
  // "MY LISTINGS" CAROUSEL NAVIGATION
  //
  // Questi handler gestiscono la navigazione tra le inserzioni dell'utente
  // nel carousel (prev/next) e la cancellazione di un listing on-chain.
  //
  // These handlers manage navigation between user listings in the
  // carousel (prev/next) and on-chain listing cancellation.
  // ===========================================================================

  /**
   * Callback segnaposto per il contatore della pagina (es. "1/3").
   * Placeholder callback for page counter (e.g. "1/3").
   *
   * callback_data: "noop"
   * Non esegue alcuna azione — il bottone serve solo come indicatore visivo.
   * Performs no action — the button serves only as a visual indicator.
   */
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  /**
   * Naviga a una specifica inserzione nel carousel "My Listings".
   * Navigates to a specific listing in the "My Listings" carousel.
   *
   * callback_data: "my_listing_{index}" (regex match)
   *
   * Flusso / Flow:
   * 1. Recupera il wallet dell'utente
   *    Gets the user's wallet address
   * 2. Chiama getSellerListings() per ottenere tutti gli ID delle inserzioni
   *    Calls getSellerListings() to get all listing IDs
   * 3. Filtra solo le attive e arricchisce quella all'indice richiesto
   *    Filters active only and enriches the one at the requested index
   * 4. Usa editMessageMedia() per scambiare immagine e caption in-place
   *    Uses editMessageMedia() to swap image and caption in-place
   */
  bot.callbackQuery(/^my_listing_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const userId = ctx.from?.id;
    if (!userId) return;

    const match = ctx.callbackQuery.data.match(/^my_listing_(\d+)$/);
    if (!match) return;
    const targetIndex = parseInt(match[1]);

    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress || !marketplaceContract) return;

    try {
      // Recupera e filtra le inserzioni attive dell'utente
      // Fetch and filter the user's active listings
      const listingIds = await marketplaceContract.getSellerListings(walletAddress);
      const activeListings: MarketplaceListing[] = [];

      // Controlla i listing piu' recenti per primi (gli ultimi nell'array)
      // Check most recent listings first (last in the array)
      // Nota: ethers.js restituisce Result (frozen) — [...] lo converte in array mutabile
      // Note: ethers.js returns Result (frozen) — [...] converts it to a mutable array
      const recentIds = [...listingIds].slice(-20).reverse();
      for (const listingId of recentIds) {
        try {
          const listing = await getEnrichedListing(Number(listingId));
          if (listing && listing.active) {
            activeListings.push(listing);
          }
        } catch {}
      }

      if (activeListings.length === 0 || targetIndex >= activeListings.length) {
        await ctx.editMessageCaption({
          caption: "📭 No active listings found.",
          reply_markup: new InlineKeyboard()
            .text("💰 Sell a Card", "action_sell")
            .row()
            .text("🏠 Menu", "main_menu")
        });
        return;
      }

      const listing = activeListings[targetIndex];
      const { caption, keyboard } = buildMyListingView(listing, targetIndex, activeListings.length);

      // Scambia immagine e caption in-place nel messaggio corrente.
      // Se il messaggio originale era testo (senza immagine), editMessageMedia
      // e editMessageCaption falliranno. In quel caso usiamo editMessageText.
      //
      // Swap image and caption in-place in the current message.
      // If the original message was text (no image), editMessageMedia and
      // editMessageCaption will fail. In that case we use editMessageText.
      if (listing.imageUrl) {
        try {
          const media = InputMediaBuilder.photo(listing.imageUrl, {
            caption,
            parse_mode: "Markdown"
          });
          await ctx.editMessageMedia(media, { reply_markup: keyboard });
          return;
        } catch (imgError) {
          console.error("My listing editMedia failed:", imgError);
        }
      }

      // Fallback 1: aggiorna caption (funziona solo se il messaggio e' media)
      // Fallback 1: update caption (only works if the message is media)
      try {
        await ctx.editMessageCaption({
          caption: caption + "\n\n📷 _(Image unavailable)_",
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
      } catch {
        // Fallback 2: aggiorna come testo (quando il messaggio originale era testo)
        // Fallback 2: update as text (when the original message was text)
        await ctx.editMessageText(caption + "\n\n📷 _(Image unavailable)_", {
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
      }
    } catch (error) {
      console.error("My listing navigation error:", error);
      try {
        await ctx.editMessageCaption({
          caption: "❌ Error loading listing.",
          reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu")
        });
      } catch {
        // Il messaggio era testo, non media — usa editMessageText
        // The message was text, not media — use editMessageText
        await ctx.editMessageText("❌ Error loading listing.", {
          reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu")
        });
      }
    }
  });

  /**
   * Cancella un'inserzione dal marketplace (on-chain).
   * Cancels a listing from the marketplace (on-chain).
   *
   * callback_data: "cancel_my_listing_{listingId}" (regex match)
   *
   * Flusso / Flow:
   * 1. Verifica rate limit e wallet dell'utente
   *    Verifies rate limit and user's wallet
   * 2. Chiama cancelListing(listingId) sul contratto marketplace
   *    Calls cancelListing(listingId) on the marketplace contract
   * 3. Aggiorna il messaggio con esito (successo o errore)
   *    Updates the message with result (success or error)
   */
  bot.callbackQuery(/^cancel_my_listing_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery("Processing cancellation...");

    const userId = ctx.from?.id;
    if (!userId) return;

    const match = ctx.callbackQuery.data.match(/^cancel_my_listing_(\d+)$/);
    if (!match) return;
    const listingId = parseInt(match[1]);

    // Verifica rate limit per evitare spam di transazioni
    // Check rate limit to prevent transaction spam
    const rateLimitResult = marketplaceRateLimiter.isAllowed(userId.toString());
    if (!rateLimitResult.allowed) {
      const waitTime = Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000);
      await ctx.editMessageCaption({
        caption: `⏳ Too many operations. Please wait ${waitTime} seconds.`,
        reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu")
      });
      return;
    }

    const walletManager = getWalletManager();
    if (!walletManager.hasWallet(userId)) {
      await ctx.editMessageCaption({
        caption: "❌ Wallet not found.",
        reply_markup: new InlineKeyboard().text("👛 Create Wallet", "wallet_create")
      });
      return;
    }

    try {
      // Mostra messaggio di attesa durante la transazione
      // Show waiting message during transaction
      await ctx.editMessageCaption({
        caption: "🔄 *Cancelling listing...*\n\nPlease wait while the transaction is being processed.",
        parse_mode: "Markdown"
      });

      // Ottieni il signer dell'utente e chiama cancelListing on-chain
      // Get user's signer and call cancelListing on-chain
      const activeSigner = await walletManager.getSigner(userId);
      if (!activeSigner) {
        await ctx.editMessageCaption({
          caption: "❌ Failed to access your wallet.",
          reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu")
        });
        return;
      }

      const marketplace = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, activeSigner);
      const tx = await marketplace.cancelListing(listingId);
      await tx.wait();

      await ctx.editMessageCaption({
        caption: `✅ *Listing #${listingId} Cancelled!*\n\nYour NFT has been returned to your wallet.`,
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📋 My Listings", "action_my_listings")
          .row()
          .text("🛍️ Marketplace", "browse_market_0")
          .text("🏠 Menu", "main_menu")
      });
    } catch (error: any) {
      console.error("Cancel listing error:", error);
      await ctx.editMessageCaption({
        caption: `❌ *Cancellation Failed*\n\n${error.reason || error.message || "Transaction failed"}`,
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🔄 Retry", `cancel_my_listing_${listingId}`)
          .text("🏠 Menu", "main_menu")
      });
    }
  });

  /**
   * Avvia il flusso di vendita per una carta specifica.
   * Starts the selling flow for a specific card.
   *
   * callback_data: "sell_card_{tokenId}" (regex match)
   *
   * Due percorsi possibili / Two possible paths:
   *
   * A) L'utente ha un wallet custodial:
   *    - Verifica l'integrita' del wallet
   *    - Salva il tokenId nella sessione (pendingCardSell)
   *    - Entra nella conversazione "listSelectedCardConversation"
   *
   * A) The user has a custodial wallet:
   *    - Verifies wallet integrity
   *    - Saves tokenId in the session (pendingCardSell)
   *    - Enters the "listSelectedCardConversation" conversation
   *
   * B) L'utente NON ha un wallet:
   *    - Mostra istruzioni manuali per approvare e listare via Etherscan
   *    - Suggerisce di creare un wallet per il flusso automatico
   *
   * B) The user does NOT have a wallet:
   *    - Shows manual instructions for approving and listing via Etherscan
   *    - Suggests creating a wallet for the automatic flow
   */
  bot.callbackQuery(/^sell_card_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const match = ctx.callbackQuery.data.match(/^sell_card_(\d+)$/);
    if (!match) return;

    const tokenId = parseInt(match[1]);
    const userId = ctx.from?.id;

    if (!userId) {
      await ctx.reply("❌ Error: unable to identify user.");
      return;
    }

    const nftContract = CONTRACTS.CUSTOM_CARDS;

    if (!nftContract) {
      await ctx.reply("❌ CustomCards contract not configured.");
      return;
    }

    const walletManager = getWalletManager();
    if (walletManager.hasWallet(userId)) {
      // --- Percorso A: wallet custodial presente ---
      // --- Path A: custodial wallet present ---

      // Verifica che il wallet sia accessibile e non corrotto
      // Verify the wallet is accessible and not corrupted
      const isWalletValid = await walletManager.verifyWalletIntegrity(userId);
      if (!isWalletValid) {
        await ctx.reply(
          "❌ *Wallet Access Error*\n\n" +
          "Your wallet data is inaccessible. Please create a new wallet to continue selling.\n\n" +
          "👇 *Create a new wallet:*",
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().text("👛 Create New Wallet", "wallet_create")
          }
        );
        return;
      }

      // Salva il tokenId in sessione per la conversazione successiva
      // Save tokenId in session for the subsequent conversation
      const session = sessionStore.getOrCreate(userId);
      session.pendingCardSell = tokenId;
      sessionStore.save(session);

      try {
        // Entra nel flusso conversazionale di vendita
        // Enter the selling conversation flow
        await ctx.conversation.enter("listSelectedCardConversation");
      } catch (error) {
        console.error("Failed to enter listSelectedCardConversation:", error);
        await ctx.reply("❌ Error starting sell flow. Please try again.", {
          reply_markup: getMainMenuKeyboard()
        });
      }
    } else {
      // --- Percorso B: nessun wallet, istruzioni manuali ---
      // --- Path B: no wallet, manual instructions ---
      const keyboard = new InlineKeyboard()
        .text("💼 Create Wallet", "wallet_create")
        .row()
        .url("1️⃣ Approve", `${NETWORK.explorer}/address/${nftContract}#writeContract`)
        .row()
        .url("2️⃣ List", `${NETWORK.explorer}/address/${CONTRACTS.MARKETPLACE}#writeContract`);

      await ctx.reply(
        `💰 *Sell Card #${tokenId}*

To sell automatically, create a wallet first.

*Manual steps:*
*Step 1:* \`setApprovalForAll\`
Operator: \`${CONTRACTS.MARKETPLACE}\`

*Step 2:* \`listNFT\`
nftContract: \`${nftContract}\`
tokenId: ${tokenId}
price: (in wei)`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
    }
  });

}
