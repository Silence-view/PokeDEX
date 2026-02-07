// =============================================================================
// HANDLER MESSAGGI TESTO - Gestione input utente (withdraw, etc.)
// TEXT MESSAGE HANDLERS - User text input handling (withdraw, etc.)
// =============================================================================
//
// Questo modulo gestisce i messaggi di testo inviati dall'utente al bot.
// A differenza dei comandi (/) e delle callback query (pulsanti), i messaggi
// di testo vengono usati per raccogliere input libero dall'utente, come
// indirizzi Ethereum e importi per il prelievo.
//
// This module handles text messages sent by the user to the bot.
// Unlike commands (/) and callback queries (buttons), text messages
// are used to collect free-form input from the user, such as
// Ethereum addresses and amounts for withdrawal.
//
// ARCHITETTURA DEGLI STATI (State Machine):
// STATE ARCHITECTURE (State Machine):
//
// Il flusso di prelievo (withdraw) usa un pattern a macchina a stati
// gestito dalla sessione utente (sessionStore). Lo stato corrente
// determina come interpretare il messaggio di testo ricevuto.
//
// The withdrawal flow uses a state machine pattern managed by the
// user session (sessionStore). The current state determines how to
// interpret the received text message.
//
// Stati / States:
//
//   "idle" (default)
//     -> L'utente non sta facendo nulla di speciale.
//        I messaggi non riconosciuti mostrano il menu.
//     -> The user is not doing anything special.
//        Unrecognized messages show the menu.
//
//   "awaiting_withdraw_address"
//     -> Il bot aspetta un indirizzo Ethereum valido (0x..., 42 caratteri).
//        Se valido, passa allo stato successivo.
//     -> The bot expects a valid Ethereum address (0x..., 42 chars).
//        If valid, transitions to the next state.
//
//   "awaiting_withdraw_amount"
//     -> Il bot aspetta un importo in ETH (numero o "max"/"all").
//        Esegue il prelievo e torna a "idle".
//     -> The bot expects an ETH amount (number or "max"/"all").
//        Executes the withdrawal and returns to "idle".
//
// Diagramma / Diagram:
//
//   [wallet_withdraw button]
//        |
//        v
//   awaiting_withdraw_address  ---(indirizzo valido)---> awaiting_withdraw_amount
//        |                                                    |
//        | (indirizzo invalido)                              | (importo valido)
//        v                                                    v
//   (chiede di nuovo)                                    [esegue tx] -> idle
//
// =============================================================================

import { sessionStore } from "../storage/index.js";
import { NETWORK } from "../config.js";
import { isValidAddress } from "../bot/helpers.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import { bot } from "../bot/setup.js";
import {
  getWalletManager,
  sendSensitiveMessage,
  SENSITIVITY_LEVELS,
  withdrawRateLimiter,
} from "../wallet/index.js";

// =============================================================================
// REGISTRAZIONE MESSAGE HANDLERS - Funzione principale di setup
// MESSAGE HANDLER REGISTRATION - Main setup function
// =============================================================================

/**
 * Registra l'handler per i messaggi di testo del bot.
 * Registers the text message handler for the bot.
 *
 * Questo handler usa bot.on("message:text") che intercetta TUTTI i messaggi
 * di testo ricevuti dal bot. I comandi slash (/) vengono gestiti separatamente
 * da commands.ts, quindi qui gestiamo solo gli input utente liberi.
 *
 * This handler uses bot.on("message:text") which intercepts ALL text
 * messages received by the bot. Slash commands (/) are handled separately
 * by commands.ts, so here we only handle free-form user input.
 *
 * NOTA SUL RATE LIMITER / RATE LIMITER NOTE:
 * Il prelievo e' protetto da withdrawRateLimiter che limita il numero
 * di tentativi di prelievo per utente in un intervallo di tempo.
 * Questo previene abusi e protegge i fondi degli utenti.
 *
 * Withdrawal is protected by withdrawRateLimiter which limits the number
 * of withdrawal attempts per user within a time window.
 * This prevents abuse and protects user funds.
 */
