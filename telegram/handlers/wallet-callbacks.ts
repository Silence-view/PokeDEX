// =============================================================================
// HANDLER CALLBACK WALLET - Gestione wallet custodial
// WALLET CALLBACK HANDLERS - Custodial wallet management
// =============================================================================
//
// Questo modulo gestisce tutte le callback query relative al wallet custodial:
// creazione, switch tra wallet multipli, deposito, prelievo ed esportazione
// delle chiavi private / seed phrase.
//
// This module handles all custodial wallet callback queries:
// creation, switching between multiple wallets, deposit, withdrawal,
// and export of private keys / seed phrases.
//
// Estratto da callbacks.ts per migliorare la manutenibilita' del codice.
// Extracted from callbacks.ts to improve code maintainability.
// =============================================================================

import { InlineKeyboard } from "grammy";
import { sessionStore } from "../storage/index.js";
import { bot } from "../bot/setup.js";
import {
  getWalletManager,
  sendSensitiveMessage,
  SENSITIVITY_LEVELS,
  exportKeyRateLimiter,
} from "../wallet/index.js";
import { showWallet } from "./actions.js";
import type { MyContext } from "../types.js";

// =============================================================================
// REGISTRAZIONE CALLBACK WALLET
// WALLET CALLBACK REGISTRATION
// =============================================================================

/**
 * Registra gli handler per le callback query del wallet.
 * Registers handlers for wallet callback queries.
 *
 * Handler registrati / Registered handlers:
 *   - wallet_create          : Crea primo wallet / Create first wallet
 *   - wallet_create_new      : Crea wallet aggiuntivo / Create additional wallet
 *   - wallet_switch          : Lista wallet per switch / List wallets for switching
 *   - wallet_select_{id}     : Seleziona wallet attivo / Select active wallet
 *   - wallet_deposit         : Mostra indirizzo deposito / Show deposit address
 *   - wallet_withdraw        : Avvia flusso prelievo / Start withdrawal flow
 *   - wallet_export_key      : Esporta chiave privata / Export private key
 *   - wallet_export_mnemonic : Esporta seed phrase / Export seed phrase
 */
