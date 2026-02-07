// =============================================================================
// HANDLER CALLBACK - Gestione pulsanti inline e callback query
// CALLBACK HANDLERS - Inline button and callback query handling
// =============================================================================
//
// Questo modulo e' il coordinatore centrale per TUTTE le callback query del bot.
// Registra direttamente gli handler per menu e carte, e delega marketplace e
// wallet ai rispettivi moduli specializzati.
//
// This module is the central coordinator for ALL bot callback queries.
// It directly registers handlers for menu and cards, and delegates marketplace
// and wallet to their respective specialized modules.
//
// Flusso: Utente preme pulsante -> Telegram invia callback_data al bot
//         -> grammY invoca l'handler corrispondente -> bot risponde
//
// Flow:   User presses button -> Telegram sends callback_data to the bot
//         -> grammY invokes the matching handler -> bot responds
//
// Le callback sono raggruppate per funzionalita' e file:
// Callbacks are grouped by feature and file:
//
//   1. Menu principale     / Main menu actions       (action_*)        -> questo file / this file
//   2. Carte e draft       / Cards and drafts        (view_card_*, refresh_mint_*) -> questo file / this file
//   3. Marketplace         / Marketplace             (browse_market_*, buy_listing_*, ...) -> marketplace-callbacks.ts
//   4. Wallet              / Wallet management       (wallet_*)        -> wallet-callbacks.ts
//   5. Utility             / Utility                 (delete_this_message) -> questo file / this file
//
// NOTA: ctx.answerCallbackQuery() deve essere chiamata entro 30 secondi
// per evitare l'icona di caricamento sul pulsante dell'utente.
// NOTE: ctx.answerCallbackQuery() must be called within 30 seconds
// to avoid the loading spinner on the user's button.
//
// =============================================================================

import { InlineKeyboard, InputMediaBuilder, GrammyError } from "grammy";
import { ethers } from "ethers";
import { CONTRACTS, NETWORK, POKEMON_TYPES, TYPE_EMOJIS, RARITIES } from "../config.js";
import { provider, customCardsContract, marketplaceContract } from "../contracts/provider.js";
import { draftStore } from "../storage/index.js";
import { getUserWalletAddress } from "../services/wallet-helpers.js";
import { sanitizeForMarkdown, fetchNFTMetadata } from "../services/ipfs.js";
import { getMainMenuKeyboard, getWelcomeMessage } from "../bot/menu.js";
import { SECURITY_NOTICE, ANTI_PHISHING_WARNING } from "../bot/security.js";
import { bot } from "../bot/setup.js";
import {
  showHelp, showMyCards, showCardDetails,
  showMarketplace, showMyListings, showWallet, showContracts, showMyDrafts,
  buildMyCardView, getCardEntries, enrichCardEntry, buildMyCardsGrid
} from "./actions.js";
import { registerMarketplaceCallbacks } from "./marketplace-callbacks.js";
import { registerWalletCallbacks } from "./wallet-callbacks.js";
import { buildShareMessage } from "../services/promo.js";
import { sessionStore } from "../storage/index.js";

// =============================================================================
// REGISTRAZIONE CALLBACK HANDLERS - Funzione principale di setup
// CALLBACK HANDLER REGISTRATION - Main setup function
// =============================================================================

/**
 * Registra tutti gli handler per le callback query (pulsanti inline).
 * Registers all handlers for callback queries (inline buttons).
 *
 * Questa funzione viene chiamata una sola volta durante l'avvio del bot
 * (da startup.ts). Registra direttamente gli handler per menu e carte,
 * poi delega ai moduli specializzati per marketplace e wallet.
 *
 * This function is called once during bot startup (from startup.ts).
 * It directly registers handlers for menu and cards, then delegates
 * to specialized modules for marketplace and wallet.
 *
 * IMPORTANTE: L'ordine di registrazione conta! grammY usa il primo
 * handler che corrisponde al pattern. Gli handler piu' specifici
 * devono essere registrati prima di quelli generici.
 *
 * IMPORTANT: Registration order matters! grammY uses the first handler
 * that matches the pattern. More specific handlers must be registered
 * before generic ones.
 */
