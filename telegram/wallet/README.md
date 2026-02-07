# Wallet

Sistema di gestione wallet custodial: creazione, crittografia AES-256-GCM, firma di transazioni e protezione dei dati sensibili per gli utenti del bot Telegram PokeDEX.

Custodial wallet management system: creation, AES-256-GCM encryption, transaction signing, and sensitive data protection for PokeDEX Telegram bot users.

## Panoramica / Overview

La directory `wallet/` implementa un sistema di wallet custodial multi-wallet. Ogni utente Telegram puo creare uno o piu wallet Ethereum gestiti interamente dal bot. Le chiavi private e le mnemonic phrase vengono crittografate con AES-256-GCM usando una chiave derivata tramite PBKDF2 (100.000 iterazioni, SHA-512). Il materiale crittografico e unico per ogni wallet grazie alla combinazione di master key, userId e walletId nella derivazione della chiave. Il sistema include rate limiting per operazioni sensibili, auto-cancellazione dei messaggi contenenti dati sensibili, scrittura atomica su disco per prevenire corruzione, e migrazione automatica dal vecchio formato single-wallet.

The `wallet/` directory implements a multi-wallet custodial wallet system. Each Telegram user can create one or more Ethereum wallets managed entirely by the bot. Private keys and mnemonic phrases are encrypted with AES-256-GCM using a key derived via PBKDF2 (100,000 iterations, SHA-512). The cryptographic material is unique per wallet thanks to the combination of master key, userId, and walletId in the key derivation. The system includes rate limiting for sensitive operations, auto-deletion of messages containing sensitive data, atomic writes to disk to prevent corruption, and automatic migration from the old single-wallet format.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `index.ts` | Barrel file che re-esporta tutti i componenti pubblici del modulo: la classe `WalletManager`, le funzioni singleton (`initializeWalletManager`, `getWalletManager`), gli helper per messaggi sensibili (`sendSensitiveMessage`, `scheduleMessageDeletion`, `SENSITIVITY_LEVELS`), la classe `RateLimiter` e le tre istanze globali di rate limiting. / Barrel file that re-exports all public module components: the `WalletManager` class, singleton functions (`initializeWalletManager`, `getWalletManager`), sensitive message helpers (`sendSensitiveMessage`, `scheduleMessageDeletion`, `SENSITIVITY_LEVELS`), the `RateLimiter` class, and the three global rate limiter instances. |
| `walletManager.ts` | Implementazione principale. Contiene: la classe `WalletManager` (creazione wallet con `ethers.Wallet.createRandom()`, crittografia/decrittografia chiavi con AES-256-GCM, derivazione chiavi con PBKDF2, gestione indice multi-wallet, firma transazioni, export chiavi/mnemonic, prelievi con stima gas, verifica integrita, rinomina, migrazione formato legacy); la classe `RateLimiter` con finestra temporale scorrevole e cleanup automatico; la funzione `atomicWriteFileSync` per scritture sicure su disco; e il sistema di messaggi auto-cancellanti con livelli di sensibilita differenziati. / Main implementation. Contains: the `WalletManager` class (wallet creation with `ethers.Wallet.createRandom()`, key encryption/decryption with AES-256-GCM, key derivation with PBKDF2, multi-wallet index management, transaction signing, key/mnemonic export, withdrawals with gas estimation, integrity verification, renaming, legacy format migration); the `RateLimiter` class with sliding time window and automatic cleanup; the `atomicWriteFileSync` function for safe disk writes; and the auto-deleting message system with differentiated sensitivity levels. |

## Flusso / Flow

### Creazione wallet / Wallet creation