export function registerMessageHandlers() {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from?.id;

    if (!userId) return;

    // Recupera la sessione corrente dell'utente (contiene lo stato)
    // Retrieve the user's current session (contains the state)
    const session = sessionStore.get(userId);

    // =========================================================================
    // FASE 1 PRELIEVO: Ricezione indirizzo di destinazione
    // WITHDRAWAL PHASE 1: Receiving destination address
    // =========================================================================
    //
    // L'utente ha premuto "wallet_withdraw" e il bot aspetta un indirizzo.
    // Valida il formato dell'indirizzo Ethereum (0x + 40 hex chars).
    // Se valido, lo salva in sessione e chiede l'importo.
    //
    // The user pressed "wallet_withdraw" and the bot expects an address.
    // Validates the Ethereum address format (0x + 40 hex chars).
    // If valid, saves it in session and asks for the amount.
    // =========================================================================
    if (session?.currentState === "awaiting_withdraw_address") {
      if (isValidAddress(text)) {
        // Indirizzo valido: salva e passa alla fase 2
        // Valid address: save and move to phase 2
        session.pendingWithdrawAddress = text;
        session.currentState = "awaiting_withdraw_amount";
        sessionStore.save(session);

        try {
          // Recupera il saldo attuale per mostrarlo all'utente
          // Retrieve current balance to show the user
          const walletManager = getWalletManager();
          const walletInfo = await walletManager.getWallet(userId);
          const maxAmount = walletInfo?.balanceFormatted || "0";

          await ctx.reply(
            `📤 <b>Withdraw to:</b>
<code>${text}</code>

💰 Available balance: <b>${maxAmount} ETH</b>

Enter the amount to withdraw (in ETH):
<i>E.g.: 0.01 or "max" for all</i>`,
            { parse_mode: "HTML" }
          );
        } catch {
          // In caso di errore, resetta lo stato a idle
          // On error, reset state to idle
          await ctx.reply("❌ Error. Please try again.");
          sessionStore.setState(userId, "idle");
        }
      } else {
        // Indirizzo invalido: chiedi di nuovo senza cambiare stato
        // Invalid address: ask again without changing state
        await ctx.reply("❌ Invalid address.\n\nMust start with 0x and be 42 characters.");
      }
      return;
    }

    // =========================================================================
    // FASE 2 PRELIEVO: Ricezione importo e esecuzione transazione
    // WITHDRAWAL PHASE 2: Receiving amount and executing transaction
    // =========================================================================
    //
    // L'utente ha inserito un indirizzo valido nella fase 1.
    // Ora aspettiamo un importo numerico o "max"/"all".
    //
    // The user entered a valid address in phase 1.
    // Now we expect a numeric amount or "max"/"all".
    //
    // "max" / "all": preleva l'intero saldo meno una stima del gas
    //                (0.0005 ETH) per coprire le fee della transazione.
    // "max" / "all": withdraws the entire balance minus a gas estimate
    //                (0.0005 ETH) to cover transaction fees.
    // =========================================================================
    if (session?.currentState === "awaiting_withdraw_amount") {
      // Controlla rate limit: previene prelievi ripetuti troppo rapidi
      // Check rate limit: prevents repeated withdrawals too quickly
      const rateLimitResult = withdrawRateLimiter.isAllowed(`withdraw_${userId}`);
      if (!rateLimitResult.allowed) {
        const minutes = Math.ceil((rateLimitResult.retryAfterMs || 0) / 60000);
        sessionStore.setState(userId, "idle");
        await ctx.reply(`⏳ Too many withdrawal attempts. Please wait ${minutes} minute(s) before trying again.`);
        return;
      }

      // Recupera l'indirizzo salvato nella fase 1
      // Retrieve the address saved in phase 1
      const toAddress = session.pendingWithdrawAddress;
      if (!toAddress) {
        // Sessione scaduta o corrotta: resetta e chiedi di ricominciare
        // Session expired or corrupted: reset and ask to restart
        sessionStore.setState(userId, "idle");
        await ctx.reply("❌ Session expired. Please try again from /wallet");
        return;
      }

      try {
        const walletManager = getWalletManager();
        const walletInfo = await walletManager.getWallet(userId);

        if (!walletInfo) {
          sessionStore.setState(userId, "idle");
          await ctx.reply("❌ Wallet not found.");
          return;
        }

        // Calcola l'importo da prelevare
        // Calculate the amount to withdraw
        let amount: string;
        if (text.toLowerCase() === "max" || text.toLowerCase() === "all") {
          // "max"/"all": saldo totale meno stima gas (0.0005 ETH)
          // "max"/"all": total balance minus gas estimate (0.0005 ETH)
          const balance = parseFloat(walletInfo.balanceFormatted);
          const gasEstimate = 0.0005;
          amount = Math.max(0, balance - gasEstimate).toFixed(6);
        } else {
          // Importo numerico: sostituisci virgola con punto per i formati europei
          // Numeric amount: replace comma with dot for European formats
          amount = text.replace(",", ".");
          if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            await ctx.reply("❌ Invalid amount. Enter a positive number.");
            return;
          }
        }

        // Pulisci lo stato della sessione prima di eseguire la transazione
        // Clean up session state before executing the transaction
        session.pendingWithdrawAddress = undefined;
        session.currentState = "idle";
        sessionStore.save(session);

        await ctx.reply("⏳ Sending transaction...");

        // Esegui il prelievo on-chain (firma e invia la transazione)
        // Execute the on-chain withdrawal (sign and send the transaction)
        const tx = await walletManager.withdraw(userId, toAddress, amount);

        // Invia conferma come messaggio sensibile (contiene txHash)
        // Send confirmation as sensitive message (contains txHash)
        await sendSensitiveMessage(
          bot,
          ctx.chat!.id,
          `✅ <b>Withdrawal Sent!</b>

💰 <b>Amount:</b> ${amount} ETH
📤 <b>To:</b> <code>${toAddress}</code>
📜 <b>TX:</b> <code>${tx.hash}</code>

<a href="${NETWORK.explorer}/tx/${tx.hash}">View on Etherscan</a>`,
          SENSITIVITY_LEVELS.TRANSACTION
        );
      } catch (error: any) {
        // Resetta lo stato in caso di errore
        // Reset state on error
        sessionStore.setState(userId, "idle");
        console.error("Withdrawal error:", error);

        // Mostra errori "sicuri" direttamente all'utente, nascondendo quelli tecnici
        // Show "safe" errors directly to the user, hiding technical ones
        const safeErrors = ["Insufficient balance", "invalid address", "gas"];
        const isSafeError = safeErrors.some(e => error.message?.toLowerCase().includes(e.toLowerCase()));
        await ctx.reply(isSafeError ? `❌ ${error.message}` : "❌ Withdrawal failed. Please try again later.");
      }
      return;
    }

    // =========================================================================
    // FALLBACK: Messaggio non riconosciuto
    // FALLBACK: Unrecognized message
    // =========================================================================
    //
    // Se il messaggio non inizia con "/" (non e' un comando) e non siamo
    // in nessuno stato speciale, mostra il menu principale.
    // I comandi slash vengono gestiti da commands.ts e non arrivano qui.
    //
    // If the message doesn't start with "/" (not a command) and we're not
    // in any special state, show the main menu.
    // Slash commands are handled by commands.ts and don't reach here.
    // =========================================================================
    if (!text.startsWith("/")) {
      await ctx.reply("🤔 I didn't understand. Use the menu or /help for commands.", {
        reply_markup: getMainMenuKeyboard()
      });
    }
  });
}
