// =============================================================================
// HELPER WALLET - Accesso rapido alle info del wallet utente
// WALLET HELPERS - Quick access to user wallet info
// =============================================================================
//
// Questo modulo fornisce funzioni di utilità per accedere rapidamente alle
// informazioni del wallet custodial dell'utente. Astrae la complessità del
// WalletManager offrendo un'interfaccia semplice per gli handler del bot.
//
// This module provides utility functions for quick access to the user's
// custodial wallet information. It abstracts the WalletManager complexity
// by offering a simple interface for the bot's handlers.
//
// CONCETTO CHIAVE: WALLET CUSTODIAL
// KEY CONCEPT: CUSTODIAL WALLET
//
// Un "wallet custodial" è un portafoglio blockchain creato e gestito dal sistema
// (il bot) per conto dell'utente. A differenza di un wallet "self-custodial"
// (come MetaMask), dove l'utente gestisce la propria chiave privata e la seed
// phrase, nel modello custodial il sistema detiene le chiavi.
//
// A "custodial wallet" is a blockchain wallet created and managed by the system
// (the bot) on behalf of the user. Unlike a "self-custodial" wallet (like
// MetaMask), where the user manages their own private key and seed phrase,
// in the custodial model the system holds the keys.
//
// Vantaggi del modello custodial / Advantages of the custodial model:
//   - L'utente non deve capire chiavi private, seed phrases o gas fees
//   - Esperienza utente semplificata (basta un click per comprare/vendere)
//   - Nessun rischio di perdere la seed phrase
//   - User doesn't need to understand private keys, seed phrases or gas fees
//   - Simplified user experience (one click to buy/sell)
//   - No risk of losing the seed phrase
//
// Svantaggi / Disadvantages:
//   - L'utente deve fidarsi del sistema per custodire i suoi fondi
//   - Se il sistema viene compromesso, tutti i wallet sono a rischio
//   - L'utente non ha il pieno controllo dei propri asset
//   - User must trust the system to custody their funds
//   - If the system is compromised, all wallets are at risk
//   - User doesn't have full control of their assets
//
// Ogni utente Telegram è identificato da un ID numerico univoco (userId).
// Il WalletManager associa questo ID a un wallet Ethereum (indirizzo + chiave
// privata crittografata). Le funzioni in questo modulo usano il userId per
// recuperare le informazioni del wallet corrispondente.
//
// Each Telegram user is identified by a unique numeric ID (userId).
// The WalletManager maps this ID to an Ethereum wallet (address + encrypted
// private key). Functions in this module use the userId to retrieve the
// corresponding wallet information.
// =============================================================================

import { getWalletManager } from "../wallet/index.js";
import type { WalletAddressInfo } from "../types.js";

// =============================================================================
// RECUPERO INDIRIZZO WALLET
// WALLET ADDRESS RETRIEVAL
// =============================================================================
//
// L'indirizzo Ethereum (es. 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18) è
// l'identificatore pubblico del wallet sulla blockchain. È come un IBAN: puoi
// condividerlo liberamente per ricevere pagamenti, ma non permette a nessuno
// di spendere i tuoi fondi (per quello serve la chiave privata).
//
// The Ethereum address (e.g. 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18) is
// the public identifier of the wallet on the blockchain. It's like an IBAN:
// you can share it freely to receive payments, but it doesn't allow anyone
// to spend your funds (the private key is needed for that).
// =============================================================================

/**
 * Ottiene l'indirizzo del wallet custodial dell'utente.
 * Gets the user's custodial wallet address.
 *
 * Questa è la funzione più semplice per verificare se un utente ha un wallet
 * e ottenere il suo indirizzo pubblico. Viene usata in molti punti del bot:
 *   - Per verificare se l'utente può creare carte (serve un wallet)
 *   - Per mostrare l'indirizzo quando l'utente chiede "qual è il mio wallet?"
 *   - Per controllare la proprietà di NFT specifici sulla blockchain
 *
 * This is the simplest function to check if a user has a wallet and get their
 * public address. It's used in many parts of the bot:
 *   - To verify if the user can create cards (a wallet is needed)
 *   - To show the address when the user asks "what's my wallet?"
 *   - To check ownership of specific NFTs on the blockchain
 *
 * L'approccio try/catch con return null implementa il pattern "fail gracefully":
 * se qualcosa va storto (wallet corrotto, errore di decriptazione), restituiamo
 * null invece di far crashare il bot. Il chiamante può controllare il valore
 * null e mostrare un messaggio appropriato all'utente.
 *
 * The try/catch with return null approach implements the "fail gracefully" pattern:
 * if something goes wrong (corrupted wallet, decryption error), we return null
 * instead of crashing the bot. The caller can check for null and show an
 * appropriate message to the user.
 *
 * @param userId - L'ID numerico univoco dell'utente Telegram / The unique numeric Telegram user ID
 * @returns L'indirizzo Ethereum del wallet (es. "0x742d..."), o null se l'utente
 *          non ha un wallet o si è verificato un errore /
 *          The wallet's Ethereum address (e.g. "0x742d..."), or null if the user
 *          doesn't have a wallet or an error occurred
 */