1. L'utente richiede la creazione di un wallet dal bot. `WalletManager.createWallet()` viene invocato con l'ID Telegram dell'utente.
2. Se esiste un wallet nel vecchio formato single-file (`{userId}.wallet.enc` nella root della directory wallets), viene automaticamente migrato al nuovo formato multi-wallet nella directory dedicata all'utente.
3. Un nuovo wallet Ethereum viene generato con `ethers.Wallet.createRandom()`, producendo un indirizzo pubblico, una chiave privata e una mnemonic phrase di 12 parole.
4. Viene generato un salt crittografico casuale (32 byte) e un IV (16 byte). La chiave di crittografia viene derivata tramite PBKDF2 con 100.000 iterazioni di SHA-512, usando come input la stringa `"{masterKey}:{userId}:{walletId}"` concatenata al salt. Ogni wallet ha quindi una chiave di crittografia unica: compromettere un wallet non espone gli altri.
5. La chiave privata e la mnemonic vengono crittografate separatamente con AES-256-GCM, ciascuna con il proprio IV. L'authentication tag di GCM (16 byte) viene concatenato al ciphertext, garantendo sia confidenzialita che integrita dei dati (qualsiasi manomissione viene rilevata alla decrittografia).
6. Il wallet crittografato viene salvato come file `.wallet.enc` con permessi restrittivi (`0o600`, solo lettura/scrittura per il proprietario) tramite scrittura atomica (scrittura su file temporaneo + rename) per prevenire corruzione dati in caso di crash.
7. L'indice dei wallet dell'utente (`wallets.json`) viene aggiornato con ID, nome, indirizzo e timestamp. Il primo wallet creato diventa automaticamente il wallet attivo.
8. La mnemonic phrase viene restituita al chiamante (handler del bot) che la invia all'utente tramite `sendSensitiveMessage` con auto-cancellazione temporizzata.

---

1. The user requests wallet creation from the bot. `WalletManager.createWallet()` is invoked with the user's Telegram ID.
2. If a wallet exists in the old single-file format (`{userId}.wallet.enc` in the wallets root directory), it is automatically migrated to the new multi-wallet format in the user's dedicated directory.
3. A new Ethereum wallet is generated with `ethers.Wallet.createRandom()`, producing a public address, a private key, and a 12-word mnemonic phrase.
4. A random cryptographic salt (32 bytes) and IV (16 bytes) are generated. The encryption key is derived via PBKDF2 with 100,000 SHA-512 iterations, using the string `"{masterKey}:{userId}:{walletId}"` concatenated with the salt as input. Each wallet therefore has a unique encryption key: compromising one wallet does not expose others.
5. The private key and mnemonic are encrypted separately with AES-256-GCM, each with its own IV. The GCM authentication tag (16 bytes) is concatenated to the ciphertext, ensuring both data confidentiality and integrity (any tampering is detected during decryption).
6. The encrypted wallet is saved as a `.wallet.enc` file with restrictive permissions (`0o600`, owner read/write only) via atomic write (write to temp file + rename) to prevent data corruption on crash.
7. The user's wallet index (`wallets.json`) is updated with ID, name, address, and timestamp. The first wallet created automatically becomes the active wallet.
8. The mnemonic phrase is returned to the caller (bot handler) which sends it to the user via `sendSensitiveMessage` with timed auto-deletion.

### Firma transazioni / Transaction signing

1. Un servizio (ad esempio `deploy.ts` o `marketplace.ts`) richiede un signer tramite `WalletManager.getSigner(userId)`.
2. Il WalletManager carica il file crittografato del wallet attivo (o di uno specifico se `walletId` e fornito) da disco.
3. La chiave di decrittografia viene riderivata con PBKDF2 usando lo stesso salt originale salvato nel file `.wallet.enc`.
4. AES-256-GCM decrittografa la chiave privata verificando l'authentication tag. Se la verifica fallisce (dati manomessi o chiave master cambiata), viene lanciato un errore specifico di corruzione.
5. Viene creato un oggetto `ethers.Wallet` connesso al provider JSON-RPC, pronto per firmare transazioni on-chain.
6. Il timestamp `lastUsed` del wallet viene aggiornato tramite scrittura atomica.

---

1. A service (e.g., `deploy.ts` or `marketplace.ts`) requests a signer via `WalletManager.getSigner(userId)`.
2. The WalletManager loads the active wallet's encrypted file (or a specific one if `walletId` is provided) from disk.
3. The decryption key is re-derived with PBKDF2 using the original salt stored in the `.wallet.enc` file.
4. AES-256-GCM decrypts the private key while verifying the authentication tag. If verification fails (tampered data or changed master key), a specific corruption error is thrown.
5. An `ethers.Wallet` object connected to the JSON-RPC provider is created, ready to sign on-chain transactions.
6. The wallet's `lastUsed` timestamp is updated via atomic write.

### Verifica integrita / Integrity verification

`verifyWalletIntegrity(userId)` esegue un ciclo completo di decrittografia e firma di un messaggio di test per verificare che il wallet sia accessibile e funzionante. Viene usata da `deploy.ts` prima di ogni operazione di minting per prevenire transazioni fallite su wallet corrotti.