export function registerCallbackHandlers() {

  // ===========================================================================
  // SEZIONE 1: AZIONI MENU PRINCIPALE
  // SECTION 1: MAIN MENU ACTIONS
  // ===========================================================================
  //
  // Questi handler rispondono ai pulsanti del menu principale (/start).
  // Ogni pulsante ha un callback_data che inizia con "action_".
  //
  // These handlers respond to main menu buttons (/start).
  // Each button has a callback_data that starts with "action_".
  // ===========================================================================

  /**
   * Mostra le carte NFT dell'utente.
   * Shows the user's NFT cards.
   *
   * callback_data: "action_my_cards"
   * Delega a showMyCards() in actions.ts che interroga il contratto on-chain.
   * Delegates to showMyCards() in actions.ts which queries the on-chain contract.
   */
  bot.callbackQuery("action_my_cards", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await showMyCards(ctx);
  });

  /**
   * Avvia il flusso di creazione carta (conversazione grammY).
   * Starts the card creation flow (grammY conversation).
   *
   * callback_data: "action_create_card"
   * Entra nella conversazione "cardCreationConversation" che guida l'utente
   * passo-passo nella creazione di una carta personalizzata.
   * Enters the "cardCreationConversation" conversation that guides the user
   * step-by-step through card creation.
   */
  bot.callbackQuery("action_create_card", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await ctx.conversation.enter("cardCreationConversation");
  });

  /**
   * Mostra la homepage del marketplace NFT.
   * Shows the NFT marketplace homepage.
   *
   * callback_data: "action_marketplace"
   * Delega a showMarketplace() che mostra statistiche e opzioni di navigazione.
   * Delegates to showMarketplace() which shows stats and navigation options.
   */
  bot.callbackQuery("action_marketplace", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await showMarketplace(ctx);
  });

  /**
   * Mostra il pannello wallet dell'utente (saldo, indirizzo, azioni).
   * Shows the user's wallet panel (balance, address, actions).
   *
   * callback_data: "action_wallet"
   */
  bot.callbackQuery("action_wallet", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await showWallet(ctx);
  });

  /**
   * Mostra gli indirizzi dei contratti smart deployati.
   * Shows the deployed smart contract addresses.
   *
   * callback_data: "action_contracts"
   */
  bot.callbackQuery("action_contracts", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await showContracts(ctx);
  });

  /**
   * Mostra le informazioni di sicurezza e l'avviso anti-phishing.
   * Shows security information and anti-phishing warning.
   *
   * callback_data: "action_security"
   * Combina SECURITY_NOTICE e ANTI_PHISHING_WARNING da bot/security.ts.
   * Combines SECURITY_NOTICE and ANTI_PHISHING_WARNING from bot/security.ts.
   */
  bot.callbackQuery("action_security", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(SECURITY_NOTICE + "\n" + ANTI_PHISHING_WARNING, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu"),
    });
  });

  /**
   * Mostra la guida dei comandi.
   * Shows the command guide.
   *
   * callback_data: "action_help"
   */
  bot.callbackQuery("action_help", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await showHelp(ctx);
  });

  /**
   * Mostra un messaggio promozionale condivisibile con GIF Pokemon.
   * Shows a shareable promotional message with Pokemon GIF.
   *
   * callback_data: "action_share"
   * Genera un link di condivisione personalizzato per l'utente e
   * invia una GIF animata Pokemon con il messaggio promozionale.
   *
   * Generates a personalized share link for the user and sends
   * an animated Pokemon GIF with the promotional message.
   */
  bot.callbackQuery("action_share", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}

    const userId = ctx.from?.id;
    if (!userId) return;

    const { caption, gif, keyboard } = buildShareMessage(userId);

    try {
      await ctx.replyWithAnimation(gif, {
        caption,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } catch {
      await ctx.reply(caption, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  });

  /**
   * Mostra le inserzioni attive dell'utente nel marketplace.
   * Shows the user's active marketplace listings.
   *
   * callback_data: "action_my_listings"
   */
  bot.callbackQuery("action_my_listings", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await showMyListings(ctx);
  });

  /**
   * Mostra le offerte di acquisto fatte dall'utente.
   * Shows purchase offers made by the user.
   *
   * callback_data: "action_my_offers"
   *
   * Flusso / Flow:
   * 1. Recupera l'indirizzo wallet dell'utente
   *    Retrieves the user's wallet address
   * 2. Chiama getBuyerOffers() sul contratto marketplace
   *    Calls getBuyerOffers() on the marketplace contract
   * 3. Per ogni offerta attiva, mostra ID e importo in ETH
   *    For each active offer, shows ID and amount in ETH
   * 4. Limita a 10 offerte per evitare messaggi troppo lunghi
   *    Limits to 10 offers to avoid overly long messages
   */
  bot.callbackQuery("action_my_offers", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}

    const userId = ctx.from?.id;
    if (!userId) return;

    // Importa dinamicamente il contratto marketplace
    // Dynamically import the marketplace contract
    const { marketplaceContract } = await import("../contracts/provider.js");
    if (!marketplaceContract) {
      await ctx.reply("❌ Marketplace contract not configured.");
      return;
    }

    // Verifica che l'utente abbia un wallet
    // Verify the user has a wallet
    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) {
      await ctx.reply("❌ Create your wallet first!", {
        reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
      });
      return;
    }

    const loadingMsg = await ctx.reply("🔄 Loading your offers...");

    try {
      // Recupera gli ID delle offerte dal contratto on-chain
      // Retrieve offer IDs from the on-chain contract
      const offerIds = await marketplaceContract.getBuyerOffers(walletAddress);

      try {
        await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
      } catch {}

      if (offerIds.length === 0) {
        await ctx.reply("📭 You don't have any active offers!");
        return;
      }

      let message = `📥 *Your Offers*\n\n`;

      // Itera le offerte (max 10) e mostra quelle attive
      // Iterate offers (max 10) and show active ones
      for (const offerId of offerIds.slice(0, 10)) {
        try {
          const offer = await marketplaceContract.getOffer(offerId);
          if (offer.active) {
            const amountEth = ethers.formatEther(offer.amount);
            message += `#${offerId}: ${amountEth} ETH\n`;
          }
        } catch {}
      }

      await ctx.reply(message, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error showing offers:", error);
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
      } catch {}
      await ctx.reply("❌ Error loading offers. Please try again.");
    }
  });

  /**
   * Avvia il flusso di vendita carta (conversazione grammY).
   * Starts the card listing/selling flow (grammY conversation).
   *
   * callback_data: "action_sell"
   * Entra nella conversazione "listCardConversation" per guidare l'utente
   * nella messa in vendita di una carta dal draft al marketplace.
   * Enters the "listCardConversation" conversation to guide the user
   * through listing a card from draft to the marketplace.
   */
  bot.callbackQuery("action_sell", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await ctx.conversation.enter("listCardConversation");
  });

  /**
   * Ritorna al menu principale.
   * Returns to the main menu.
   *
   * callback_data: "main_menu"
   * Usato come pulsante "Home" in molte schermate del bot.
   * Used as a "Home" button across many bot screens.
   */
  bot.callbackQuery("main_menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    const firstName = ctx.from?.first_name;
    await ctx.reply(getWelcomeMessage(firstName), {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard(),
    });
  });

  /**
   * Mostra i draft (bozze) salvate dall'utente.
   * Shows saved drafts for the user.
   *
   * callback_data: "my_drafts"
   * I draft sono carte create ma non ancora mintate come NFT.
   * Drafts are cards created but not yet minted as NFTs.
   */
  bot.callbackQuery("my_drafts", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    await showMyDrafts(ctx);
  });

  // ===========================================================================
  // SEZIONE 2: VISUALIZZAZIONE CARTE E STATO MINT
  // SECTION 2: CARD VIEWING AND MINT STATUS
  // ===========================================================================
  //
  // Handler per visualizzare i dettagli di una carta specifica e per
  // controllare lo stato di una transazione di minting in corso.
  //
  // Handlers for viewing details of a specific card and for checking
  // the status of an ongoing minting transaction.
  // ===========================================================================

  /**
   * Mostra i dettagli di una carta specifica.
   * Shows details for a specific card.
   *
   * callback_data: "view_card_{tokenId}" (regex match)
   * Esempio: "view_card_42" -> mostra la carta con tokenId 42.
   * Example: "view_card_42" -> shows the card with tokenId 42.
   *
   * Usa una regex per estrarre il tokenId dinamico dal callback_data.
   * Uses a regex to extract the dynamic tokenId from callback_data.
   */
  bot.callbackQuery(/^view_card_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    const match = ctx.callbackQuery.data.match(/^view_card_(\d+)$/);
    if (!match) return;
    const cardId = parseInt(match[1]);
    await showCardDetails(ctx, cardId);
  });

  /**
   * Naviga a una specifica carta nel carousel "My Cards" (lazy loading).
   * Navigates to a specific card in the "My Cards" carousel (lazy loading).
   *
   * callback_data: "my_card_{index}_{total}" (regex match)
   *
   * Usa getCardEntries() per la lista leggera (solo tokenId + stato listing),
   * poi enrichCardEntry() per arricchire SOLO la carta da visualizzare.
   * Questo riduce le chiamate RPC da ~24 sequenziali a ~4 parallele.
   *
   * Uses getCardEntries() for a lightweight list (just tokenId + listing status),
   * then enrichCardEntry() to enrich ONLY the card being displayed.
   * This reduces RPC calls from ~24 sequential to ~4 parallel.
   */
  bot.callbackQuery(/^my_card_\d+_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const userId = ctx.from?.id;
    if (!userId) return;

    const match = ctx.callbackQuery.data.match(/^my_card_(\d+)_(\d+)$/);
    if (!match) return;
    const targetIndex = parseInt(match[1]);

    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) return;

    try {
      // Fase 1: Lista leggera di tutte le carte (parallela, veloce)
      // Phase 1: Lightweight list of all cards (parallel, fast)
      const entries = await getCardEntries(walletAddress);

      if (entries.length === 0 || targetIndex >= entries.length) {
        try {
          await ctx.editMessageCaption({
            caption: "📭 No cards found.",
            reply_markup: new InlineKeyboard()
              .text("🎨 Create Card", "action_create_card")
              .text("🏠 Menu", "main_menu")
          });
        } catch {
          await ctx.editMessageText("📭 No cards found.", {
            reply_markup: new InlineKeyboard()
              .text("🎨 Create Card", "action_create_card")
              .text("🏠 Menu", "main_menu")
          });
        }
        return;
      }

      // Fase 2: Arricchisci SOLO la carta target (stats + metadata in parallelo)
      // Phase 2: Enrich ONLY the target card (stats + metadata in parallel)
      const card = await enrichCardEntry(entries[targetIndex]);
      const { caption, keyboard } = buildMyCardView(card, targetIndex, entries.length);

      if (card.imageUrl) {
        try {
          const media = InputMediaBuilder.photo(card.imageUrl, {
            caption,
            parse_mode: "Markdown"
          });
          await ctx.editMessageMedia(media, { reply_markup: keyboard });
          return;
        } catch (imgError) {
          // "not modified" = contenuto identico, ignora silenziosamente
          // "not modified" = identical content, silently ignore
          if (imgError instanceof GrammyError && imgError.description.includes("not modified")) return;
          console.error("My card editMedia failed:", imgError);
        }
      }

      try {
        await ctx.editMessageCaption({
          caption: caption + "\n\n📷 _(Image unavailable)_",
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
      } catch (capErr) {
        if (capErr instanceof GrammyError && capErr.description.includes("not modified")) return;
        try {
          await ctx.editMessageText(caption + "\n\n📷 _(Image unavailable)_", {
            parse_mode: "Markdown",
            reply_markup: keyboard
          });
        } catch {}
      }
    } catch (error) {
      console.error("My card navigation error:", error);
      try {
        await ctx.editMessageCaption({
          caption: "❌ Error loading card.",
          reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu")
        });
      } catch {
        await ctx.editMessageText("❌ Error loading card.", {
          reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu")
        });
      }
    }
  });

  /**
   * Mostra la griglia compatta di tutte le carte per selezione diretta.
   * Shows compact grid of all cards for direct selection (jump-to-card).
   *
   * callback_data: "my_cards_grid_{page}" (regex match)
   * Recupera la lista leggera + nomi delle carte per mostrare la griglia.
   * Fetches lightweight list + card names to display the grid.
   */
  bot.callbackQuery(/^my_cards_grid_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const userId = ctx.from?.id;
    if (!userId) return;

    const match = ctx.callbackQuery.data.match(/^my_cards_grid_(\d+)$/);
    if (!match) return;
    const page = parseInt(match[1]);

    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) return;

    try {
      const entries = await getCardEntries(walletAddress);
      if (entries.length === 0) {
        try {
          await ctx.editMessageCaption({
            caption: "📭 No cards found.",
            reply_markup: new InlineKeyboard()
              .text("🎨 Create Card", "action_create_card")
              .text("🏠 Menu", "main_menu")
          });
        } catch {
          await ctx.editMessageText("📭 No cards found.", {
            reply_markup: new InlineKeyboard()
              .text("🎨 Create Card", "action_create_card")
              .text("🏠 Menu", "main_menu")
          });
        }
        return;
      }

      // Recupera i nomi delle carte nella pagina corrente (parallelo, veloce)
      // Fetch card names for the current page (parallel, fast)
      const perPage = 10;
      const start = page * perPage;
      const pageEntries = entries.slice(start, start + perPage);
      const names = new Map<number, string>();

      if (customCardsContract) {
        const nameResults = await Promise.all(
          pageEntries.map(async (entry) => {
            try {
              const tokenURI = await customCardsContract!.tokenURI(entry.tokenId);
              const metadata = await fetchNFTMetadata(tokenURI);
              return { tokenId: entry.tokenId, name: metadata?.name || null };
            } catch { return { tokenId: entry.tokenId, name: null }; }
          })
        );
        for (const r of nameResults) {
          if (r.name) names.set(r.tokenId, r.name);
        }
      }

      const { caption, keyboard } = buildMyCardsGrid(entries, names, page);

      try {
        await ctx.editMessageCaption({
          caption,
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
      } catch {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply(caption, {
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
      }
    } catch (error) {
      console.error("Grid view error:", error);
    }
  });

  /**
   * Salta direttamente a una carta dalla griglia.
   * Jumps directly to a card from the grid view.
   *
   * callback_data: "grid_card_{index}_{total}" (regex match)
   * Stesso flusso di my_card_ ma cancella il messaggio griglia e invia nuovo.
   * Same flow as my_card_ but deletes grid message and sends new.
   */
  bot.callbackQuery(/^grid_card_\d+_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const userId = ctx.from?.id;
    if (!userId) return;

    const match = ctx.callbackQuery.data.match(/^grid_card_(\d+)_(\d+)$/);
    if (!match) return;
    const targetIndex = parseInt(match[1]);

    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) return;

    try {
      const entries = await getCardEntries(walletAddress);
      if (entries.length === 0 || targetIndex >= entries.length) return;

      const card = await enrichCardEntry(entries[targetIndex]);

      // La griglia e' un messaggio di testo, quindi cancelliamo e inviamo foto
      // The grid is a text message, so delete it and send a photo
      try { await ctx.deleteMessage(); } catch {}

      const { showMyCardAt } = await import("./actions.js");
      await showMyCardAt(ctx, card, targetIndex, entries.length);
    } catch (error) {
      console.error("Grid card jump error:", error);
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply("❌ Error loading card.", {
        reply_markup: new InlineKeyboard().text("🏠 Menu", "main_menu")
      });
    }
  });

  /**
   * Controlla e aggiorna lo stato di minting di un draft.
   * Checks and updates the minting status of a draft.
   *
   * callback_data: "refresh_mint_{draftId}" (regex match)
   *
   * Questo handler gestisce l'intero ciclo di vita del minting:
   * This handler manages the entire minting lifecycle:
   *
   * 1. "minted"  -> La carta e' gia' stata mintata con successo.
   *                  Mostra i dettagli finali (tokenId, txHash, stats).
   *                  The card has already been minted successfully.
   *                  Shows final details (tokenId, txHash, stats).
   *
   * 2. "failed"  -> Il minting e' fallito. Mostra l'errore.
   *                  Minting failed. Shows the error.
   *
   * 3. "minting" -> La transazione e' in corso. Interroga la blockchain
   *                  per controllare se la receipt e' disponibile.
   *                  Transaction is in progress. Queries the blockchain
   *                  to check if the receipt is available.
   *
   *    3a. Receipt trovata con status 1 -> Successo! Aggiorna il draft.
   *        Receipt found with status 1 -> Success! Updates the draft.
   *        Estrae il tokenId dal log Transfer(from=0x0, to, tokenId).
   *        Extracts tokenId from the Transfer(from=0x0, to, tokenId) log.
   *
   *    3b. Receipt trovata con status 0 -> Transazione fallita (revert).
   *        Receipt found with status 0 -> Transaction failed (revert).
   *
   *    3c. Nessuna receipt -> Transazione ancora in pending.
   *        No receipt -> Transaction still pending.
   */
  bot.callbackQuery(/^refresh_mint_(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.answerCallbackQuery("Error: User not found");
      return;
    }

    const match = ctx.callbackQuery.data.match(/^refresh_mint_(.+)$/);
    if (!match) {
      await ctx.answerCallbackQuery("Invalid request");
      return;
    }

    // Recupera il draft dal draftStore locale
    // Retrieve the draft from the local draftStore
    const draftId = match[1];
    const draft = draftStore.get(userId, draftId);

    if (!draft) {
      await ctx.answerCallbackQuery("Draft not found");
      return;
    }

    // --- Caso: gia' mintato con successo ---
    // --- Case: already minted successfully ---
    if (draft.status === "minted") {
      await ctx.answerCallbackQuery("✅ Card already minted!");

      const type = POKEMON_TYPES[draft.stats.pokemonType];
      const typeEmoji = TYPE_EMOJIS[type] || "❓";
      const rarityInfo = RARITIES[draft.stats.rarity];

      const successKeyboard = new InlineKeyboard()
        .url("🔍 View on Etherscan", `${NETWORK.explorer}/tx/${draft.mintTxHash}`)
        .row()
        .text("🎴 My Cards", "action_my_cards")
        .text("🏠 Menu", "main_menu");

      await ctx.editMessageText(`🎉 *${sanitizeForMarkdown(draft.cardName)}* is now an NFT!

${rarityInfo.emoji} *Rarity:* ${rarityInfo.name}
${typeEmoji} *Type:* ${type}
❤️ HP: ${draft.stats.hp} | ⚔️ ATK: ${draft.stats.attack}
🛡️ DEF: ${draft.stats.defense} | 💨 SPD: ${draft.stats.speed}

🆔 *Token ID:* #${draft.mintedTokenId || "pending"}
📜 *TX:* \`${draft.mintTxHash?.slice(0, 20)}...\`

🛒 Ready to sell? Use the Marketplace!`, {
        parse_mode: "Markdown",
        reply_markup: successKeyboard
      });
      return;
    }

    // --- Caso: minting fallito ---
    // --- Case: minting failed ---
    if (draft.status === "failed") {
      await ctx.answerCallbackQuery("❌ Minting failed");
      await ctx.editMessageText(`❌ *Minting Failed*\n\n${draft.errorMessage || "Unknown error"}\n\nTry again with /drafts`, {
        parse_mode: "Markdown",
        reply_markup: getMainMenuKeyboard()
      });
      return;
    }

    // --- Caso: minting in corso, verifica receipt on-chain ---
    // --- Case: minting in progress, check receipt on-chain ---
    if (draft.status === "minting" && draft.mintTxHash) {
      try {
        // Interroga il provider per la receipt della transazione
        // Query the provider for the transaction receipt
        const receipt = await provider.getTransactionReceipt(draft.mintTxHash);
        if (receipt) {
          // Status 1 = transazione confermata con successo
          // Status 1 = transaction confirmed successfully
          if (receipt.status === 1) {
            // Prova a estrarre il tokenId dai log della transazione.
            // Il primo metodo usa l'interfaccia del contratto per parsare i log.
            // Try to extract tokenId from transaction logs.
            // The first method uses the contract interface to parse logs.
            let tokenId: number | undefined;
            for (const log of receipt.logs) {
              try {
                const parsed = customCardsContract?.interface.parseLog({
                  topics: log.topics as string[],
                  data: log.data
                });
                // Un Transfer(from=0x0) indica un mint (creazione da zero)
                // A Transfer(from=0x0) indicates a mint (creation from zero address)
                if (parsed?.name === "Transfer" && parsed.args[0] === ethers.ZeroAddress) {
                  tokenId = Number(parsed.args[2]);
                  break;
                }
              } catch (parseErr) {}
            }

            // Fallback: se il parsing dell'interfaccia fallisce, prova a leggere
            // direttamente i topic del log Transfer ERC-721 grezzo.
            // Fallback: if interface parsing fails, try reading the raw
            // ERC-721 Transfer log topics directly.
            if (tokenId === undefined) {
              // Keccak256 di "Transfer(address,address,uint256)" - evento ERC-721
              // Keccak256 of "Transfer(address,address,uint256)" - ERC-721 event
              const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
              for (const log of receipt.logs) {
                if (log.topics[0] === transferTopic && log.topics.length >= 4) {
                  const from = "0x" + log.topics[1].slice(26);
                  if (from === ethers.ZeroAddress) {
                    tokenId = Number(BigInt(log.topics[3]));
                    console.log(`[RefreshStatus] Recovered tokenId ${tokenId} from raw Transfer log`);
                    break;
                  }
                }
              }
            }

            if (tokenId === undefined) {
              console.error(`[RefreshStatus] Could not parse tokenId from ${receipt.logs.length} logs in tx ${draft.mintTxHash}`);
            }

            // Aggiorna il draft con i dati finali del minting
            // Update the draft with final minting data
            draft.status = "minted";
            draft.mintedTokenId = tokenId;
            draft.mintedContractAddress = CONTRACTS.CUSTOM_CARDS;
            draft.mintedAt = Date.now();
            draftStore.save(draft);

            await ctx.answerCallbackQuery("✅ Card minted!");

            const type = POKEMON_TYPES[draft.stats.pokemonType];
            const typeEmoji = TYPE_EMOJIS[type] || "❓";
            const rarityInfo = RARITIES[draft.stats.rarity];

            const successKeyboard = new InlineKeyboard()
              .url("🔍 View on Etherscan", `${NETWORK.explorer}/tx/${draft.mintTxHash}`)
              .row()
              .text("🎴 My Cards", "action_my_cards")
              .text("🏠 Menu", "main_menu");

            await ctx.editMessageText(`🎉 *${sanitizeForMarkdown(draft.cardName)}* is now an NFT!

${rarityInfo.emoji} *Rarity:* ${rarityInfo.name}
${typeEmoji} *Type:* ${type}
❤️ HP: ${draft.stats.hp} | ⚔️ ATK: ${draft.stats.attack}
🛡️ DEF: ${draft.stats.defense} | 💨 SPD: ${draft.stats.speed}

🆔 *Token ID:* #${tokenId || "pending"}
📜 *TX:* \`${draft.mintTxHash?.slice(0, 20)}...\`

🛒 Ready to sell? Use the Marketplace!`, {
              parse_mode: "Markdown",
              reply_markup: successKeyboard
            });
          } else {
            // Status 0 = transazione fallita (revert on-chain)
            // Status 0 = transaction failed (on-chain revert)
            draft.status = "failed";
            draft.errorMessage = "Transaction reverted";
            draftStore.save(draft);
            await ctx.answerCallbackQuery("❌ Transaction failed");
          }
        } else {
          // Nessuna receipt = transazione ancora nel mempool
          // No receipt = transaction still in the mempool
          await ctx.answerCallbackQuery("⏳ Still pending... try again in a moment");
        }
      } catch (error) {
        await ctx.answerCallbackQuery("⏳ Still confirming...");
      }
      return;
    }

    // Caso generico: mostra lo stato attuale del draft
    // Generic case: show current draft status
    await ctx.answerCallbackQuery(`Status: ${draft.status}`);
  });

  // ===========================================================================
  // SEZIONE 3: MARKETPLACE (modulo esterno)
  // SECTION 3: MARKETPLACE (external module)
  // ===========================================================================
  // Vedi / See: marketplace-callbacks.ts
  registerMarketplaceCallbacks();

  // ===========================================================================
  // SEZIONE 4: WALLET (modulo esterno)
  // SECTION 4: WALLET (external module)
  // ===========================================================================
  // Vedi / See: wallet-callbacks.ts
  registerWalletCallbacks();

  // ===========================================================================
  // SEZIONE 5: UTILITY
  // SECTION 5: UTILITY
  // ===========================================================================

  /**
   * Attiva/disattiva le notifiche promozionali periodiche.
   * Toggles periodic promotional notifications on/off.
   *
   * callback_data: "toggle_notifications"
   */
  bot.callbackQuery("toggle_notifications", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.answerCallbackQuery();
      return;
    }

    const session = sessionStore.get(userId);
    if (session) {
      session.notificationsEnabled = !session.notificationsEnabled;
      sessionStore.save(session);
      await ctx.answerCallbackQuery(
        session.notificationsEnabled
          ? "🔔 Notifications enabled"
          : "🔕 Notifications disabled"
      );
    } else {
      await ctx.answerCallbackQuery();
    }

    try { await ctx.deleteMessage(); } catch {}
  });

  /**
   * Cancella il messaggio corrente (usato per i messaggi sensibili).
   * Deletes the current message (used for sensitive messages).
   *
   * callback_data: "delete_this_message"
   * Permette all'utente di cancellare manualmente un messaggio sensibile
   * (chiave privata, seed phrase, ecc.) prima del timeout automatico.
   * Allows the user to manually delete a sensitive message
   * (private key, seed phrase, etc.) before the automatic timeout.
   */
  bot.callbackQuery("delete_this_message", async (ctx) => {
    await ctx.answerCallbackQuery("Message deleted");
    try {
      await ctx.deleteMessage();
    } catch (error) {}
  });

  /**
   * Handler "no-op" per bottoni informativi (es. contatore pagine "1/3").
   * No-op handler for informational buttons (e.g. page counter "1/3").
   *
   * callback_data: "noop"
   * Non fa nulla, ma deve rispondere alla callback per evitare
   * l'icona di caricamento infinita su Telegram.
   * Does nothing, but must answer the callback to avoid
   * the infinite loading icon on Telegram.
   */
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

}
