# conversations/

Flussi multi-step del bot PokeDEX implementati con il plugin conversazioni di grammY. Gestiscono i processi complessi che richiedono piu' input dall'utente: creazione carta NFT e vendita sul marketplace.

Multi-step flows of the PokeDEX bot implemented with the grammY conversations plugin. They handle complex processes that require multiple user inputs: NFT card creation and marketplace listing.

## Panoramica / Overview

Le conversazioni grammY permettono di scrivere flussi interattivi come funzioni async lineari. Ogni chiamata a `conversation.wait()` congela la funzione e attende il prossimo messaggio dell'utente. Internamente grammY usa un sistema di "replay": riesegue la funzione dall'inizio ma salta i wait gia' risolti. Le conversazioni vengono registrate come middleware in `startup.ts` tramite `registerConversation()` e avviate con `ctx.conversation.enter("nomeFunzione")`.

grammY conversations allow writing interactive flows as linear async functions. Each call to `conversation.wait()` freezes the function and waits for the user's next message. Internally grammY uses a "replay" system: it re-executes the function from the beginning but skips already-resolved waits. Conversations are registered as middleware in `startup.ts` via `registerConversation()` and started with `ctx.conversation.enter("functionName")`.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `card-creation.ts` | Flusso completo di creazione carta NFT in 4 step. **Step 1 - Immagine:** l'utente viene indirizzato a pokecardmaker.net, crea la carta, fa screenshot e la invia come foto. Il bot valida dimensione (max 5MB) e salva il `file_id` Telegram in un draft. **Step 2 - Nome:** l'utente digita il nome (max 50 caratteri, sanitizzato contro injection). **Step 3 - Rarita':** pulsanti inline per scegliere tra 5 livelli (Common, Uncommon, Rare, Ultra Rare, Legendary). Le statistiche (HP, ATK, DEF, SPD) vengono generate automaticamente con `generateStatsForRarity()` in base alla rarita'. Tipo Pokemon assegnato casualmente (0-17). Royalty fissata al 5%. **Step 4 - Deploy:** sotto-step 1/3 scarica immagine da Telegram e upload su IPFS (Pinata); sotto-step 2/3 costruisce metadati ERC-721 e upload su IPFS; sotto-step 3/3 chiama `deployCardOnChain()` per mint dell'NFT tramite il contratto PokeDEXCustomCards. In caso di errore, il draft viene salvato e recuperabile con /drafts. / Complete NFT card creation flow in 4 steps. **Step 1 - Image:** user is directed to pokecardmaker.net, creates the card, screenshots it and sends it as a photo. Bot validates size (max 5MB) and saves the Telegram `file_id` in a draft. **Step 2 - Name:** user types the name (max 50 chars, sanitized against injection). **Step 3 - Rarity:** inline buttons to choose from 5 tiers (Common, Uncommon, Rare, Ultra Rare, Legendary). Stats (HP, ATK, DEF, SPD) are auto-generated with `generateStatsForRarity()` based on rarity. Pokemon type assigned randomly (0-17). Royalty fixed at 5%. **Step 4 - Deploy:** sub-step 1/3 downloads image from Telegram and uploads to IPFS (Pinata); sub-step 2/3 builds ERC-721 metadata and uploads to IPFS; sub-step 3/3 calls `deployCardOnChain()` to mint the NFT via the PokeDEXCustomCards contract. On error, the draft is saved and recoverable with /drafts. |
| `list-card.ts` | Flusso di vendita carta partendo dal draftStore locale. Filtra i draft con status "minted" e tokenId valido. L'utente seleziona una carta (max 5 mostrate), il bot verifica ownership on-chain con `ownerOf()`, controlla ban status e recupera immagine aggiornata da IPFS. L'utente inserisce il prezzo in ETH (validato in loop, range 0-1000). Dopo conferma, il bot esegue 2 transazioni on-chain: (1) `setApprovalForAll()` se il marketplace non e' gia' approvato, (2) `listNFT()` sul contratto PokeDEXMarketplace con prezzo in Wei e URI immagine. Il listing ID viene estratto dall'evento `NFTListed` nei log della transazione. / Card selling flow starting from the local draftStore. Filters drafts with "minted" status and valid tokenId. User selects a card (max 5 shown), bot verifies on-chain ownership with `ownerOf()`, checks ban status, and retrieves updated image from IPFS. User enters price in ETH (validated in a loop, range 0-1000). After confirmation, bot executes 2 on-chain transactions: (1) `setApprovalForAll()` if marketplace is not already approved, (2) `listNFT()` on the PokeDEXMarketplace contract with price in Wei and image URI. The listing ID is extracted from the `NFTListed` event in the transaction logs. |
| `list-selected-card.ts` | Flusso di vendita per una carta pre-selezionata dal menu "My Cards". Recupera il tokenId da `session.pendingCardSell` (one-time use, cancellato subito). A differenza di `list-card.ts`, carica tutti i dati direttamente dalla blockchain: `ownerOf()` per ownership, poi `getCardStats()`, `isBanned()` e `tokenURI()` in parallelo con `Promise.all()`. Recupera nome e immagine da metadati IPFS. Il resto del flusso e' analogo: input prezzo (supporta virgola come separatore decimale per utenti europei), conferma, approval + listing on-chain. Ri-verifica ownership e integrita' wallet prima delle transazioni finali. / Selling flow for a card pre-selected from the "My Cards" menu. Retrieves tokenId from `session.pendingCardSell` (one-time use, deleted immediately). Unlike `list-card.ts`, loads all data directly from the blockchain: `ownerOf()` for ownership, then `getCardStats()`, `isBanned()`, and `tokenURI()` in parallel via `Promise.all()`. Retrieves name and image from IPFS metadata. The rest of the flow is analogous: price input (supports comma as decimal separator for European users), confirmation, approval + on-chain listing. Re-verifies ownership and wallet integrity before final transactions. |