`verifyWalletIntegrity(userId)` performs a full decryption cycle and signs a test message to verify the wallet is accessible and functional. It is used by `deploy.ts` before every minting operation to prevent failed transactions on corrupted wallets.

### Rate limiting e protezione messaggi / Rate limiting and message protection

Il modulo include tre istanze globali di `RateLimiter` con configurazioni diverse:

| Rate Limiter | Tentativi max / Max attempts | Finestra / Window | Cooldown |
|---|---|---|---|
| `exportKeyRateLimiter` | 3 / minuto / 3 / minute | 60 sec | 5 min |
| `withdrawRateLimiter` | 5 / minuto / 5 / minute | 60 sec | 10 min |
| `marketplaceRateLimiter` | 10 / minuto / 10 / minute | 60 sec | 3 min |

La classe `RateLimiter` usa una finestra temporale scorrevole con cleanup automatico ogni 10 minuti per liberare le entry scadute dalla memoria.

The `RateLimiter` class uses a sliding time window with automatic cleanup every 10 minutes to free expired entries from memory.

I messaggi contenenti dati sensibili vengono inviati con `sendSensitiveMessage`, che aggiunge un pulsante "Delete Now" e programma la cancellazione automatica:

Messages containing sensitive data are sent via `sendSensitiveMessage`, which adds a "Delete Now" button and schedules automatic deletion:

| Livello / Level | Auto-cancellazione / Auto-delete | Blocco inoltro / Forward block |
|---|---|---|
| `PRIVATE_KEY` | 30 sec | Si / Yes |
| `BALANCE` | 60 sec | Si / Yes |
| `DEPOSIT_ADDRESS` | 120 sec | No |
| `TRANSACTION` | 300 sec | No |

### Struttura su disco / On-disk structure

```
data/wallets/
  {userId}/
    wallets.json              # Indice: activeWalletId + lista wallet / Index: activeWalletId + wallet list
    {walletId}.wallet.enc     # Wallet crittografato (AES-256-GCM) / Encrypted wallet (AES-256-GCM)
```

Ogni file `.wallet.enc` contiene: `id`, `name`, `address`, `encryptedPrivateKey` (ciphertext + auth tag), `encryptedMnemonic` (ciphertext + auth tag), `mnemonicIv`, `iv`, `salt`, `createdAt`, `lastUsed`.

Each `.wallet.enc` file contains: `id`, `name`, `address`, `encryptedPrivateKey` (ciphertext + auth tag), `encryptedMnemonic` (ciphertext + auth tag), `mnemonicIv`, `iv`, `salt`, `createdAt`, `lastUsed`.

### Sicurezza / Security

- Le chiavi private non esistono mai in chiaro su disco. / Private keys never exist unencrypted on disk.
- Permessi file `0o600` (solo lettura/scrittura per il proprietario). / File permissions `0o600` (owner read/write only).
- Scrittura atomica previene corruzione per crash. / Atomic writes prevent crash corruption.
- Sanitizzazione wallet ID rifiuta caratteri di path traversal. / Wallet ID sanitization rejects path traversal characters.
- AES-GCM garantisce confidenzialita e integrita (authentication tag). / AES-GCM provides confidentiality and integrity (authentication tag).
- PBKDF2 con 100.000 iterazioni rallenta attacchi brute-force. / PBKDF2 with 100,000 iterations slows brute-force attacks.
- Rate limiter bloccano tentativi rapidi di export o prelievo. / Rate limiters block rapid export or withdrawal attempts.
- Messaggi Telegram con segreti si auto-cancellano e bloccano l'inoltro. / Telegram messages with secrets auto-delete and block forwarding.
- Se la `WALLET_MASTER_KEY` cambia, tutti i wallet esistenti diventano irrecuperabili. / If the `WALLET_MASTER_KEY` changes, all existing wallets become unrecoverable.

### Pattern Singleton / Singleton pattern

```typescript
// All'avvio del bot / At bot startup
initializeWalletManager(walletsDir, masterKey, rpcUrl);

// Ovunque nel codice / Anywhere in the code
const wm = getWalletManager();
```

L'istanza viene creata una sola volta e riutilizzata in tutto il codebase tramite `getWalletManager()`. Chiamare `getWalletManager()` prima dell'inizializzazione lancia un errore.

The instance is created once and reused throughout the codebase via `getWalletManager()`. Calling `getWalletManager()` before initialization throws an error.
