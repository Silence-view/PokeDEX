import { ethers } from "ethers";
import { POKEMON_TYPES, RARITIES, TYPE_EMOJIS, NETWORK } from "../config.js";
import type { CardDraft } from "../storage/types.js";

// =============================================================================
// FUNZIONI HELPER - Formattazione e utilita' generali per il bot
// HELPER FUNCTIONS - Formatting and general utilities for the bot
//
// Questo file contiene funzioni di utilita' riutilizzabili in tutto il progetto.
// Sono funzioni pure (senza side effects) che si occupano di:
// - Formattazione di indirizzi Ethereum per visualizzazione leggibile
// - Generazione di link all'explorer blockchain (Etherscan)
// - Validazione di indirizzi Ethereum
// - Formattazione dell'anteprima delle carte (draft) per i messaggi Telegram
//
// This file contains reusable utility functions throughout the project.
// These are pure functions (no side effects) that handle:
// - Formatting Ethereum addresses for readable display
// - Generating blockchain explorer links (Etherscan)
// - Validating Ethereum addresses
// - Formatting card draft previews for Telegram messages
// =============================================================================

// =============================================================================
// FORMATTAZIONE INDIRIZZO - Abbreviazione per visualizzazione
// ADDRESS FORMATTING - Abbreviation for display
// =============================================================================

/**
 * Formatta un indirizzo Ethereum abbreviato per la visualizzazione.
 * Formats a shortened Ethereum address for display purposes.
 *
 * Gli indirizzi Ethereum sono lunghi 42 caratteri (es: 0x1234...abcd).
 * Per la leggibilita' nei messaggi Telegram, mostriamo solo i primi 6
 * e gli ultimi 4 caratteri, collegati da "...".
 *
 * Ethereum addresses are 42 characters long (e.g., 0x1234...abcd).
 * For readability in Telegram messages, we show only the first 6
 * and last 4 characters, connected by "...".
 *
 * @param address - L'indirizzo Ethereum completo (42 caratteri con prefisso 0x).
 *                  The full Ethereum address (42 characters with 0x prefix).
 * @returns L'indirizzo abbreviato (es: "0x1234...abcd").
 *          The abbreviated address (e.g., "0x1234...abcd").
 *
 * @example
 * formatAddress("0x1234567890abcdef1234567890abcdef12345678")
 * // => "0x1234...5678"
 */
export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// =============================================================================
// LINK ETHERSCAN - Generazione URL per l'explorer blockchain
// ETHERSCAN LINK - Blockchain explorer URL generation
// =============================================================================

/**
 * Restituisce il link Etherscan per un indirizzo o una transazione.
 * Returns the Etherscan link for an address or transaction.
 *
 * Etherscan e' il block explorer piu' usato per le chain EVM. Permette
 * di verificare transazioni, controllare saldi e ispezionare smart contract.
 * Il link viene costruito usando l'URL dell'explorer configurato per la
 * rete corrente (mainnet, testnet, etc.).
 *
 * Etherscan is the most used block explorer for EVM chains. It allows
 * verifying transactions, checking balances, and inspecting smart contracts.
 * The link is built using the explorer URL configured for the current
 * network (mainnet, testnet, etc.).
 *
 * @param type - Tipo di risorsa: "address" per wallet/contratti, "tx" per transazioni.
 *               Resource type: "address" for wallets/contracts, "tx" for transactions.
 * @param value - L'indirizzo o l'hash della transazione.
 *                The address or transaction hash.
 * @returns L'URL completo dell'explorer (es: "https://etherscan.io/tx/0x...").
 *          The full explorer URL (e.g., "https://etherscan.io/tx/0x...").
 *
 * @example
 * getEtherscanLink("tx", "0xabc123...")
 * // => "https://etherscan.io/tx/0xabc123..."
 *
 * getEtherscanLink("address", "0x1234...")
 * // => "https://etherscan.io/address/0x1234..."
 */
export function getEtherscanLink(type: "address" | "tx", value: string): string {
  return `${NETWORK.explorer}/${type}/${value}`;
}

// =============================================================================
// VALIDAZIONE INDIRIZZO - Controllo formato indirizzo Ethereum
// ADDRESS VALIDATION - Ethereum address format check
// =============================================================================

