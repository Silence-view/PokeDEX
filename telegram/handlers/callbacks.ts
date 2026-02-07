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

import { InlineKeyboard } from "grammy";
import { ethers } from "ethers";
import { CONTRACTS, NETWORK, POKEMON_TYPES, TYPE_EMOJIS, RARITIES } from "../config.js";
import { provider, customCardsContract } from "../contracts/provider.js";
import { draftStore } from "../storage/index.js";
import { getUserWalletAddress } from "../services/wallet-helpers.js";
import { sanitizeForMarkdown } from "../services/ipfs.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import { SECURITY_NOTICE, ANTI_PHISHING_WARNING } from "../bot/security.js";
import { bot } from "../bot/setup.js";
import {
  showHelp, showMyCards, showCardDetails,
  showMarketplace, showMyListings, showWallet, showContracts, showMyDrafts
} from "./actions.js";
import { registerMarketplaceCallbacks } from "./marketplace-callbacks.js";
import { registerWalletCallbacks } from "./wallet-callbacks.js";

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
    await ctx.reply(SECURITY_NOTICE + "\n" + ANTI_PHISHING_WARNING, { parse_mode: "Markdown" });
  });

  /**
   * Mostra la guida dei comandi.
   * Shows the command guide.
   *
   * callback_data: "action_help"
   */
  bot.callbackQuery("action_help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHelp(ctx);
  });

  /**
   * Pulisce la chat inviando righe vuote e mostra il menu principale.
   * Clears the chat by sending blank lines and shows the main menu.
   *
   * callback_data: "action_clear"
   * Tecnica: invia 50 righe vuote per "spingere" i messaggi vecchi fuori
   * dalla vista. Non cancella realmente i messaggi (impossibile nelle chat private).
   * Technique: sends 50 blank lines to "push" old messages out of view.
   * Does not actually delete messages (not possible in private chats).
   */
  bot.callbackQuery("action_clear", async (ctx) => {
    await ctx.answerCallbackQuery();
    const clearScreen = "\n".repeat(50);
    await ctx.reply(clearScreen + "🧹 *Chat cleared!*\n\nWhat would you like to do?", {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard()
    });
  });

  /**
   * Mostra le inserzioni attive dell'utente nel marketplace.
   * Shows the user's active marketplace listings.
   *
   * callback_data: "action_my_listings"
   */
  bot.callbackQuery("action_my_listings", async (ctx) => {
    await ctx.answerCallbackQuery();
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

    try {
      // Recupera gli ID delle offerte dal contratto on-chain
      // Retrieve offer IDs from the on-chain contract
      const offerIds = await marketplaceContract.getBuyerOffers(walletAddress);

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
    await ctx.reply("🏠 Main Menu:", { reply_markup: getMainMenuKeyboard() });
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
    const match = ctx.callbackQuery.data.match(/^view_card_(\d+)$/);
    if (!match) return;
    const cardId = parseInt(match[1]);
    await showCardDetails(ctx, cardId);
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

}
