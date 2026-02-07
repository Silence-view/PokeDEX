// =============================================================================
// AVVIO BOT - Sequenza di bootstrap e inizializzazione
// BOT STARTUP - Bootstrap sequence and initialization
// =============================================================================
//
// Questo modulo orchestra l'intera sequenza di avvio del bot PokeDEX.
// Viene invocato da bot.ts (l'entry point) e si occupa di inizializzare
// tutti i sottosistemi nell'ordine corretto.
//
// This module orchestrates the entire PokeDEX bot startup sequence.
// It is invoked by bot.ts (the entry point) and takes care of initializing
// all subsystems in the correct order.
//
// SEQUENZA DI AVVIO / BOOT SEQUENCE:
//
// 1. Inizializzazione contratti smart (provider + istanze contratto)
//    Smart contract initialization (provider + contract instances)
//
// 2. Inizializzazione Wallet Manager (gestione wallet custodial)
//    Wallet Manager initialization (custodial wallet management)
//
// 3. Verifica connettivita' contratti (totalSupply, marketplaceFee)
//    Contract connectivity verification (totalSupply, marketplaceFee)
//
// 4. Registrazione conversazioni grammY (flussi multi-step)
//    grammY conversation registration (multi-step flows)
//
// 5. Registrazione handler (comandi, callback, messaggi, errori)
//    Handler registration (commands, callbacks, messages, errors)
//
// 6. Registrazione comandi nel menu "/" di Telegram
//    Command registration in Telegram's "/" menu
//
// 7. Avvio long-polling con bot.start()
//    Long-polling start with bot.start()
//
// ORDINE IMPORTANTE / ORDER MATTERS:
// - I contratti devono essere inizializzati PRIMA degli handler
//   (gli handler usano le istanze dei contratti).
// - Le conversazioni devono essere registrate PRIMA degli handler
//   (grammY richiede che i middleware delle conversazioni siano
//   registrati prima degli handler che li usano).
// - L'error handler deve essere registrato PER ULTIMO per catturare
//   errori da tutti gli altri handler.
//
// - Contracts must be initialized BEFORE handlers
//   (handlers use contract instances).
// - Conversations must be registered BEFORE handlers
//   (grammY requires conversation middleware to be registered
//   before handlers that use them).
// - The error handler must be registered LAST to catch errors
//   from all other handlers.
//
// =============================================================================

import { CONTRACTS, NETWORK, WALLETS_DIR, WALLET_MASTER_KEY } from "./config.js";
import { initContracts, customCardsContract, marketplaceContract } from "./contracts/provider.js";
import { initializeWalletManager } from "./wallet/index.js";
import { bot, registerConversation } from "./bot/setup.js";
import { cardCreationConversation } from "./conversations/card-creation.js";
import { listCardConversation } from "./conversations/list-card.js";
import { listSelectedCardConversation } from "./conversations/list-selected-card.js";
import { registerCommandHandlers } from "./handlers/commands.js";
import { registerCallbackHandlers } from "./handlers/callbacks.js";
import { registerMessageHandlers } from "./handlers/messages.js";
import { registerErrorHandler } from "./handlers/errors.js";
import { startSaleNotifications } from "./services/sale-notifications.js";
import { startScheduler } from "./services/scheduler.js";

// =============================================================================
// REGISTRAZIONE COMANDI TELEGRAM
// TELEGRAM COMMAND REGISTRATION
// =============================================================================

/**
 * Registra i comandi nel menu "/" di Telegram (BotFather command list).
 * Registers commands in Telegram's "/" menu (BotFather command list).
 *
 * Questa funzione chiama l'API setMyCommands di Telegram per aggiornare
 * la lista dei comandi visibile quando l'utente digita "/" nella chat.
 * I comandi vengono mostrati come suggerimenti auto-completamento.
 *
 * This function calls Telegram's setMyCommands API to update the
 * command list visible when the user types "/" in the chat.
 * Commands are shown as autocomplete suggestions.
 *
 * NOTA: Questa lista e' solo cosmetica. I comandi effettivi sono
 * gestiti dagli handler in commands.ts. Aggiungere un comando qui
 * senza un handler corrispondente non fara' nulla.
 *
 * NOTE: This list is purely cosmetic. Actual commands are handled
 * by the handlers in commands.ts. Adding a command here without
 * a corresponding handler will do nothing.
 *
 * I comandi sono raggruppati logicamente:
 * Commands are logically grouped:
 *
 * - Navigazione: start, help, clear
 *   Navigation: start, help, clear
 * - Carte: cards, card, createcard, mycreations, drafts
 *   Cards: cards, card, createcard, mycreations, drafts
 * - Marketplace: market, browse, listings, sell, list
 *   Marketplace: market, browse, listings, sell, list
 * - Wallet e sicurezza: wallet, security, contracts
 *   Wallet and security: wallet, security, contracts
 */