export function registerWalletCallbacks() {

  /**
   * Crea il primo wallet per l'utente (o mostra quello esistente).
   * Creates the first wallet for the user (or shows the existing one).
   *
   * callback_data: "wallet_create"
   * Se l'utente ha gia' un wallet, mostra il pannello wallet.
   * Se non ne ha, chiama createNewWallet() per generarne uno nuovo.
   * If the user already has a wallet, shows the wallet panel.
   * If not, calls createNewWallet() to generate a new one.
   */
  bot.callbackQuery("wallet_create", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const walletManager = getWalletManager();

      if (walletManager.hasWallet(userId)) {
        await showWallet(ctx);
        return;
      }

      await createNewWallet(ctx, userId, "Wallet 1");
    } catch (error) {
      console.error("Error creating wallet:", error);
      await ctx.reply("❌ Error creating wallet. Please try again.");
    }
  });

  /**
   * Crea un wallet aggiuntivo (massimo 5 per utente).
   * Creates an additional wallet (maximum 5 per user).
   *
   * callback_data: "wallet_create_new"
   * Ogni utente puo' avere fino a 5 wallet per gestire fondi separati.
   * Each user can have up to 5 wallets to manage separate funds.
   */
  bot.callbackQuery("wallet_create_new", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const walletManager = getWalletManager();
      const count = walletManager.getWalletCount(userId);

      if (count >= 5) {
        await ctx.reply("⚠️ Maximum 5 wallets allowed per user.");
        return;
      }

      await createNewWallet(ctx, userId, `Wallet ${count + 1}`);
    } catch (error) {
      console.error("Error creating wallet:", error);
      await ctx.reply("❌ Error creating wallet. Please try again.");
    }
  });

  /**
   * Mostra la lista dei wallet dell'utente per cambiare quello attivo.
   * Shows the user's wallet list to switch the active one.
   *
   * callback_data: "wallet_switch"
   * Crea una tastiera dinamica con un pulsante per ogni wallet.
   * Il wallet attivo e' contrassegnato con un segno di spunta.
   * Creates a dynamic keyboard with a button for each wallet.
   * The active wallet is marked with a checkmark.
   */
  bot.callbackQuery("wallet_switch", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const walletManager = getWalletManager();
      const wallets = await walletManager.listWallets(userId);

      if (wallets.length <= 1) {
        await ctx.reply("ℹ️ You only have one wallet. Create more to switch between them!", {
          reply_markup: new InlineKeyboard().text("➕ New Wallet", "wallet_create_new")
        });
        return;
      }

      // Costruisci tastiera con tutti i wallet dell'utente
      // Build keyboard with all user wallets
      const keyboard = new InlineKeyboard();
      for (const w of wallets) {
        const activeIcon = w.isActive ? "✅ " : "";
        keyboard.text(`${activeIcon}${w.name}`, `wallet_select_${w.id}`).row();
      }
      keyboard.text("🔙 Back", "action_wallet");

      await ctx.reply(
        `🔄 <b>Switch Wallet</b>

Select wallet to use:`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } catch (error) {
      console.error("Error listing wallets:", error);
      await ctx.reply("❌ Error. Please try again.");
    }
  });

  /**
   * Seleziona e attiva un wallet specifico.
   * Selects and activates a specific wallet.
   *
   * callback_data: "wallet_select_{walletId}" (regex match)
   * Aggiorna il wallet attivo nel WalletManager e nella sessione utente.
   * Updates the active wallet in WalletManager and user session.
   */
  bot.callbackQuery(/^wallet_select_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    // Estrai l'ID del wallet dal callback_data
    // Extract wallet ID from callback_data
    const walletId = ctx.callbackQuery.data.replace("wallet_select_", "");

    try {
      const walletManager = getWalletManager();
      const success = walletManager.setActiveWallet(userId, walletId);

      if (success) {
        // Aggiorna anche la sessione con il nuovo indirizzo wallet
        // Also update the session with the new wallet address
        const walletInfo = await walletManager.getWallet(userId);
        if (walletInfo) {
          const session = sessionStore.getOrCreate(userId, ctx.from?.username, ctx.from?.first_name);
          session.walletAddress = walletInfo.address;
          sessionStore.save(session);
        }
        await ctx.reply(`✅ Switched to <b>${walletInfo?.name || "wallet"}</b>`, { parse_mode: "HTML" });
        await showWallet(ctx);
      } else {
        await ctx.reply("❌ Wallet not found.");
      }
    } catch (error) {
      console.error("Error switching wallet:", error);
      await ctx.reply("❌ Error switching wallet.");
    }
  });

  /**
   * Mostra l'indirizzo di deposito del wallet (per ricevere ETH).
   * Shows the wallet deposit address (to receive ETH).
   *
   * callback_data: "wallet_deposit"
   * Usa sendSensitiveMessage() per inviare l'indirizzo in modo sicuro
   * (il messaggio puo' essere auto-cancellato dopo un timeout).
   * Uses sendSensitiveMessage() to send the address securely
   * (the message can be auto-deleted after a timeout).
   */
  bot.callbackQuery("wallet_deposit", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const walletManager = getWalletManager();
      const walletInfo = await walletManager.getWallet(userId);

      if (!walletInfo) {
        await ctx.reply("❌ Wallet not found. Create one first!");
        return;
      }

      // Invia indirizzo come messaggio sensibile (auto-cancellazione)
      // Send address as sensitive message (auto-deletion)
      await sendSensitiveMessage(
        bot,
        ctx.chat!.id,
        `💰 <b>Deposit ETH</b>

Send ETH to this address (Sepolia Testnet):

<code>${walletInfo.address}</code>

💡 <b>Current balance:</b> ${walletInfo.balanceFormatted} ETH

⚠️ Make sure to send ONLY on Sepolia network!`,
        SENSITIVITY_LEVELS.DEPOSIT_ADDRESS
      );
    } catch (error) {
      console.error("Error showing deposit:", error);
      await ctx.reply("❌ Error. Please try again.");
    }
  });

  /**
   * Avvia il flusso di prelievo ETH dal wallet custodial.
   * Starts the ETH withdrawal flow from the custodial wallet.
   *
   * callback_data: "wallet_withdraw"
   *
   * Flusso in 2 fasi gestito da messages.ts:
   * Two-phase flow handled by messages.ts:
   *
   * Fase 1: Questo handler imposta lo stato "awaiting_withdraw_address"
   *         nella sessione e chiede l'indirizzo di destinazione.
   * Phase 1: This handler sets the "awaiting_withdraw_address" state
   *          in the session and asks for the destination address.
   *
   * Fase 2: L'utente invia l'indirizzo come messaggio di testo ->
   *         messages.ts lo intercetta e chiede l'importo ->
   *         stato diventa "awaiting_withdraw_amount" ->
   *         l'utente invia l'importo -> messages.ts esegue il prelievo.
   * Phase 2: The user sends the address as a text message ->
   *          messages.ts intercepts it and asks for the amount ->
   *          state becomes "awaiting_withdraw_amount" ->
   *          the user sends the amount -> messages.ts executes the withdrawal.
   */
  bot.callbackQuery("wallet_withdraw", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const walletManager = getWalletManager();
      const walletInfo = await walletManager.getWallet(userId);

      if (!walletInfo) {
        await ctx.reply("❌ Wallet not found!");
        return;
      }

      // Verifica che ci sia saldo sufficiente per un prelievo
      // Verify there is sufficient balance for a withdrawal
      if (parseFloat(walletInfo.balanceFormatted) <= 0) {
        await ctx.reply("❌ Insufficient balance for withdrawal.");
        return;
      }

      // Imposta lo stato della sessione per attendere l'indirizzo
      // Set session state to await the destination address
      sessionStore.setState(userId, "awaiting_withdraw_address");

      await ctx.reply(
        `📤 <b>Withdraw ETH</b>

💰 Available balance: <b>${walletInfo.balanceFormatted} ETH</b>

Send the destination address:`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("Error initiating withdraw:", error);
      await ctx.reply("❌ Error. Please try again.");
    }
  });

  /**
   * Esporta la chiave privata del wallet attivo.
   * Exports the active wallet's private key.
   *
   * callback_data: "wallet_export_key"
   *
   * SICUREZZA / SECURITY:
   * - Protetto da rate limiter (exportKeyRateLimiter) per prevenire
   *   tentativi ripetuti di esportazione.
   * - Il messaggio viene inviato con spoiler tag e auto-cancellazione.
   * - Il contenuto e' protetto (forwarding disabilitato).
   *
   * - Protected by rate limiter (exportKeyRateLimiter) to prevent
   *   repeated export attempts.
   * - Message is sent with spoiler tags and auto-deletion.
   * - Content is protected (forwarding disabled).
   */
  bot.callbackQuery("wallet_export_key", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    // Controlla rate limit: previene l'esportazione ripetuta delle chiavi
    // Check rate limit: prevents repeated key exports
    const rateLimitResult = exportKeyRateLimiter.isAllowed(`export_key_${userId}`);
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil((rateLimitResult.retryAfterMs || 0) / 60000);
      await ctx.reply(`⏳ Too many export attempts. Please wait ${minutes} minute(s) before trying again.`);
      return;
    }

    try {
      const walletManager = getWalletManager();

      if (!walletManager.hasWallet(userId)) {
        await ctx.reply("❌ No wallet found!");
        return;
      }

      const privateKey = await walletManager.exportPrivateKey(userId);

      // Invia la chiave privata come messaggio sensibile con auto-cancellazione
      // Send the private key as a sensitive message with auto-deletion
      await sendSensitiveMessage(
        bot,
        ctx.chat!.id,
        `🔑 <b>PRIVATE KEY</b>

<tg-spoiler><code>${privateKey}</code></tg-spoiler>

⚠️ <b>WARNING!</b>
• NEVER share this key
• Save it in a secure offline location
• This message will be automatically deleted

🗑️ <i>Auto-delete in 30 seconds</i>`,
        SENSITIVITY_LEVELS.PRIVATE_KEY
      );
    } catch (error) {
      console.error("Error exporting key:", error);
      await ctx.reply("❌ Error exporting key.");
    }
  });

  /**
   * Esporta la seed phrase (mnemonic) del wallet attivo.
   * Exports the active wallet's seed phrase (mnemonic).
   *
   * callback_data: "wallet_export_mnemonic"
   *
   * SICUREZZA / SECURITY:
   * - Stessa protezione rate limiter dell'export chiave privata.
   * - Il messaggio si auto-cancella dopo 60 secondi.
   * - Se il wallet e' stato creato prima dell'aggiornamento mnemonic,
   *   suggerisce di usare l'export della chiave privata come alternativa.
   *
   * - Same rate limiter protection as private key export.
   * - Message auto-deletes after 60 seconds.
   * - If the wallet was created before the mnemonic update,
   *   suggests using private key export as an alternative.
   */
  bot.callbackQuery("wallet_export_mnemonic", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    // Rate limiter per prevenire abusi nell'esportazione
    // Rate limiter to prevent export abuse
    const rateLimitResult = exportKeyRateLimiter.isAllowed(`export_mnemonic_${userId}`);
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil((rateLimitResult.retryAfterMs || 0) / 60000);
      await ctx.reply(`⏳ Too many export attempts. Please wait ${minutes} minute(s) before trying again.`);
      return;
    }

    try {
      const walletManager = getWalletManager();

      if (!walletManager.hasWallet(userId)) {
        await ctx.reply("❌ No wallet found!");
        return;
      }

      const mnemonic = await walletManager.exportMnemonic(userId);

      // Wallet pre-aggiornamento: mnemonic non disponibile
      // Pre-update wallet: mnemonic not available
      if (!mnemonic) {
        await ctx.reply(
          `⚠️ <b>Seed phrase not available</b>

Your wallet was created before the update.
You can still use the private key to import into MetaMask.`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔑 Export Private Key", "wallet_export_key")
          }
        );
        return;
      }

      // Invia la seed phrase come messaggio sensibile (60s auto-delete)
      // Send the seed phrase as a sensitive message (60s auto-delete)
      await sendSensitiveMessage(
        bot,
        ctx.chat!.id,
        `🌱 <b>SEED PHRASE (12 words)</b>

<tg-spoiler><code>${mnemonic}</code></tg-spoiler>

🦊 <b>How to import into MetaMask:</b>
1. Open MetaMask → Menu → Import Account
2. Choose "Seed Phrase"
3. Enter the 12 words in exact order
4. Create a password

⚠️ <b>WARNING!</b>
• NEVER share these words
• Write them on paper, NOT digitally
• Anyone with them can steal your funds

🗑️ <i>Auto-delete in 60 seconds</i>`,
        { deleteAfterSeconds: 60, protectContent: true }
      );
    } catch (error) {
      console.error("Error exporting mnemonic:", error);
      await ctx.reply("❌ Error exporting seed phrase.");
    }
  });

}