export async function getUserWalletAddress(userId: number): Promise<string | null> {
  try {
    const walletManager = getWalletManager();

    // hasWallet() è un controllo rapido in-memory (non va sulla blockchain)
    // hasWallet() is a quick in-memory check (doesn't go to the blockchain)
    if (walletManager.hasWallet(userId)) {
      // getWallet() recupera e decripta le informazioni del wallet
      // getWallet() retrieves and decrypts the wallet information
      const walletInfo = await walletManager.getWallet(userId);
      if (walletInfo?.address) {
        return walletInfo.address;
      }
    }
  } catch (error) {
    // Logga l'errore per il debug ma non far crashare il bot
    // Log the error for debugging but don't crash the bot
    console.error("Error checking custodial wallet:", error);
  }

  // Nessun wallet trovato o errore durante il recupero
  // No wallet found or error during retrieval
  return null;
}

// =============================================================================
// RECUPERO WALLET CON SALDO
// WALLET RETRIEVAL WITH BALANCE
// =============================================================================
//
// Oltre all'indirizzo, spesso abbiamo bisogno anche del saldo del wallet.
// Il saldo è la quantità di ETH disponibile per transazioni (minting, acquisti).
// Questa funzione combina indirizzo e saldo in un'unica chiamata, evitando
// query multiple alla blockchain.
//
// Besides the address, we often need the wallet balance too. The balance is the
// amount of ETH available for transactions (minting, purchases). This function
// combines address and balance in a single call, avoiding multiple blockchain
// queries.
//
// Il saldo viene restituito sia come valore numerico grezzo (balance in wei)
// che come stringa formattata (balanceFormatted in ETH). Wei è la più piccola
// unità di Ethereum: 1 ETH = 1,000,000,000,000,000,000 wei (10^18).
//
// The balance is returned both as a raw numeric value (balance in wei) and as
// a formatted string (balanceFormatted in ETH). Wei is the smallest Ethereum
// unit: 1 ETH = 1,000,000,000,000,000,000 wei (10^18).
// =============================================================================

/**
 * Ottiene indirizzo e saldo del wallet custodial dell'utente.
 * Gets the user's custodial wallet address with balance info.
 *
 * Usata principalmente per:
 *   - Mostrare il saldo nel menu wallet del bot ("Hai 0.05 ETH disponibili")
 *   - Verificare se l'utente ha fondi sufficienti prima di un'operazione
 *   - Mostrare indirizzo + saldo nella schermata informativa del wallet
 *
 * Primarily used for:
 *   - Showing the balance in the bot's wallet menu ("You have 0.05 ETH available")
 *   - Checking if the user has sufficient funds before an operation
 *   - Showing address + balance in the wallet info screen
 *
 * Il WalletManager internamente interroga la blockchain per il saldo corrente
 * ogni volta che getWallet() viene chiamato, garantendo che il dato sia aggiornato.
 * Questo significa che ogni chiamata a questa funzione comporta una query RPC
 * al nodo blockchain — è leggermente più lenta di getUserWalletAddress() che
 * potrebbe non necessitare di una query blockchain se il saldo non è richiesto.
 *
 * The WalletManager internally queries the blockchain for the current balance
 * each time getWallet() is called, ensuring the data is up-to-date. This means
 * each call to this function involves an RPC query to the blockchain node —
 * it's slightly slower than getUserWalletAddress() which might not need a
 * blockchain query if the balance isn't needed.
 *
 * @param userId - L'ID numerico univoco dell'utente Telegram / The unique numeric Telegram user ID
 * @returns Oggetto con indirizzo, saldo grezzo e saldo formattato, o null /
 *          Object with address, raw balance and formatted balance, or null
 */
export async function getUserWalletWithBalance(userId: number): Promise<WalletAddressInfo | null> {
  try {
    const walletManager = getWalletManager();

    // Controllo rapido in-memory: l'utente ha mai creato un wallet?
    // Quick in-memory check: has the user ever created a wallet?
    if (walletManager.hasWallet(userId)) {
      // Recupera informazioni complete del wallet (include query blockchain per il saldo)
      // Retrieve complete wallet information (includes blockchain query for balance)
      const walletInfo = await walletManager.getWallet(userId);
      if (walletInfo?.address) {
        return {
          address: walletInfo.address,             // Indirizzo pubblico Ethereum / Public Ethereum address
          balance: walletInfo.balance,              // Saldo grezzo in wei (BigInt) / Raw balance in wei (BigInt)
          balanceFormatted: walletInfo.balanceFormatted  // Saldo leggibile in ETH (es. "0.05") / Human-readable balance in ETH (e.g. "0.05")
        };
      }
    }
  } catch (error) {
    // Fail gracefully — non bloccare il bot per un errore del wallet
    // Fail gracefully — don't block the bot for a wallet error
    console.error("Error checking custodial wallet:", error);
  }

  // Nessun wallet trovato o errore — il chiamante gestirà il caso null
  // No wallet found or error — the caller will handle the null case
  return null;
}