## Flusso / Flow

### Creazione carta / Card creation (`cardCreationConversation`)

```
ctx.conversation.enter("cardCreationConversation")
  |
  |-- Verifica wallet (esiste? integro?)
  |-- Crea draft nel draftStore
  |
  |-- STEP 1: Invia link pokecardmaker.net
  |           conversation.wait() --> riceve foto
  |           Salva file_id nel draft
  |
  |-- STEP 2: Chiede nome carta
  |           conversation.wait() --> riceve testo
  |           sanitizeCardName() + salva nel draft
  |
  |-- STEP 3: Mostra pulsanti rarita'
  |           conversation.waitForCallbackQuery(/rarity_\d/)
  |           generateStatsForRarity() + tipo casuale
  |
  |-- STEP 4: Deploy
  |     |-- 1/3: downloadPhotoFromTelegram() --> uploadImageToPinata()
  |     |-- 2/3: buildNFTMetadata() --> uploadMetadataToPinata()
  |     |-- 3/3: deployCardOnChain() --> mint NFT
  |     |
  |     |--> Successo: draft.status = "minted", mostra txHash + tokenId
  |     |--> Errore: draft.status = "failed", recuperabile con /drafts
```

### Vendita carta / Card listing (`listCardConversation` / `listSelectedCardConversation`)

```
ctx.conversation.enter("listCardConversation")        [da draft]
ctx.conversation.enter("listSelectedCardConversation") [da My Cards]
  |
  |-- Rate limit check
  |-- Verifica wallet e contratti
  |-- Selezione carta (da draft / da sessione)
  |-- Verifica ownership on-chain: ownerOf()
  |-- Verifica ban status: isBanned()
  |
  |-- Input prezzo ETH (loop validazione, supporta virgola)
  |-- Conferma con riepilogo
  |
  |-- TX 1/2: setApprovalForAll() [se non gia' approvato]
  |-- TX 2/2: listNFT(nftContract, tokenId, priceWei, imageURI)
  |     |
  |     |--> Parsing evento NFTListed per listing ID
  |     |--> Successo: mostra listingId + link Etherscan
  |     |--> Errore: mostra errore + menu principale
```

Le due transazioni sono necessarie perche' lo standard ERC-721 richiede un'approvazione esplicita prima che un contratto esterno (il marketplace) possa trasferire un NFT.

The two transactions are needed because the ERC-721 standard requires explicit approval before an external contract (the marketplace) can transfer an NFT.
