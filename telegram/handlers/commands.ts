// =============================================================================
// HANDLER COMANDI - Gestione comandi slash del bot (/start, /help, etc.)
// COMMAND HANDLERS - Bot slash command handling (/start, /help, etc.)
//
// Questo file registra tutti i comandi slash che l'utente puo' digitare nella
// chat di Telegram. Ogni comando e' associato a una funzione che risponde con
// un messaggio, una tastiera inline, oppure avvia una "conversation" (flusso
// guidato a piu' passaggi).
//
// This file registers all slash commands that the user can type in the Telegram
// chat. Each command is mapped to a handler that responds with a message, an
// inline keyboard, or starts a "conversation" (a multi-step guided flow).
//
// Pattern usato: bot.command("<nome>", async (ctx) => { ... })
// Pattern used:  bot.command("<name>", async (ctx) => { ... })
//   - grammY (la libreria Telegram) intercetta il messaggio "/<nome>"
//   - grammY (the Telegram library) intercepts the "/<name>" message
//   - ctx (contesto) contiene info sull'utente, chat, e metodi per rispondere
//   - ctx (context) holds user info, chat data, and reply methods
// =============================================================================

import { sessionStore } from "../storage/index.js";
import { NETWORK } from "../config.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import { SECURITY_NOTICE, ANTI_PHISHING_WARNING } from "../bot/security.js";
import { bot } from "../bot/setup.js";
import {
  showHelp, showMyCards, showCardDetails,
  showMyCreations, showMyDrafts, showMarketplace,
  showMarketplaceBrowser, showMyListings, showWallet, showContracts
} from "./actions.js";

// =============================================================================
// REGISTRAZIONE COMANDI - Funzione principale che collega comandi a handler
// COMMAND REGISTRATION - Main function that wires commands to handlers
//
// Viene chiamata una sola volta all'avvio del bot. Dopo la registrazione,
// grammY instraderà automaticamente ogni messaggio "/<comando>" al handler
// corrispondente.
//
// Called once at bot startup. After registration, grammY will automatically
// route every "/<command>" message to the corresponding handler.
// =============================================================================

/**
 * Registra tutti i comandi slash del bot.
 * Registers all bot slash commands.
 *
 * I comandi sono raggruppati in categorie:
 * Commands are grouped into categories:
 *
 * 1. GENERALI / GENERAL     - /start, /help, /clear
 * 2. CARTE / CARDS           - /cards, /card, /createcard, /create, /mycreations, /drafts
 * 3. MARKETPLACE             - /market, /listings, /sell, /list, /browse
 * 4. WALLET & SICUREZZA      - /wallet, /security, /contracts
 *    WALLET & SECURITY
 */