// =============================================================================
// FUNZIONI HELPER PRIVATE
// PRIVATE HELPER FUNCTIONS
// =============================================================================

/**
 * Crea un nuovo wallet custodial per l'utente e mostra la seed phrase.
 * Creates a new custodial wallet for the user and displays the seed phrase.
 *
 * Questa funzione e' usata sia da "wallet_create" (primo wallet) che da
 * "wallet_create_new" (wallet aggiuntivi). Gestisce l'intero flusso:
 *
 * This function is used by both "wallet_create" (first wallet) and
 * "wallet_create_new" (additional wallets). It manages the entire flow:
 *
 * 1. Genera un nuovo wallet HD (12 parole mnemonic + chiave privata)
 *    Generates a new HD wallet (12-word mnemonic + private key)
 *
 * 2. Salva l'indirizzo nella sessione utente
 *    Saves the address in the user session
 *
 * 3. Mostra l'indirizzo pubblico (messaggio permanente)
 *    Shows the public address (permanent message)
 *
 * 4. Invia la seed phrase come messaggio sensibile (auto-cancellazione 60s)
 *    Sends the seed phrase as a sensitive message (auto-delete 60s)
 *
 * 5. Suggerisce i passi successivi (deposito, creazione carta)
 *    Suggests next steps (deposit, card creation)
 *
 * @param ctx - Il contesto grammY della callback query / The grammY callback query context
 * @param userId - L'ID numerico Telegram dell'utente / The user's numeric Telegram ID
 * @param name - Il nome da assegnare al wallet (es. "Wallet 1") / The name to assign to the wallet (e.g., "Wallet 1")
 */
