# Services

Questo modulo contiene la logica di business del bot Telegram PokeDEX: upload su IPFS, interazione con il marketplace, calcolo della rarita e minting on-chain delle carte NFT.

This module contains the PokeDEX Telegram bot's business logic: IPFS uploads, marketplace interaction, rarity calculation, and on-chain NFT card minting.

## Panoramica / Overview

La directory `services/` separa la logica di business dagli handler Telegram. Ogni servizio incapsula un dominio specifico (storage decentralizzato, marketplace, generazione stats, deploy on-chain, accesso wallet) e viene chiamato dagli handler e dalle conversazioni del bot. Nessun servizio interagisce direttamente con l'utente Telegram: ricevono dati gia validati e restituiscono risultati strutturati.

The `services/` directory separates business logic from Telegram handlers. Each service encapsulates a specific domain (decentralized storage, marketplace, stats generation, on-chain deploy, wallet access) and is called by the bot's handlers and conversations. No service interacts directly with the Telegram user: they receive pre-validated data and return structured results.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `ipfs.ts` | Gestisce il caricamento di immagini e metadati JSON su IPFS tramite Pinata. Include validazione delle immagini via magic bytes, download da Telegram, costruzione dei metadati ERC-721, conversione URL `ipfs://` in HTTPS via gateway, e sanitizzazione anti-XSS di tutti gli input utente. / Handles image and JSON metadata uploads to IPFS via Pinata. Includes image validation via magic bytes, download from Telegram, ERC-721 metadata construction, `ipfs://` to HTTPS URL conversion via gateway, and anti-XSS sanitization of all user inputs. |
| `marketplace.ts` | Interagisce con lo smart contract del marketplace per recuperare listing arricchiti (dati on-chain + stats + metadati IPFS), paginazione dei listing attivi, e acquisto di NFT. L'acquisto include rate limiting, verifica saldo e firma della transazione con il wallet custodial dell'utente. / Interacts with the marketplace smart contract to fetch enriched listings (on-chain data + stats + IPFS metadata), paginate active listings, and purchase NFTs. Purchasing includes rate limiting, balance checks, and transaction signing with the user's custodial wallet. |
| `rarity.ts` | Implementa la generazione bilanciata delle statistiche (HP, Attack, Defense, Speed) tramite un sistema a budget di punti per livello di rarita, e il calcolo della rarita dinamica basato su metriche di mercato (prezzo, volume, trasferimenti, eta, reputazione del creatore) con punteggio pesato 0-100. / Implements balanced stats generation (HP, Attack, Defense, Speed) through a point-budget system per rarity tier, and dynamic rarity calculation based on market metrics (price, volume, transfers, age, creator reputation) with a weighted 0-100 score. |
| `wallet-helpers.ts` | Funzioni di utilita per accedere rapidamente all'indirizzo e al saldo del wallet custodial dell'utente. Astrae il WalletManager con un'interfaccia semplice e un pattern "fail gracefully" (restituisce `null` in caso di errore). / Utility functions for quick access to the user's custodial wallet address and balance. Abstracts the WalletManager with a simple interface and a "fail gracefully" pattern (returns `null` on error). |
| `deploy.ts` | Gestisce il minting on-chain di carte custom. Verifica l'integrita del wallet, legge la minting fee dal contratto, invia la transazione `createCard()` allo smart contract PokeDEXCustomCards, attende la conferma e parsa il tokenId dai log dell'evento ERC-721 Transfer. / Handles on-chain minting of custom cards. Verifies wallet integrity, reads the minting fee from the contract, sends the `createCard()` transaction to the PokeDEXCustomCards smart contract, waits for confirmation, and parses the tokenId from ERC-721 Transfer event logs. |

## Flusso / Flow

### Creazione carta (minting) / Card creation (minting)

