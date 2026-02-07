// =============================================================================
// HANDLER ERRORI GLOBALE - Cattura e gestione errori del bot
// GLOBAL ERROR HANDLER - Bot error catching and handling
// =============================================================================
//
// Questo modulo registra il gestore di errori globale del bot usando
// bot.catch(). Qualsiasi errore non gestito da un handler specifico
// viene catturato qui e loggato nella console.
//
// This module registers the bot's global error handler using bot.catch().
// Any error not handled by a specific handler is caught here and logged
// to the console.
//
// TIPI DI ERRORE grammY / grammY ERROR TYPES:
//
// grammY distingue tre categorie di errori:
// grammY distinguishes three categories of errors:
//
// 1. GrammyError
//    Errori restituiti dall'API di Telegram (es. messaggio troppo lungo,
//    chat non trovata, permessi insufficienti, rate limit superato).
//    Contiene un campo "description" con il messaggio di errore di Telegram.
//
//    Errors returned by the Telegram API (e.g., message too long,
//    chat not found, insufficient permissions, rate limit exceeded).
//    Contains a "description" field with Telegram's error message.
//
// 2. HttpError
//    Errori di rete che impediscono la comunicazione con i server Telegram
//    (es. timeout, DNS failure, connessione rifiutata).
//    Questi errori indicano problemi di infrastruttura, non logici.
//
//    Network errors that prevent communication with Telegram servers
//    (e.g., timeout, DNS failure, connection refused).
//    These errors indicate infrastructure problems, not logical ones.
//
// 3. Errori sconosciuti (qualsiasi altro Error/eccezione)
//    Bug nel codice del bot, errori ethers.js, errori IPFS, ecc.
//    Questi sono i piu' importanti da investigare perche' indicano
//    problemi nel codice dell'applicazione.
//
//    Unknown errors (any other Error/exception)
//    Bugs in bot code, ethers.js errors, IPFS errors, etc.
//    These are the most important to investigate because they indicate
//    problems in the application code.
//
// NOTA: Questo handler NON risponde all'utente per evitare loop di errori
// (rispondere potrebbe generare un altro errore se il problema e'
// nella connessione Telegram).
//
// NOTE: This handler does NOT respond to the user to avoid error loops
// (responding could generate another error if the problem is in
// the Telegram connection).
//
// =============================================================================

import { GrammyError, HttpError } from "grammy";
import { bot } from "../bot/setup.js";

// =============================================================================
// REGISTRAZIONE ERROR HANDLER
// ERROR HANDLER REGISTRATION
// =============================================================================

/**
 * Registra il gestore di errori globale per il bot.
 * Registers the global error handler for the bot.
 *
 * Chiamato una volta durante l'avvio del bot (da startup.ts).
 * bot.catch() intercetta qualsiasi errore non gestito che si verifica
 * durante l'elaborazione di un update di Telegram.
 *
 * Called once during bot startup (from startup.ts).
 * bot.catch() intercepts any unhandled error that occurs during
 * the processing of a Telegram update.
 *
 * L'oggetto errore (err) contiene:
 * The error object (err) contains:
 * - err.ctx: il contesto grammY dell'update che ha causato l'errore
 *            the grammY context of the update that caused the error
 * - err.error: l'errore effettivo (GrammyError | HttpError | Error)
 *              the actual error (GrammyError | HttpError | Error)
 *
 * In produzione, si potrebbe estendere questo handler per:
 * In production, this handler could be extended to:
 * - Inviare notifiche a Sentry/DataDog/PagerDuty
 *   Send notifications to Sentry/DataDog/PagerDuty
 * - Salvare gli errori in un database per analisi
 *   Save errors to a database for analysis
 * - Rispondere all'utente con un messaggio generico (con cautela)
 *   Respond to the user with a generic message (with caution)
 */
export function registerErrorHandler() {
  bot.catch((err) => {
    // Recupera il contesto dell'update che ha generato l'errore
    // Retrieve the context of the update that generated the error
    const ctx = err.ctx;
    console.error(`Error for update ${ctx.update.update_id}:`);
    const e = err.error;

    if (e instanceof GrammyError) {
      // Errore API Telegram (es. "Bad Request: message is too long")
      // Telegram API error (e.g., "Bad Request: message is too long")
      console.error("Grammy error:", e.description);
    } else if (e instanceof HttpError) {
      // Errore di rete (es. timeout, connessione rifiutata)
      // Network error (e.g., timeout, connection refused)
      console.error("HTTP error:", e);
    } else {
      // Errore sconosciuto (bug nel codice, errori ethers/IPFS, ecc.)
      // Unknown error (code bug, ethers/IPFS errors, etc.)
      console.error("Unknown error:", e);
    }
  });
}
