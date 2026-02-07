# handlers/

Gestione di tutti gli input dell'utente: comandi slash, pulsanti inline (callback query), messaggi di testo e errori globali del bot PokeDEX.

Handling of all user input: slash commands, inline buttons (callback queries), text messages, and global errors for the PokeDEX bot.

## Panoramica / Overview

Ogni file in questa directory registra un tipo specifico di handler grammY. Vengono registrati in ordine preciso durante il bootstrap (`startup.ts`): prima i comandi, poi le callback, poi i messaggi di testo, infine l'error handler. L'ordine e' critico perche' grammY esegue il primo handler che corrisponde a un update.

Le funzioni "show" riutilizzabili (`actions.ts`) costruiscono le schermate principali del bot e vengono chiamate sia dai comandi che dalle callback, evitando duplicazione di codice.

Each file in this directory registers a specific type of grammY handler. They are registered in precise order during bootstrap (`startup.ts`): commands first, then callbacks, then text messages, finally the error handler. Order is critical because grammY executes the first handler that matches an update.

Reusable "show" functions (`actions.ts`) build the bot's main screens and are called by both commands and callbacks, avoiding code duplication.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `commands.ts` | Registra 15+ comandi slash tramite `bot.command()`. Comandi generali: `/start` (benvenuto + menu), `/help` (guida), `/clear` (pulisce chat). Carte: `/cards` (collezione), `/card <id>` (dettagli), `/createcard` e `/create` (avvia conversazione creazione), `/mycreations` (carte create), `/drafts` (bozze). Marketplace: `/market` (homepage), `/browse` (sfoglia con paginazione), `/listings` (proprie inserzioni), `/sell` e `/list` (avvia conversazione vendita). Wallet e sicurezza: `/wallet`, `/security`, `/contracts`. / Registers 15+ slash commands via `bot.command()`. General: `/start` (welcome + menu), `/help` (guide), `/clear` (clears chat). Cards: `/cards` (collection), `/card <id>` (details), `/createcard` and `/create` (starts creation conversation), `/mycreations` (created cards), `/drafts` (drafts). Marketplace: `/market` (homepage), `/browse` (browse with pagination), `/listings` (own listings), `/sell` and `/list` (starts selling conversation). Wallet and security: `/wallet`, `/security`, `/contracts`. |
| `actions.ts` | Funzioni "show" condivise che costruiscono le schermate del bot: `showHelp()` (guida comandi), `showMyCards()` (collezione da blockchain via `tokensOfOwner`), `showCardDetails()` (stats, rarita', tipo, immagine IPFS, pulsante Sell), `showMyCreations()` (carte create via `getCreatorCards`), `showMyDrafts()` (bozze da draftStore locale), `showMarketplace()` (homepage con fee dinamica), `showMarketplaceBrowser()` (inserzioni paginate con immagini e pulsante Buy), `showMyListings()` (inserzioni attive via `getSellerListings`), `showWallet()` (lista wallet con saldi, pulsanti deposit/withdraw/export), `showContracts()` (indirizzi con link Etherscan). / Shared "show" functions that build the bot's screens: `showHelp()` (command guide), `showMyCards()` (collection from blockchain via `tokensOfOwner`), `showCardDetails()` (stats, rarity, type, IPFS image, Sell button), `showMyCreations()` (created cards via `getCreatorCards`), `showMyDrafts()` (drafts from local draftStore), `showMarketplace()` (homepage with dynamic fee), `showMarketplaceBrowser()` (paginated listings with images and Buy button), `showMyListings()` (active listings via `getSellerListings`), `showWallet()` (wallet list with balances, deposit/withdraw/export buttons), `showContracts()` (addresses with Etherscan links). |
| `callbacks.ts` | Il file piu' grande (~1400 righe). Registra tutti gli handler per callback query (pulsanti inline) tramite `bot.callbackQuery()`. 5 sezioni: (1) **Menu principale** - `action_my_cards`, `action_create_card`, `action_marketplace`, `action_wallet`, `action_contracts`, `action_security`, `action_help`, `action_clear`, `action_my_listings`, `action_my_offers`, `action_sell`, `main_menu`, `my_drafts`. (2) **Carte e mint** - `view_card_{id}` (regex), `refresh_mint_{draftId}` (regex, gestisce ciclo minting: minted/failed/pending con parsing log Transfer ERC-721). (3) **Marketplace** - `browse_market_{page}` (paginazione), `buy_listing_{id}` (conferma acquisto con verifica saldo), `confirm_buy_{id}` (esegue acquisto on-chain via `buyNFTOnChain`), `cancel_buy`, `sell_card_{id}` (avvia vendita con verifica wallet o istruzioni manuali). (4) **Wallet** - `wallet_create`, `wallet_create_new` (max 5), `wallet_switch`, `wallet_select_{id}`, `wallet_deposit`, `wallet_withdraw` (imposta stato sessione), `wallet_export_key` (con rate limiter e auto-delete), `wallet_export_mnemonic` (con rate limiter e auto-delete 60s). (5) **Utility** - `delete_this_message`. Include anche la funzione helper privata `createNewWallet()`. / The largest file (~1400 lines). Registers all callback query handlers (inline buttons) via `bot.callbackQuery()`. 5 sections: (1) **Main menu** - `action_my_cards`, `action_create_card`, `action_marketplace`, `action_wallet`, `action_contracts`, `action_security`, `action_help`, `action_clear`, `action_my_listings`, `action_my_offers`, `action_sell`, `main_menu`, `my_drafts`. (2) **Cards and mint** - `view_card_{id}` (regex), `refresh_mint_{draftId}` (regex, handles minting lifecycle: minted/failed/pending with ERC-721 Transfer log parsing). (3) **Marketplace** - `browse_market_{page}` (pagination), `buy_listing_{id}` (purchase confirmation with balance check), `confirm_buy_{id}` (executes on-chain purchase via `buyNFTOnChain`), `cancel_buy`, `sell_card_{id}` (starts selling with wallet check or manual instructions). (4) **Wallet** - `wallet_create`, `wallet_create_new` (max 5), `wallet_switch`, `wallet_select_{id}`, `wallet_deposit`, `wallet_withdraw` (sets session state), `wallet_export_key` (with rate limiter and auto-delete), `wallet_export_mnemonic` (with rate limiter and 60s auto-delete). (5) **Utility** - `delete_this_message`. Also includes private helper function `createNewWallet()`. |
| `messages.ts` | Handler per messaggi di testo (`bot.on("message:text")`). Implementa una macchina a stati per il flusso di prelievo: stato `awaiting_withdraw_address` (valida indirizzo Ethereum), stato `awaiting_withdraw_amount` (accetta numero o "max"/"all", esegue `walletManager.withdraw()` con rate limiter). Gestisce virgola come separatore decimale per utenti europei. Messaggi non riconosciuti al di fuori degli stati mostrano il menu principale. / Text message handler (`bot.on("message:text")`). Implements a state machine for the withdrawal flow: state `awaiting_withdraw_address` (validates Ethereum address), state `awaiting_withdraw_amount` (accepts number or "max"/"all", executes `walletManager.withdraw()` with rate limiter). Handles comma as decimal separator for European users. Unrecognized messages outside of states show the main menu. |
| `errors.ts` | Registra il gestore errori globale con `bot.catch()`. Classifica errori in 3 categorie: `GrammyError` (errori API Telegram), `HttpError` (errori di rete), errori sconosciuti (bug nel codice, errori ethers/IPFS). Logga sulla console senza rispondere all'utente per evitare loop di errori. / Registers the global error handler with `bot.catch()`. Classifies errors into 3 categories: `GrammyError` (Telegram API errors), `HttpError` (network errors), unknown errors (code bugs, ethers/IPFS errors). Logs to console without responding to the user to avoid error loops. |

## Flusso / Flow

```
Utente Telegram / Telegram User
  |
  |-- digita "/start"        --> commands.ts  --> showHelp()/showWallet()/etc. [actions.ts]
  |-- digita "/card 5"       --> commands.ts  --> showCardDetails(ctx, 5)      [actions.ts]
  |-- preme "My Cards"       --> callbacks.ts --> showMyCards(ctx)             [actions.ts]
  |-- preme "Buy for 0.05"   --> callbacks.ts --> confirm_buy_{id}            --> buyNFTOnChain()
  |-- preme "Withdraw"       --> callbacks.ts --> imposta stato sessione
  |-- invia "0x1234...abcd"  --> messages.ts  --> valida indirizzo, chiede importo
  |-- invia "0.01"           --> messages.ts  --> walletManager.withdraw()
  |-- errore qualsiasi       --> errors.ts    --> console.error()
```

Le funzioni `actions.ts` sono il ponte tra comandi e callback: la stessa vista (es. collezione carte) e' raggiungibile sia digitando `/cards` sia premendo il pulsante "My Cards".

The `actions.ts` functions bridge commands and callbacks: the same view (e.g., card collection) is reachable both by typing `/cards` and by pressing the "My Cards" button.
