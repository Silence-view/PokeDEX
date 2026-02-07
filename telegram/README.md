# telegram/

Modulo Telegram del bot PokeDEX: un bot grammY che permette agli utenti di creare carte Pokemon NFT, gestire un wallet custodial Ethereum e compra-vendere carte su un marketplace on-chain (Sepolia testnet).

Telegram module of the PokeDEX bot: a grammY bot that lets users create Pokemon NFT cards, manage a custodial Ethereum wallet, and buy/sell cards on an on-chain marketplace (Sepolia testnet).

## Panoramica / Overview

Il bot si avvia da `bot.ts`, che delega immediatamente a `startup.ts`. La sequenza di bootstrap inizializza provider blockchain, wallet manager, contratti smart, conversazioni grammY e tutti gli handler. Al termine, il processo resta attivo in long-polling con `bot.start()`.

The bot starts from `bot.ts`, which immediately delegates to `startup.ts`. The bootstrap sequence initializes the blockchain provider, wallet manager, smart contracts, grammY conversations, and all handlers. At the end, the process stays alive in long-polling via `bot.start()`.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `bot.ts` | Punto di ingresso: importa e chiama `start()` da startup.ts. / Entry point: imports and calls `start()` from startup.ts. |
| `startup.ts` | Sequenza di avvio in 7 passi: init contratti, wallet manager, verifica connettivita', registrazione conversazioni, handler, comandi Telegram, avvio long-polling. / 7-step boot sequence: init contracts, wallet manager, connectivity check, conversation registration, handler registration, Telegram command registration, long-polling start. |
| `config.ts` | Configurazione centralizzata: tipi Pokemon (18), livelli rarita' (5), indirizzi contratti, parametri rete Sepolia, limiti immagini/input, gateway IPFS, budget statistiche per rarita'. / Centralized configuration: Pokemon types (18), rarity tiers (5), contract addresses, Sepolia network params, image/input limits, IPFS gateways, stat budgets per rarity. |
| `types.ts` | Definizioni TypeScript condivise: `CardStats`, `BotSession`, `MyContext`, `MyConversation`, `MarketplaceListing`, `BuyResult`, `DeployResult`, `RarityStatConfig`, `WalletAddressInfo`. / Shared TypeScript definitions: `CardStats`, `BotSession`, `MyContext`, `MyConversation`, `MarketplaceListing`, `BuyResult`, `DeployResult`, `RarityStatConfig`, `WalletAddressInfo`. |

## Sottodirectory / Subdirectories

| Directory | Descrizione / Description |
|-----------|---------------------------|
| `bot/` | Istanza grammY, middleware (sessione, conversazioni, rate limiter), tastiera menu, helper di formattazione, avvisi sicurezza. / grammY instance, middleware (session, conversations, rate limiter), menu keyboard, formatting helpers, security notices. |
| `handlers/` | Handler per comandi slash, callback query (pulsanti inline), messaggi di testo e gestione errori globale. / Handlers for slash commands, callback queries (inline buttons), text messages, and global error handling. |
| `conversations/` | Flussi multi-step grammY: creazione carta, vendita carta da draft, vendita carta pre-selezionata. / grammY multi-step flows: card creation, card listing from draft, pre-selected card listing. |
| `services/` | Logica di business: upload IPFS (Pinata), deploy on-chain, marketplace (listing/acquisto), sistema rarita', helper wallet. / Business logic: IPFS upload (Pinata), on-chain deploy, marketplace (listing/buying), rarity system, wallet helpers. |
| `contracts/` | ABI dei contratti Solidity e istanze ethers.js (provider, signer, PokeDEXCustomCards, PokeDEXMarketplace). / Solidity contract ABIs and ethers.js instances (provider, signer, PokeDEXCustomCards, PokeDEXMarketplace). |
| `storage/` | Persistenza dati su disco: sessioni utente (JSON), bozze carte (draft), tipi per lo storage. / On-disk data persistence: user sessions (JSON), card drafts, storage types. |
| `wallet/` | Gestione wallet custodial: creazione, cifratura/decifratura chiavi private, seed phrase, firma transazioni, rate limiter export/withdraw. / Custodial wallet management: creation, private key encryption/decryption, seed phrase, transaction signing, export/withdraw rate limiters. |

## Flusso / Flow

```
bot.ts
  |
  v
startup.ts  -->  start()
  |
  |-- 1. initContracts()           [contracts/provider.ts]
  |-- 2. initializeWalletManager() [wallet/index.ts]
  |-- 3. Verifica contratti on-chain (totalSupply, marketplaceFee)
  |-- 4. registerConversation()    [bot/setup.ts]
  |       |-- cardCreationConversation
  |       |-- listCardConversation
  |       |-- listSelectedCardConversation
  |-- 5. Registrazione handler (ordine critico):
  |       |-- registerCommandHandlers()  [handlers/commands.ts]
  |       |-- registerCallbackHandlers() [handlers/callbacks.ts]
  |       |-- registerMessageHandlers()  [handlers/messages.ts]
  |       |-- registerErrorHandler()     [handlers/errors.ts]
  |-- 6. registerCommands() --> bot.api.setMyCommands()
  |-- 7. bot.start()  [long-polling infinito]
```

L'ordine di registrazione e' critico: i contratti devono essere inizializzati prima degli handler, le conversazioni prima degli handler che le usano, e l'error handler per ultimo.

Registration order is critical: contracts must be initialized before handlers, conversations before the handlers that use them, and the error handler last.