async function registerCommands() {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Main menu" },
      { command: "help", description: "Commands guide" },
      { command: "clear", description: "Clear chat" },
      { command: "cards", description: "Your cards" },
      { command: "card", description: "Card details (e.g.: /card 1)" },
      { command: "createcard", description: "Create a card" },
      { command: "mycreations", description: "Your created cards" },
      { command: "drafts", description: "Saved drafts" },
      { command: "market", description: "NFT Marketplace" },
      { command: "browse", description: "Browse marketplace NFTs" },
      { command: "listings", description: "Your listings" },
      { command: "sell", description: "List a card for sale" },
      { command: "list", description: "List a card for sale" },
      { command: "wallet", description: "Manage wallet" },
      { command: "security", description: "Security info" },
      { command: "contracts", description: "Contract addresses" },
    ]);
    console.log("✅ Bot commands registered");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}

// =============================================================================
// FUNZIONE PRINCIPALE DI AVVIO
// MAIN STARTUP FUNCTION
// =============================================================================

/**
 * Funzione principale di avvio del bot. Inizializza tutti i sottosistemi
 * e avvia il long-polling di grammY.
 *
 * Main bot startup function. Initializes all subsystems and starts
 * grammY's long-polling.
 *
 * Questa funzione e' esportata e chiamata da bot.ts (entry point).
 * Non restituisce mai in condizioni normali: bot.start() mantiene
 * il processo attivo in un loop di long-polling infinito.
 *
 * This function is exported and called by bot.ts (entry point).
 * It never returns under normal conditions: bot.start() keeps the
 * process alive in an infinite long-polling loop.
 *
 * In caso di errore fatale durante l'inizializzazione (es. token bot
 * invalido, RPC URL non raggiungibile), l'errore verra' propagato
 * e il processo terminera'.
 *
 * In case of a fatal error during initialization (e.g., invalid bot
 * token, unreachable RPC URL), the error will propagate and the
 * process will terminate.
 */