async function createNewWallet(ctx: MyContext, userId: number, name: string) {
  const walletManager = getWalletManager();

  await ctx.reply("⏳ Creating wallet...");

  // Genera il wallet (mnemonic + chiave derivata + indirizzo)
  // Generate the wallet (mnemonic + derived key + address)
  const walletInfo = await walletManager.createWallet(userId, name);

  // Aggiorna la sessione con il nuovo indirizzo wallet
  // Update the session with the new wallet address
  const session = sessionStore.getOrCreate(userId, ctx.from?.username, ctx.from?.first_name);
  session.walletAddress = walletInfo.address;
  sessionStore.save(session);

  // Messaggio permanente con indirizzo pubblico
  // Permanent message with public address
  await ctx.reply(
    `✅ <b>${walletInfo.name} Created!</b>

📍 <b>Address:</b>
<code>${walletInfo.address}</code>

🦊 <b>MetaMask Compatible!</b>
You can import this wallet into MetaMask using the seed phrase below.`,
    { parse_mode: "HTML" }
  );

  // Messaggio sensibile con seed phrase (auto-cancellazione 60 secondi)
  // Sensitive message with seed phrase (auto-delete 60 seconds)
  await sendSensitiveMessage(
    bot,
    ctx.chat!.id,
    `🌱 <b>SEED PHRASE (12 words)</b>

<tg-spoiler><code>${walletInfo.mnemonic}</code></tg-spoiler>

⚠️ <b>EXTREMELY IMPORTANT!</b>
• Write these 12 words on paper
• DO NOT take screenshots
• DO NOT share with ANYONE
• Anyone with these words can steal your funds

🦊 <b>How to import into MetaMask:</b>
1. Open MetaMask → Import Wallet
2. Enter the 12 words in exact order
3. Create a password

🗑️ <i>Message auto-deletes in 60 seconds</i>`,
    { deleteAfterSeconds: 60, protectContent: true },
    new InlineKeyboard()
      .text("🗑️ Delete Now", "delete_this_message")
  );

  // Suggerimenti per i passi successivi
  // Suggestions for next steps
  await ctx.reply(
    `💡 <b>Next steps:</b>
1. Save the seed phrase in a secure location
2. Deposit Sepolia ETH to create cards
3. Start creating your NFT cards!`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("📥 Deposit ETH", "wallet_deposit")
        .text("🎨 Create Card", "action_create_card")
        .row()
        .text("👛 Go to Wallet", "action_wallet")
    }
  );
}