/**
 * Verifica se una stringa e' un indirizzo Ethereum valido.
 * Checks if a string is a valid Ethereum address.
 *
 * Usa ethers.isAddress() che verifica:
 * - Il formato esadecimale corretto (0x + 40 caratteri hex)
 * - La validita' del checksum EIP-55 (se l'indirizzo e' in mixed case)
 *
 * Uses ethers.isAddress() which verifies:
 * - Correct hexadecimal format (0x + 40 hex characters)
 * - EIP-55 checksum validity (if the address is in mixed case)
 *
 * Questa funzione e' utile per validare input dell'utente prima di
 * eseguire operazioni on-chain che fallirebbero con indirizzi non validi.
 *
 * This function is useful for validating user input before performing
 * on-chain operations that would fail with invalid addresses.
 *
 * @param address - La stringa da verificare.
 *                  The string to verify.
 * @returns true se l'indirizzo e' valido, false altrimenti.
 *          true if the address is valid, false otherwise.
 *
 * @example
 * isValidAddress("0x1234567890abcdef1234567890abcdef12345678") // => true
 * isValidAddress("not-an-address") // => false
 * isValidAddress("0xinvalid") // => false
 */
export function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

// =============================================================================
// TEMPO RELATIVO - Formattazione "time ago" per timestamp Unix
// RELATIVE TIME - "Time ago" formatting for Unix timestamps
// =============================================================================

/**
 * Formatta un timestamp Unix come tempo relativo leggibile.
 * Formats a Unix timestamp as a human-readable relative time.
 *
 * Converte la differenza tra il timestamp e il momento attuale in una
 * stringa compatta: "just now", "5m ago", "2h ago", "3d ago", "1w ago".
 *
 * Converts the difference between the timestamp and the current time
 * into a compact string: "just now", "5m ago", "2h ago", "3d ago", "1w ago".
 *
 * @param unixTimestamp - Timestamp Unix in secondi / Unix timestamp in seconds
 * @returns Stringa con tempo relativo / Relative time string
 *
 * @example
 * formatTimeAgo(Math.floor(Date.now() / 1000) - 3600) // => "1h ago"
 */
export function formatTimeAgo(unixTimestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - unixTimestamp;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

// =============================================================================
// ANTEPRIMA DRAFT - Formattazione completa di una bozza di carta
// DRAFT PREVIEW - Full formatting of a card draft
// =============================================================================

/**
 * Formatta l'anteprima completa di un draft (bozza) di carta per i messaggi Telegram.
 * Formats the full preview of a card draft for Telegram messages.
 *
 * Questa funzione genera una stringa Markdown formattata che mostra tutte
 * le informazioni di una carta in fase di creazione. Viene usata per
 * mostrare all'utente un riepilogo della carta prima del deploy on-chain.
 *
 * This function generates a formatted Markdown string showing all
 * information of a card being created. It is used to show the user
 * a summary of the card before on-chain deployment.
 *
 * Il preview include / The preview includes:
 * - Nome della carta / Card name
 * - Tipo Pokemon (Fuoco, Acqua, etc.) con emoji corrispondente
 *   Pokemon type (Fire, Water, etc.) with corresponding emoji
 * - Rarita' (Common, Uncommon, Rare, Ultra Rare, Legendary) con emoji
 *   Rarity (Common, Uncommon, Rare, Ultra Rare, Legendary) with emoji
 * - Statistiche di combattimento: HP, Attacco, Difesa, Velocita'
 *   Combat stats: HP, Attack, Defense, Speed
 * - Descrizione opzionale / Optional description
 * - Informazioni creatore: nome, username Telegram, percentuale royalty
 *   Creator info: name, Telegram username, royalty percentage
 *
 * La royalty e' espressa in "basis points" (bps): 500 = 5.0%.
 * Royalty is expressed in "basis points" (bps): 500 = 5.0%.
 * Dividiamo per 100 per ottenere la percentuale leggibile.
 * We divide by 100 to get the human-readable percentage.
 *
 * @param draft - L'oggetto CardDraft con tutti i dati della bozza.
 *                The CardDraft object with all draft data.
 * @returns La stringa Markdown formattata per Telegram.
 *          The Markdown-formatted string for Telegram.
 */
export function formatDraftPreview(draft: CardDraft): string {
  const type = POKEMON_TYPES[draft.stats.pokemonType] || "Normal";
  const rarity = RARITIES[draft.stats.rarity] || RARITIES[0];
  const typeEmoji = TYPE_EMOJIS[type] || "⬜";

  return `
🎨 *CARD PREVIEW*
━━━━━━━━━━━━━━━━━━

📛 *Name:* ${draft.cardName || "Not set"}
${typeEmoji} *Type:* ${type}
${rarity.emoji} *Rarity:* ${rarity.name}

*Stats:*
❤️ HP: ${draft.stats.hp}
⚔️ Attack: ${draft.stats.attack}
🛡️ Defense: ${draft.stats.defense}
💨 Speed: ${draft.stats.speed}

📝 *Description:* ${draft.description || "None"}

👤 *Creator:* ${draft.creatorName}
📱 *Telegram:* @${draft.telegramUsername || "N/A"}
💰 *Royalty:* ${draft.royaltyPercentage / 100}%

━━━━━━━━━━━━━━━━━━
`;
}
