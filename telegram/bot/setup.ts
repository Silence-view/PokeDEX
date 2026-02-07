// =============================================================================
// SETUP BOT - Inizializzazione istanza bot e middleware
// BOT SETUP - Bot instance initialization and middleware
//
// Questo file configura l'istanza principale del bot Telegram usando il
// framework grammY. I middleware vengono registrati nell'ordine corretto:
// sessione -> conversazioni -> rate limiter. L'ordine e' importante perche'
// grammY processa i middleware in sequenza (pattern "onion" / a cipolla).
//
// This file configures the main Telegram bot instance using the grammY
// framework. Middleware is registered in the correct order:
// session -> conversations -> rate limiter. Order matters because grammY
// processes middleware sequentially (onion pattern).
//
// Dipendenze chiave / Key dependencies:
// - grammy: Framework principale per bot Telegram / Main Telegram bot framework
// - @grammyjs/conversations: Plugin per flussi multi-step / Multi-step flow plugin
// - @grammyjs/ratelimiter: Protezione anti-flood / Anti-flood protection
// =============================================================================

import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { limit } from "@grammyjs/ratelimiter";
import { BOT_TOKEN } from "../config.js";
import type { MyContext, BotSession } from "../types.js";

// =============================================================================
// ISTANZA BOT - Creazione con tipo di contesto personalizzato
// BOT INSTANCE - Creation with custom context type
//
// MyContext estende il contesto base di grammY aggiungendo supporto per
// sessioni e conversazioni. Il BOT_TOKEN e' il token univoco ottenuto
// da @BotFather su Telegram che identifica questo bot.
//
// MyContext extends grammY's base context adding support for sessions
// and conversations. BOT_TOKEN is the unique token obtained from
// @BotFather on Telegram that identifies this bot.
// =============================================================================

export const bot = new Bot<MyContext>(BOT_TOKEN!);

// =============================================================================
// MIDDLEWARE SESSIONE - Persistenza dati utente tra messaggi
// SESSION MIDDLEWARE - User data persistence across messages
//
// Le sessioni in grammY permettono di salvare dati per ogni utente tra
// un messaggio e l'altro. Senza sessioni, ogni messaggio sarebbe
// completamente isolato e il bot non ricorderebbe nulla.
//
// grammY sessions allow saving data for each user between messages.
// Without sessions, every message would be completely isolated and
// the bot would not remember anything.
//
// - initial(): Definisce lo stato iniziale della sessione per nuovi utenti.
//              Defines the initial session state for new users.
// - getSessionKey(): Usa l'ID Telegram dell'utente come chiave univoca.
//                    Uses the user's Telegram ID as a unique key.
//                    Ogni utente ha la propria sessione separata.
//                    Each user has their own separate session.
// =============================================================================

bot.use(session({
  initial: (): BotSession => ({
    telegramUserId: 0,
    currentState: "idle"
  }),
  getSessionKey: (ctx) => ctx.from?.id.toString()
}));

// =============================================================================
// MIDDLEWARE CONVERSAZIONI - Supporto per flussi interattivi multi-step
// CONVERSATIONS MIDDLEWARE - Support for multi-step interactive flows
//
// Il plugin "conversations" di grammY permette di scrivere flussi interattivi
// come se fossero funzioni normali (usando async/await), anche se in realta'
// ogni "await conversation.wait()" mette in pausa la funzione fino al
// prossimo messaggio dell'utente. Internamente, il plugin serializza lo stato
// della conversazione e lo ripristina quando arriva un nuovo messaggio.
//
// grammY's "conversations" plugin allows writing interactive flows as if they
// were normal functions (using async/await), even though each
// "await conversation.wait()" actually pauses the function until the user's
// next message. Internally, the plugin serializes the conversation state
// and restores it when a new message arrives.
//
// Questo e' essenziale per flussi come la creazione di carte (immagine ->
// nome -> rarita' -> deploy) dove servono piu' input dall'utente.
//
// This is essential for flows like card creation (image -> name -> rarity ->
// deploy) where multiple user inputs are needed.
// =============================================================================

bot.use(conversations());

// =============================================================================
// RATE LIMITER - Protezione contro messaggi eccessivi (anti-flood)
// RATE LIMITER - Protection against excessive messages (anti-flood)
//
// Limita il numero di messaggi che un utente puo' inviare in un dato
// intervallo di tempo. Questo protegge il bot da:
// - Utenti che inviano troppi messaggi accidentalmente
// - Tentativi di attacco flood/DoS
// - Sovraccarico delle API blockchain (ogni messaggio potrebbe generare
//   una transazione on-chain)
//
// Limits the number of messages a user can send in a given time frame.
// This protects the bot from:
// - Users accidentally sending too many messages
// - Flood/DoS attack attempts
// - Blockchain API overload (each message could generate an on-chain
//   transaction)
//
// Configurazione / Configuration:
// - timeFrame: 2000ms (2 secondi / 2 seconds) - finestra temporale
// - limit: 3 - massimo 3 messaggi per finestra / max 3 messages per window
// - onLimitExceeded: messaggio di avviso all'utente / warning message to user
// =============================================================================

bot.use(limit({
  timeFrame: 2000,
  limit: 3,
  onLimitExceeded: async (ctx) => {
    await ctx.reply("⚠️ Too many messages. Please wait a few seconds.");
  }
}));

// =============================================================================
// REGISTRAZIONE CONVERSAZIONI - Helper per aggiungere conversazioni al bot
// CONVERSATION REGISTRATION - Helper to add conversations to the bot
//
// Questa funzione wrapper semplifica la registrazione di nuove conversazioni.
// Ogni conversazione deve essere registrata come middleware prima di poter
// essere avviata tramite ctx.conversation.enter("nomeConversazione").
//
// This wrapper function simplifies registering new conversations.
// Each conversation must be registered as middleware before it can be
// started via ctx.conversation.enter("conversationName").
// =============================================================================

/**
 * Registra una conversazione nel bot come middleware grammY.
 * Registers a conversation in the bot as grammY middleware.
 *
 * La funzione conversazione viene wrappata da createConversation() che
 * gestisce automaticamente la serializzazione/deserializzazione dello
 * stato e il replay dei messaggi precedenti.
 *
 * The conversation function is wrapped by createConversation() which
 * automatically handles state serialization/deserialization and replay
 * of previous messages.
 *
 * @param conversationFn - La funzione conversazione da registrare.
 *                         The conversation function to register.
 *                         Deve accettare (conversation, ctx) come parametri.
 *                         Must accept (conversation, ctx) as parameters.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerConversation(conversationFn: any) {
  bot.use(createConversation(conversationFn));
}