export async function start() {
  console.log("🤖 Starting PokeDEX Telegram Bot...");
  console.log("━".repeat(60));

  // ---------------------------------------------------------------------------
  // PASSO 1: Inizializzazione contratti smart
  // STEP 1: Smart contract initialization
  // ---------------------------------------------------------------------------
  // Crea le istanze dei contratti (PokeDEXCustomCards, PokeDEXMarketplace)
  // usando il provider ethers.js configurato in config.ts.
  // Creates contract instances (PokeDEXCustomCards, PokeDEXMarketplace)
  // using the ethers.js provider configured in config.ts.
  // ---------------------------------------------------------------------------
  initContracts();

  // ---------------------------------------------------------------------------
  // PASSO 2: Inizializzazione Wallet Manager
  // STEP 2: Wallet Manager initialization
  // ---------------------------------------------------------------------------
  // Il WalletManager gestisce i wallet custodial degli utenti.
  // Riceve la directory di storage, la master key per la cifratura,
  // e l'URL RPC per interrogare la blockchain.
  //
  // The WalletManager manages users' custodial wallets.
  // It receives the storage directory, the master key for encryption,
  // and the RPC URL for querying the blockchain.
  // ---------------------------------------------------------------------------
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";
  initializeWalletManager(WALLETS_DIR, WALLET_MASTER_KEY, rpcUrl);
  console.log("✅ Custodial Wallet Manager initialized");
  console.log(`   Wallets dir: ${WALLETS_DIR}`);

  // ---------------------------------------------------------------------------
  // Log configurazione rete e contratti
  // Log network and contract configuration
  // ---------------------------------------------------------------------------
  console.log("✅ Bot token configured");
  console.log(`📡 Network: ${NETWORK.name} (Chain ID: ${NETWORK.chainId})`);
  console.log("━".repeat(60));
  console.log("📜 Contracts:");
  console.log(`   CustomCards:    ${CONTRACTS.CUSTOM_CARDS || "Not deployed"}`);
  console.log(`   Marketplace:    ${CONTRACTS.MARKETPLACE || "Not deployed"}`);
  console.log("━".repeat(60));

  // ---------------------------------------------------------------------------
  // PASSO 3: Verifica connettivita' contratti
  // STEP 3: Contract connectivity verification
  // ---------------------------------------------------------------------------
  // Esegue chiamate di lettura sui contratti per verificare che siano
  // raggiungibili e funzionanti. Non e' bloccante: se un contratto non
  // e' accessibile, il bot continua comunque l'avvio.
  //
  // Performs read calls on contracts to verify they are reachable
  // and functional. Non-blocking: if a contract is not accessible,
  // the bot continues starting up anyway.
  // ---------------------------------------------------------------------------
  if (customCardsContract) {
    try {
      const supply = await customCardsContract.totalSupply();
      console.log(`✅ CustomCards verified - Supply: ${supply}`);
    } catch { console.log("⚠️  CustomCards not accessible"); }
  }

  if (marketplaceContract) {
    try {
      const fee = await marketplaceContract.marketplaceFee();
      console.log(`✅ Marketplace verified - Fee: ${Number(fee) / 100}%`);
    } catch { console.log("⚠️  Marketplace not accessible"); }
  }

  console.log("━".repeat(60));

  // ---------------------------------------------------------------------------
  // PASSO 4: Registrazione conversazioni grammY
  // STEP 4: grammY conversation registration
  // ---------------------------------------------------------------------------
  // Le conversazioni sono flussi multi-step che mantengono lo stato tra
  // i messaggi. Devono essere registrate PRIMA degli handler che le usano.
  // Il cast "as any" e' necessario per compatibilita' di tipo con grammY.
  //
  // Conversations are multi-step flows that maintain state between messages.
  // They must be registered BEFORE handlers that use them.
  // The "as any" cast is needed for type compatibility with grammY.
  //
  // Conversazioni disponibili / Available conversations:
  // - cardCreationConversation: creazione carta passo-passo
  //   card creation step-by-step
  // - listCardConversation: vendita carta da draft
  //   card listing from draft
  // - listSelectedCardConversation: vendita carta selezionata dall'utente
  //   listing a card pre-selected by the user
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerConversation(cardCreationConversation as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerConversation(listCardConversation as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerConversation(listSelectedCardConversation as any);

  // ---------------------------------------------------------------------------
  // PASSO 5: Registrazione handler
  // STEP 5: Handler registration
  // ---------------------------------------------------------------------------
  // L'ORDINE E' CRITICO! grammY processa gli handler nell'ordine di
  // registrazione. Il primo handler che corrisponde a un update lo gestisce.
  //
  // ORDER IS CRITICAL! grammY processes handlers in registration order.
  // The first handler that matches an update handles it.
  //
  // 1. Comandi slash (/) - priorita' alta, pattern esatti
  //    Slash commands (/) - high priority, exact patterns
  // 2. Callback query (pulsanti) - pattern esatti e regex
  //    Callback queries (buttons) - exact and regex patterns
  // 3. Messaggi testo - fallback per input libero
  //    Text messages - fallback for free-form input
  // 4. Error handler - cattura tutto, registrato per ultimo
  //    Error handler - catch-all, registered last
  // ---------------------------------------------------------------------------
  registerCommandHandlers();
  registerCallbackHandlers();
  registerMessageHandlers();
  registerErrorHandler();

  // ---------------------------------------------------------------------------
  // PASSO 6: Registrazione comandi nel menu Telegram
  // STEP 6: Register commands in Telegram menu
  // ---------------------------------------------------------------------------
  // Aggiorna la lista comandi visibile nell'autocomplete "/" di Telegram.
  // Updates the command list visible in Telegram's "/" autocomplete.
  // ---------------------------------------------------------------------------
  await registerCommands();

  // ---------------------------------------------------------------------------
  // PASSO 7: Avvio listener notifiche di vendita
  // STEP 7: Start sale notification listener
  // ---------------------------------------------------------------------------
  // Ascolta gli eventi NFTSold emessi dal contratto marketplace per notificare
  // i venditori via Telegram quando una delle loro carte viene acquistata.
  //
  // Listens for NFTSold events emitted by the marketplace contract to notify
  // sellers via Telegram when one of their cards is purchased.
  // ---------------------------------------------------------------------------
  startSaleNotifications();
  startScheduler();

  console.log("━".repeat(60));
  console.log("🚀 Bot is running!");
  console.log("━".repeat(60));

  // ---------------------------------------------------------------------------
  // PASSO 8: Avvio long-polling
  // STEP 8: Start long-polling
  // ---------------------------------------------------------------------------
  // bot.start() avvia un loop infinito che interroga i server Telegram
  // per nuovi update (messaggi, callback, ecc.) e li distribuisce
  // agli handler registrati sopra.
  //
  // bot.start() starts an infinite loop that polls Telegram servers
  // for new updates (messages, callbacks, etc.) and dispatches them
  // to the handlers registered above.
  //
  // Questa chiamata NON restituisce mai in condizioni normali.
  // This call NEVER returns under normal conditions.
  // ---------------------------------------------------------------------------
  bot.start();
}
