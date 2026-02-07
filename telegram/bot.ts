// =============================================================================
// ENTRY POINT - PokeDEX Telegram Bot
// =============================================================================
//
// Questo file e' il punto di ingresso del bot PokeDEX.
// Importa e avvia il modulo di startup che orchestra l'intera
// sequenza di inizializzazione.
//
// This file is the PokeDEX bot's entry point.
// It imports and launches the startup module that orchestrates
// the entire initialization sequence.
//
// Esecuzione / Execution:
//   npx tsx telegram/bot.ts
//   oppure / or:
//   node dist/telegram/bot.js  (dopo compilazione / after compilation)
//
// Il modulo startup.ts si occupa di:
// The startup.ts module takes care of:
// 1. Inizializzare provider e contratti smart (ethers.js)
//    Initializing provider and smart contracts (ethers.js)
// 2. Inizializzare il Wallet Manager custodial (cifrato su disco)
//    Initializing the custodial Wallet Manager (encrypted on disk)
// 3. Verificare la connettivita' ai contratti on-chain
//    Verifying connectivity to on-chain contracts
// 4. Registrare le conversazioni grammY (flussi multi-step)
//    Registering grammY conversations (multi-step flows)
// 5. Registrare tutti gli handler (comandi, callback, messaggi, errori)
//    Registering all handlers (commands, callbacks, messages, errors)
// 6. Registrare i comandi nel menu "/" di Telegram
//    Registering commands in Telegram's "/" menu
// 7. Avviare il long-polling con bot.start()
//    Starting long-polling with bot.start()
//
// Struttura moduli / Module structure:
//
//   bot.ts                 <- Sei qui / You are here (entry point)
//   startup.ts             <- Avvio e registrazione / Startup and registration
//   config.ts              <- Costanti e env / Constants and env variables
//   types.ts               <- Tipi condivisi / Shared TypeScript types
//
//   contracts/
//     abis.ts              <- ABI contratti Solidity / Solidity contract ABIs
//     provider.ts          <- Provider ethers, signer, istanze contratto
//                             Ethers provider, signer, contract instances
//
//   services/
//     ipfs.ts              <- Upload immagini e metadata su IPFS / Image and metadata IPFS upload
//     marketplace.ts       <- Logica marketplace (listing, acquisto) / Marketplace logic (listing, buying)
//     deploy.ts            <- Deploy on-chain delle carte / On-chain card deployment
//     rarity.ts            <- Sistema rarita' e statistiche / Rarity and stats system
//     wallet-helpers.ts    <- Helper per recupero wallet utente / User wallet retrieval helpers
//
//   bot/
//     setup.ts             <- Istanza bot grammY e middleware / grammY bot instance and middleware
//     helpers.ts           <- Formattazione indirizzi e utilita' / Address formatting and utilities
//     menu.ts              <- Tastiera menu principale / Main menu keyboard
//     security.ts          <- Avvisi sicurezza e anti-phishing / Security and anti-phishing notices
//
//   conversations/
//     card-creation.ts     <- Flusso creazione carta (nome, immagine, stats, mint)
//                             Card creation flow (name, image, stats, mint)
//     list-card.ts         <- Flusso vendita carta da draft / Card listing from draft flow
//     list-selected-card.ts <- Flusso vendita carta pre-selezionata / Pre-selected card listing flow
//
//   handlers/
//     commands.ts          <- Handler comandi slash (/start, /help, /wallet, ecc.)
//                             Slash command handlers (/start, /help, /wallet, etc.)
//     actions.ts           <- Funzioni view condivise (showMyCards, showWallet, ecc.)
//                             Shared view functions (showMyCards, showWallet, etc.)
//     callbacks.ts         <- Handler callback query (pulsanti inline)
//                             Callback query handlers (inline buttons)
//     messages.ts          <- Handler messaggi testo (input withdraw, ecc.)
//                             Text message handlers (withdraw input, etc.)
//     errors.ts            <- Gestione errori globale (GrammyError, HttpError)
//                             Global error handling (GrammyError, HttpError)
//
//   storage/               <- Persistenza dati su disco (sessioni, draft)
//                             Disk data persistence (sessions, drafts)
//
//   wallet/                <- Gestione wallet custodial (creazione, cifratura, tx)
//                             Custodial wallet management (creation, encryption, tx)
//
// =============================================================================

import { start } from "./startup.js";

// Avvia il bot. Questa chiamata non ritorna mai in condizioni normali
// perche' bot.start() in startup.ts mantiene il processo vivo con
// il long-polling di Telegram.
//
// Start the bot. This call never returns under normal conditions
// because bot.start() in startup.ts keeps the process alive with
// Telegram long-polling.
start();
