# bot/

Configurazione dell'istanza grammY, middleware e utilita' condivise del bot PokeDEX Telegram.

grammY instance setup, middleware, and shared utilities for the PokeDEX Telegram bot.

## Panoramica / Overview

Questa directory contiene il nucleo tecnico del bot: l'istanza `Bot<MyContext>` di grammY con i middleware registrati nell'ordine corretto (pattern "onion"), la tastiera del menu principale, funzioni helper di formattazione e i messaggi di sicurezza anti-phishing.

This directory contains the bot's technical core: the grammY `Bot<MyContext>` instance with middleware registered in the correct order (onion pattern), the main menu keyboard, formatting helper functions, and anti-phishing security messages.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `setup.ts` | Crea l'istanza `Bot<MyContext>` con il token da config.ts. Registra 3 middleware in ordine: (1) sessione utente con `getSessionKey` basato su `ctx.from.id`, (2) plugin conversazioni grammY per flussi multi-step, (3) rate limiter anti-flood (max 3 messaggi ogni 2 secondi per utente). Esporta `registerConversation()` che wrappa le funzioni conversazione con `createConversation()`. / Creates the `Bot<MyContext>` instance with the token from config.ts. Registers 3 middleware in order: (1) user session with `getSessionKey` based on `ctx.from.id`, (2) grammY conversations plugin for multi-step flows, (3) anti-flood rate limiter (max 3 messages per 2 seconds per user). Exports `registerConversation()` which wraps conversation functions with `createConversation()`. |
| `helpers.ts` | Funzioni pure di utilita': `formatAddress()` abbrevia indirizzi Ethereum (0x1234...5678), `getEtherscanLink()` genera URL Etherscan per indirizzi e transazioni, `isValidAddress()` valida indirizzi con `ethers.isAddress()`, `formatDraftPreview()` genera un riepilogo Markdown completo di un draft (nome, tipo, rarita', stats, creatore, royalty). / Pure utility functions: `formatAddress()` shortens Ethereum addresses (0x1234...5678), `getEtherscanLink()` generates Etherscan URLs for addresses and transactions, `isValidAddress()` validates addresses with `ethers.isAddress()`, `formatDraftPreview()` generates a complete Markdown summary of a draft (name, type, rarity, stats, creator, royalty). |
| `menu.ts` | Definisce la tastiera inline del menu principale `getMainMenuKeyboard()` con 8 pulsanti su 4 righe: My Cards, Create Card, Marketplace, Wallet, Contracts, Security, Help, Clear Chat. Ogni pulsante ha un `callback_data` con prefisso `action_` gestito da `handlers/callbacks.ts`. / Defines the main menu inline keyboard `getMainMenuKeyboard()` with 8 buttons on 4 rows: My Cards, Create Card, Marketplace, Wallet, Contracts, Security, Help, Clear Chat. Each button has a `callback_data` prefixed with `action_` handled by `handlers/callbacks.ts`. |
| `security.ts` | Costanti stringa per avvisi di sicurezza: `SECURITY_NOTICE` (cosa il bot non chiede mai, come funzionano le transazioni, avvisi anti-scam) e `ANTI_PHISHING_WARNING` (4 passi di verifica prima di interagire con contratti). Mostrati tramite /security e il pulsante Security del menu. / String constants for security notices: `SECURITY_NOTICE` (what the bot never asks for, how transactions work, anti-scam warnings) and `ANTI_PHISHING_WARNING` (4 verification steps before interacting with contracts). Displayed via /security and the menu Security button. |

## Flusso / Flow

```
startup.ts
  |
  v
setup.ts  -->  bot = new Bot<MyContext>(BOT_TOKEN)
  |
  |-- bot.use(session({...}))         -- Sessione per utente (chiave: ctx.from.id)
  |-- bot.use(conversations())        -- Plugin conversazioni multi-step
  |-- bot.use(limit({...}))           -- Rate limiter: 3 msg / 2 sec
  |
  v
registerConversation(fn)              -- Registra ogni conversazione come middleware
  |
  v
[handlers usano bot.command(), bot.callbackQuery(), bot.on() per registrare handler]
  |
  v
bot.start()                           -- Long-polling infinito
```

L'ordine dei middleware e' essenziale: la sessione deve essere disponibile prima delle conversazioni, e le conversazioni devono essere registrate prima degli handler che chiamano `ctx.conversation.enter()`.

Middleware order is essential: session must be available before conversations, and conversations must be registered before handlers that call `ctx.conversation.enter()`.