1. L'utente invia una foto al bot Telegram. Il bot scarica l'immagine dai server Telegram (`ipfs.ts` -> `downloadPhotoFromTelegram`).
2. L'immagine viene validata controllando i magic bytes per verificare il formato reale (JPEG, PNG, GIF, WebP) e la dimensione massima (`ipfs.ts` -> `validateImageBuffer`, `detectImageType`).
3. L'immagine validata viene caricata su IPFS tramite Pinata (`ipfs.ts` -> `uploadImageToPinata`) e si ottiene un CID.
4. Le statistiche della carta vengono generate in base alla rarita scelta, distribuendo un budget di punti tra HP, Attack, Defense e Speed (`rarity.ts` -> `generateStatsForRarity`).
5. I metadati NFT (standard ERC-721) vengono costruiti con nome sanitizzato, descrizione, link all'immagine IPFS e attributi della carta (`ipfs.ts` -> `buildNFTMetadata`), poi caricati su IPFS (`ipfs.ts` -> `uploadMetadataToPinata`).
6. La transazione di minting viene inviata alla blockchain: verifica wallet, controllo fondi, chiamata `createCard()` con stats e metadataURI, attesa conferma e parsing del tokenId (`deploy.ts` -> `deployCardOnChain`).

---

1. The user sends a photo to the Telegram bot. The bot downloads the image from Telegram servers (`ipfs.ts` -> `downloadPhotoFromTelegram`).
2. The image is validated by checking magic bytes to verify the actual format (JPEG, PNG, GIF, WebP) and maximum size (`ipfs.ts` -> `validateImageBuffer`, `detectImageType`).
3. The validated image is uploaded to IPFS via Pinata (`ipfs.ts` -> `uploadImageToPinata`) and a CID is obtained.
4. Card stats are generated based on the chosen rarity, distributing a point budget among HP, Attack, Defense, and Speed (`rarity.ts` -> `generateStatsForRarity`).
5. NFT metadata (ERC-721 standard) is built with a sanitized name, description, IPFS image link, and card attributes (`ipfs.ts` -> `buildNFTMetadata`), then uploaded to IPFS (`ipfs.ts` -> `uploadMetadataToPinata`).
6. The minting transaction is sent to the blockchain: wallet verification, funds check, `createCard()` call with stats and metadataURI, confirmation wait, and tokenId parsing (`deploy.ts` -> `deployCardOnChain`).

### Acquisto dal marketplace / Marketplace purchase

1. Il bot recupera i listing attivi iterando al contrario dal piu recente, arricchendo ogni listing con stats on-chain e metadati IPFS (`marketplace.ts` -> `getActiveListings`, `getEnrichedListing`).
2. L'utente seleziona una carta. Il bot verifica il rate limit, il wallet custodial e il saldo disponibile.
3. La transazione `buyNFT()` viene inviata al contratto marketplace con il valore ETH corrispondente al prezzo, firmata con il signer dell'utente (`marketplace.ts` -> `buyNFTOnChain`).
4. Dopo la conferma on-chain, il bot restituisce l'hash della transazione come prova d'acquisto.

---

1. The bot fetches active listings by iterating backwards from the most recent, enriching each listing with on-chain stats and IPFS metadata (`marketplace.ts` -> `getActiveListings`, `getEnrichedListing`).
2. The user selects a card. The bot checks the rate limit, custodial wallet, and available balance.
3. The `buyNFT()` transaction is sent to the marketplace contract with the ETH value matching the price, signed with the user's signer (`marketplace.ts` -> `buyNFTOnChain`).
4. After on-chain confirmation, the bot returns the transaction hash as proof of purchase.

### Rarita dinamica / Dynamic rarity

Il punteggio di rarita dinamica (0-100) combina cinque componenti pesate: prezzo rispetto al floor (30%), volume scambiato in scala logaritmica (25%), reputazione del creatore (20%), provenienza/trasferimenti (15%), e eta della carta con bonus genesis (10%). Il punteggio viene poi convertito in un livello discreto (Common, Uncommon, Rare, Ultra Rare, Legendary) tramite soglie non uniformi (`rarity.ts` -> `calculateDynamicRarityScore`, `scoreToRarityTier`).

The dynamic rarity score (0-100) combines five weighted components: price relative to floor (30%), traded volume on logarithmic scale (25%), creator reputation (20%), provenance/transfers (15%), and card age with genesis bonus (10%). The score is then converted into a discrete tier (Common, Uncommon, Rare, Ultra Rare, Legendary) via non-uniform thresholds (`rarity.ts` -> `calculateDynamicRarityScore`, `scoreToRarityTier`).