export function registerCommandHandlers() {

  // ---------------------------------------------------------------------------
  // 1. COMANDI GENERALI / GENERAL COMMANDS
  // ---------------------------------------------------------------------------

  /**
   * /start - Primo comando eseguito quando l'utente apre il bot.
   * /start - First command executed when the user opens the bot.
   *
   * Cosa fa / What it does:
   * - Crea o recupera la sessione utente (memorizza userId, username, nome)
   *   Creates or retrieves the user session (stores userId, username, name)
   * - Mostra un messaggio di benvenuto con le feature principali
   *   Shows a welcome message with the main features
   * - Visualizza la tastiera principale (InlineKeyboard) per navigare nel bot
   *   Displays the main keyboard (InlineKeyboard) to navigate the bot
   *
   * Nota: ctx.from contiene i dati Telegram dell'utente (id, username, ecc.)
   * Note: ctx.from holds the user's Telegram data (id, username, etc.)
   */
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;
    const firstName = ctx.from?.first_name;

    // Crea o recupera la sessione utente dal session store locale
    // Create or retrieve the user session from the local session store
    if (userId) {
      sessionStore.getOrCreate(userId, username, firstName);
    }

    await ctx.reply(
      `🎮 *Welcome to PokeDEX NFT!*

Create Pokemon cards as NFTs and sell them on the marketplace!

*Features:*
• 🎨 Create cards with royalties
• 🛒 Buy/sell cards on the marketplace
• 👛 Built-in wallet management

*Network:* ${NETWORK.name} Testnet
*Contracts:* Verified on Etherscan

🔒 *Security:* We never ask for private keys!`,
      { parse_mode: "Markdown", reply_markup: getMainMenuKeyboard() }
    );
  });

  /**
   * /help - Mostra la guida completa con tutti i comandi disponibili.
   * /help - Shows the complete guide with all available commands.
   *
   * Delega alla funzione showHelp() in actions.ts che formatta il messaggio
   * con i comandi raggruppati per categoria (Carte, Marketplace, Account).
   *
   * Delegates to the showHelp() function in actions.ts which formats the
   * message with commands grouped by category (Cards, Marketplace, Account).
   */
  bot.command("help", async (ctx) => {
    await showHelp(ctx);
  });

  /**
   * /clear - Pulisce visivamente la chat inviando righe vuote.
   * /clear - Visually clears the chat by sending empty lines.
   *
   * Non cancella realmente i messaggi (Telegram non lo consente facilmente),
   * ma spinge i vecchi messaggi fuori dallo schermo con 50 righe vuote.
   *
   * Doesn't actually delete messages (Telegram doesn't easily allow that),
   * but pushes old messages off screen with 50 blank lines.
   */
  bot.command("clear", async (ctx) => {
    const clearScreen = "\n".repeat(50);
    await ctx.reply(clearScreen + "🧹 *Chat cleared!*\n\nWhat would you like to do?", {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard()
    });
  });

  // ---------------------------------------------------------------------------
  // 2. COMANDI CARTE / CARD COMMANDS
  //
  // Gestiscono la visualizzazione, creazione e gestione delle carte NFT.
  // Handle viewing, creating, and managing NFT cards.
  // ---------------------------------------------------------------------------

  /**
   * /cards - Mostra tutte le carte possedute dall'utente.
   * /cards - Shows all cards owned by the user.
   *
   * Interroga lo smart contract sulla blockchain per ottenere la lista
   * dei token NFT associati al wallet dell'utente.
   *
   * Queries the smart contract on the blockchain to get the list of
   * NFT tokens associated with the user's wallet.
   */
  bot.command("cards", async (ctx) => {
    await showMyCards(ctx);
  });

  /**
   * /card <ID> - Mostra i dettagli di una carta specifica.
   * /card <ID> - Shows details of a specific card.
   *
   * Esempio / Example: /card 5  ->  mostra/shows card #5
   *
   * ctx.match contiene il testo dopo il comando (es. "5" da "/card 5").
   * ctx.match holds the text after the command (e.g. "5" from "/card 5").
   * Se l'ID non e' valido, mostra un messaggio d'errore con la sintassi corretta.
   * If the ID is invalid, shows an error message with the correct syntax.
   */
  bot.command("card", async (ctx) => {
    const cardId = parseInt(ctx.match || "0");
    if (!cardId) {
      await ctx.reply("❌ Usage: `/card <ID>`\nExample: `/card 1`", { parse_mode: "Markdown" });
      return;
    }
    await showCardDetails(ctx, cardId);
  });

  /**
   * /createcard - Avvia il flusso guidato di creazione carta.
   * /createcard - Starts the guided card creation flow.
   *
   * Usa il sistema "conversation" di grammY: un dialogo a piu' passaggi
   * dove il bot chiede nome, tipo, statistiche, immagine, ecc. uno alla volta.
   *
   * Uses grammY's "conversation" system: a multi-step dialog where the bot
   * asks for name, type, stats, image, etc. one at a time.
   */
  bot.command("createcard", async (ctx) => {
    await ctx.conversation.enter("cardCreationConversation");
  });

  /**
   * /create - Alias di /createcard per comodita'.
   * /create - Alias for /createcard for convenience.
   */
  bot.command("create", async (ctx) => {
    await ctx.conversation.enter("cardCreationConversation");
  });

  /**
   * /mycreations - Mostra le carte che l'utente ha CREATO (non necessariamente posseduto).
   * /mycreations - Shows cards the user has CREATED (not necessarily owned).
   *
   * Differenza da /cards: un utente puo' creare una carta e poi venderla.
   * Difference from /cards: a user can create a card and then sell it.
   * /mycreations mostra tutto cio' che ha creato, anche se ora di proprieta' altrui.
   * /mycreations shows everything they created, even if now owned by someone else.
   */
  bot.command("mycreations", async (ctx) => {
    await showMyCreations(ctx);
  });

  /**
   * /drafts - Mostra le bozze salvate localmente (non ancora mintate on-chain).
   * /drafts - Shows locally saved drafts (not yet minted on-chain).
   *
   * Le bozze sono carte in fase di lavorazione: l'utente ha inserito alcuni
   * dati ma non ha ancora completato il minting (creazione definitiva sulla blockchain).
   *
   * Drafts are cards in progress: the user entered some data but hasn't yet
   * completed the minting (permanent creation on the blockchain).
   */
  bot.command("drafts", async (ctx) => {
    await showMyDrafts(ctx);
  });

  // ---------------------------------------------------------------------------
  // 3. COMANDI MARKETPLACE / MARKETPLACE COMMANDS
  //
  // Permettono di comprare, vendere e navigare le carte NFT in vendita.
  // Allow buying, selling, and browsing NFT cards for sale.
  // ---------------------------------------------------------------------------

  /**
   * /market - Mostra la schermata principale del marketplace.
   * /market - Shows the marketplace main screen.
   *
   * Visualizza le opzioni disponibili: sfogliare le carte, gestire le proprie
   * inserzioni (listing), mettere in vendita una carta.
   *
   * Displays available options: browse cards, manage your own listings,
   * put a card up for sale.
   */
  bot.command("market", async (ctx) => {
    await showMarketplace(ctx);
  });

  /**
   * /listings - Mostra le inserzioni attive dell'utente (le sue carte in vendita).
   * /listings - Shows the user's active listings (their cards for sale).
   */
  bot.command("listings", async (ctx) => {
    await showMyListings(ctx);
  });

  /**
   * /sell - Avvia il flusso guidato per mettere in vendita una carta.
   * /sell - Starts the guided flow to list a card for sale.
   *
   * Come /createcard, usa una "conversation" a piu' passaggi dove l'utente
   * sceglie la carta da vendere, imposta il prezzo, e conferma la transazione.
   *
   * Like /createcard, uses a multi-step "conversation" where the user picks
   * the card to sell, sets the price, and confirms the transaction.
   */
  bot.command("sell", async (ctx) => {
    await ctx.conversation.enter("listCardConversation");
  });

  /**
   * /list - Alias di /sell per comodita'.
   * /list - Alias for /sell for convenience.
   */
  bot.command("list", async (ctx) => {
    await ctx.conversation.enter("listCardConversation");
  });

  /**
   * /browse - Sfoglia le carte in vendita con immagini e paginazione.
   * /browse - Browse cards for sale with images and pagination.
   *
   * Parte dalla pagina 0 (la prima). L'utente puo' navigare avanti/indietro
   * usando i bottoni inline "Previous" e "Next".
   *
   * Starts from page 0 (the first). The user can navigate forward/backward
   * using the inline "Previous" and "Next" buttons.
   */
  bot.command("browse", async (ctx) => {
    await showMarketplaceBrowser(ctx, 0);
  });

  // ---------------------------------------------------------------------------
  // 4. COMANDI WALLET & SICUREZZA / WALLET & SECURITY COMMANDS
  //
  // Gestiscono il portafoglio integrato e le informazioni di sicurezza.
  // Handle the built-in wallet and security information.
  // ---------------------------------------------------------------------------

  /**
   * /wallet - Mostra la gestione del wallet (portafoglio crypto).
   * /wallet - Shows wallet (crypto wallet) management.
   *
   * Se l'utente ha gia' un wallet, mostra saldo e opzioni (deposito, prelievo,
   * esportazione chiave privata). Se non ne ha uno, offre di crearlo.
   *
   * If the user already has a wallet, shows balance and options (deposit,
   * withdraw, export private key). If they don't have one, offers to create it.
   */
  bot.command("wallet", async (ctx) => {
    await showWallet(ctx);
  });

  /**
   * /security - Mostra informazioni sulla sicurezza e avvisi anti-phishing.
   * /security - Shows security information and anti-phishing warnings.
   *
   * Ricorda all'utente di non condividere mai la chiave privata e come
   * riconoscere tentativi di truffa.
   *
   * Reminds the user to never share their private key and how to recognize
   * scam attempts.
   */
  bot.command("security", async (ctx) => {
    await ctx.reply(SECURITY_NOTICE + "\n" + ANTI_PHISHING_WARNING, { parse_mode: "Markdown" });
  });

  /**
   * /contracts - Mostra gli indirizzi degli smart contract deployati.
   * /contracts - Shows the addresses of deployed smart contracts.
   *
   * Utile per verificare i contratti su Etherscan o per sviluppatori che
   * vogliono interagire direttamente con i contratti.
   *
   * Useful for verifying contracts on Etherscan or for developers who
   * want to interact directly with the contracts.
   */
  bot.command("contracts", async (ctx) => {
    await showContracts(ctx);
  });
}
