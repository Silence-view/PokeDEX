// =============================================================================
// CONFIGURAZIONE DEL BOT - Costanti, variabili d'ambiente e parametri globali
// BOT CONFIGURATION - Constants, environment variables and global parameters
//
// Questo file centralizza tutta la configurazione del bot Telegram PokeDEX.
// Ogni costante esportata viene usata in vari moduli del bot per mantenere
// coerenza e facilitare la manutenzione. Modificando un valore qui, si
// aggiorna automaticamente ovunque venga utilizzato.
//
// This file centralizes all configuration for the PokeDEX Telegram bot.
// Every exported constant is used across various bot modules to maintain
// consistency and ease maintenance. Changing a value here automatically
// updates it everywhere it's used.
// =============================================================================

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import type { RarityStatConfig } from "./types.js";

// =============================================================================
// CARICAMENTO VARIABILI D'AMBIENTE
// LOADING ENVIRONMENT VARIABLES
//
// In ES Modules non esistono __filename e __dirname come in CommonJS,
// quindi li ricostruiamo manualmente partendo dall'URL del modulo corrente.
// Poi carichiamo il file .env che si trova nella cartella padre (PokeDEX/).
//
// In ES Modules, __filename and __dirname don't exist as they do in CommonJS,
// so we reconstruct them manually from the current module's URL.
// Then we load the .env file located in the parent folder (PokeDEX/).
// =============================================================================

// Ricostruzione del percorso del file corrente per compatibilita' ES Modules
// Reconstruct the current file path for ES Modules compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carica le variabili d'ambiente dal file .env nella root del progetto PokeDEX
// Load environment variables from the .env file in the PokeDEX project root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// =============================================================================
// TIPI POKEMON E RARITA'
// POKEMON TYPES AND RARITIES
//
// Questi array definiscono le opzioni disponibili quando un utente crea
// una nuova carta. L'indice nell'array corrisponde al valore numerico
// salvato nello smart contract (es. "Normal" = 0, "Fire" = 1, ecc.).
//
// These arrays define the options available when a user creates a new card.
// The array index corresponds to the numeric value stored in the smart
// contract (e.g. "Normal" = 0, "Fire" = 1, etc.).
// =============================================================================

/**
 * Tipi di Pokemon disponibili nel gioco, in ordine di indice contratto.
 * Available Pokemon types in the game, ordered by contract index.
 *
 * L'indice di ogni tipo (0-17) viene passato allo smart contract come
 * parametro `cardType` durante il minting. Il contratto PokeDEXCustomCards
 * usa questo valore per salvare il tipo della carta on-chain.
 *
 * Each type's index (0-17) is passed to the smart contract as the
 * `cardType` parameter during minting. The PokeDEXCustomCards contract
 * uses this value to store the card's type on-chain.
 */
export const POKEMON_TYPES = [
  "Normal", "Fire", "Water", "Electric", "Grass", "Ice",
  "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug",
  "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"
];

/**
 * Livelli di rarita' con nome, emoji e colore per la UI del bot.
 * Rarity tiers with name, emoji and color for the bot's UI.
 *
 * Ogni livello corrisponde a un indice nel contratto:
 *   0 = Common, 1 = Uncommon, 2 = Rare, 3 = Ultra Rare, 4 = Legendary
 *
 * Il colore HEX viene usato per generare immagini o embed visivi.
 * L'emoji viene mostrato nei messaggi Telegram per identificare rapidamente
 * la rarita' di una carta.
 *
 * Each tier corresponds to a contract index:
 *   0 = Common, 1 = Uncommon, 2 = Rare, 3 = Ultra Rare, 4 = Legendary
 *
 * The HEX color is used to generate images or visual embeds.
 * The emoji is displayed in Telegram messages to quickly identify
 * a card's rarity.
 */
export const RARITIES = [
  { name: "Common", emoji: "⚪", color: "#9E9E9E" },       // Comune - carta base / Common - base card
  { name: "Uncommon", emoji: "🟢", color: "#4CAF50" },     // Non comune / Uncommon
  { name: "Rare", emoji: "🔵", color: "#2196F3" },         // Rara / Rare
  { name: "Ultra Rare", emoji: "🟣", color: "#9C27B0" },   // Ultra rara / Ultra Rare
  { name: "Legendary", emoji: "🟡", color: "#FFD700" }     // Leggendaria / Legendary
];

/**
 * Mappa tipo Pokemon -> emoji per la visualizzazione nei messaggi Telegram.
 * Maps Pokemon type -> emoji for display in Telegram messages.
 *
 * Usata per rendere i messaggi del bot piu' leggibili e visivamente attraenti.
 * Ad esempio: "Fire 🔥" invece di solo "Fire".
 *
 * Used to make bot messages more readable and visually appealing.
 * For example: "Fire 🔥" instead of just "Fire".
 */
export const TYPE_EMOJIS: Record<string, string> = {
  Normal: "⬜", Fire: "🔥", Water: "💧", Electric: "⚡", Grass: "🌿",
  Ice: "❄️", Fighting: "👊", Poison: "☠️", Ground: "🌍", Flying: "🦅",
  Psychic: "🔮", Bug: "🐛", Rock: "🪨", Ghost: "👻", Dragon: "🐉",
  Dark: "🌑", Steel: "⚙️", Fairy: "🧚"
};

// =============================================================================
// INDIRIZZI DEI CONTRATTI SMART - Deployati sulla rete Sepolia
// SMART CONTRACT ADDRESSES - Deployed on the Sepolia network
//
// Gli indirizzi vengono letti dalle variabili d'ambiente (.env).
// Se non sono configurati, il bot partira' ma non potra' interagire
// con la blockchain (le funzionalita' on-chain saranno disabilitate).
//
// Addresses are read from environment variables (.env).
// If not configured, the bot will start but won't be able to interact
// with the blockchain (on-chain features will be disabled).
// =============================================================================

/**
 * Indirizzi dei contratti deployati su Sepolia.
 * Deployed contract addresses on Sepolia.
 *
 * CUSTOM_CARDS: Contratto ERC-721 per il minting e la gestione delle carte.
 *               ERC-721 contract for minting and managing cards.
 * MARKETPLACE:  Contratto per listare, comprare e vendere carte NFT.
 *               Contract for listing, buying and selling NFT cards.
 */
export const CONTRACTS = {
  CUSTOM_CARDS: process.env.CUSTOM_CARDS_ADDRESS || "",   // Indirizzo del contratto CustomCards / CustomCards contract address
  MARKETPLACE: process.env.MARKETPLACE_ADDRESS || ""      // Indirizzo del contratto Marketplace / Marketplace contract address
};

// =============================================================================
// CONFIGURAZIONE DI RETE - Parametri della blockchain Sepolia
// NETWORK CONFIGURATION - Sepolia blockchain parameters
//
// Sepolia e' una testnet Ethereum usata per lo sviluppo. L'ETH su Sepolia
// non ha valore reale e puo' essere ottenuto gratuitamente dai "faucet".
// Il chainId (11155111) identifica univocamente la rete Sepolia.
//
// Sepolia is an Ethereum testnet used for development. ETH on Sepolia
// has no real value and can be obtained for free from "faucets".
// The chainId (11155111) uniquely identifies the Sepolia network.
// =============================================================================

/**
 * Parametri della rete blockchain a cui il bot si connette.
 * Blockchain network parameters the bot connects to.
 */
export const NETWORK = {
  name: "Sepolia",                              // Nome della rete / Network name
  chainId: 11155111,                            // ID univoco della catena / Unique chain identifier
  explorer: "https://sepolia.etherscan.io"      // Block explorer per verificare transazioni / Block explorer for verifying transactions
};

// =============================================================================
// DIRECTORY E CHIAVI DI SICUREZZA
// DIRECTORIES AND SECURITY KEYS
//
// Questa sezione gestisce il percorso dove vengono salvati i wallet degli
// utenti (criptati) e le chiavi necessarie per la sicurezza del bot.
// Se le chiavi critiche mancano, il bot si rifiuta di partire per evitare
// di operare in modo insicuro.
//
// This section manages the path where user wallets are stored (encrypted)
// and the keys needed for bot security. If critical keys are missing,
// the bot refuses to start to avoid operating insecurely.
// =============================================================================

/**
 * Percorso della directory dove vengono salvati i file wallet criptati.
 * Path to the directory where encrypted wallet files are stored.
 *
 * Ogni utente Telegram che interagisce col bot ottiene un wallet Ethereum
 * creato automaticamente. La chiave privata del wallet viene criptata
 * con WALLET_MASTER_KEY e salvata come file JSON in questa directory.
 *
 * Each Telegram user who interacts with the bot gets an automatically
 * created Ethereum wallet. The wallet's private key is encrypted
 * with WALLET_MASTER_KEY and saved as a JSON file in this directory.
 */
export const WALLETS_DIR = path.resolve(__dirname, "../data/wallets");

// Verifica che la chiave master per la crittografia dei wallet sia configurata.
// Se manca, il bot non puo' operare in sicurezza e si arresta immediatamente.
// Verify that the master key for wallet encryption is configured.
// If missing, the bot cannot operate securely and shuts down immediately.
if (!process.env.WALLET_MASTER_KEY) {
  console.error("❌ CRITICAL: WALLET_MASTER_KEY environment variable is not set!");
  console.error("   This key encrypts all user wallet data. Generate a secure random key:");
  console.error("   openssl rand -hex 32");
  process.exit(1);
}

/**
 * Chiave master usata per criptare/decriptare le chiavi private dei wallet utente.
 * Master key used to encrypt/decrypt user wallet private keys.
 *
 * ATTENZIONE: Se questa chiave viene persa o cambiata, tutti i wallet
 * precedentemente criptati diventeranno inaccessibili.
 *
 * WARNING: If this key is lost or changed, all previously encrypted
 * wallets will become inaccessible.
 */
export const WALLET_MASTER_KEY = process.env.WALLET_MASTER_KEY;

/**
 * Token di autenticazione del bot Telegram (ottenuto da @BotFather).
 * Telegram bot authentication token (obtained from @BotFather).
 *
 * Questo token identifica il bot e gli permette di comunicare con le
 * API di Telegram. Senza questo token il bot non puo' funzionare.
 *
 * This token identifies the bot and allows it to communicate with
 * Telegram's APIs. Without this token the bot cannot function.
 */
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not set in .env");
  process.exit(1);
}

// =============================================================================
// CONFIGURAZIONE RARITA' - Budget di statistiche per ogni livello
// RARITY CONFIGURATION - Stat budgets for each tier
//
// Quando un utente crea una carta, le statistiche (HP, attacco, difesa,
// velocita') devono rispettare dei limiti basati sulla rarita' scelta.
// Questo previene la creazione di carte troppo forti o troppo deboli
// rispetto al loro livello di rarita'.
//
// When a user creates a card, the stats (HP, attack, defense, speed)
// must respect limits based on the chosen rarity. This prevents
// creating cards that are too strong or too weak for their rarity tier.
// =============================================================================

/**
 * Configurazione dei limiti statistici per ogni livello di rarita'.
 * Stat limit configuration for each rarity tier.
 *
 * - minStat: Valore minimo di ogni singola statistica (HP, ATK, DEF, SPD).
 *            Minimum value for any single stat (HP, ATK, DEF, SPD).
 *
 * - maxStat: Valore massimo di ogni singola statistica.
 *            Maximum value for any single stat.
 *
 * - totalStatBudget: Somma massima di tutte le statistiche insieme.
 *                    Impedisce di massimizzare tutte le stat contemporaneamente.
 *                    Maximum sum of all stats combined.
 *                    Prevents maxing out all stats simultaneously.
 *
 * Esempio: Una carta Common (indice 0) puo' avere ogni stat tra 20 e 60,
 * ma la somma totale non puo' superare 160.
 *
 * Example: A Common card (index 0) can have each stat between 20 and 60,
 * but the total sum cannot exceed 160.
 */
export const RARITY_STAT_CONFIGS: Record<number, RarityStatConfig> = {
  0: { minStat: 20, maxStat: 60, totalStatBudget: 160 },   // Common / Comune
  1: { minStat: 40, maxStat: 80, totalStatBudget: 240 },   // Uncommon / Non comune
  2: { minStat: 60, maxStat: 120, totalStatBudget: 360 },  // Rare / Rara
  3: { minStat: 80, maxStat: 180, totalStatBudget: 520 },  // Ultra Rare / Ultra rara
  4: { minStat: 120, maxStat: 255, totalStatBudget: 760 }, // Legendary / Leggendaria
};

/**
 * Pesi della formula di rarita' dinamica.
 * Dynamic rarity formula weights.
 *
 * Quando il bot calcola automaticamente la rarita' di una carta (invece
 * di lasciare scegliere all'utente), usa questi pesi per bilanciare
 * diversi fattori. La somma dei pesi e' 100 (percentuale).
 *
 * When the bot automatically calculates a card's rarity (instead of
 * letting the user choose), it uses these weights to balance different
 * factors. The weights sum to 100 (percentage).
 */
export const RARITY_WEIGHTS = {
  price: 30,      // Prezzo di mercato rispetto al floor / Market price relative to floor price
  holders: 15,    // Meno holder = piu' raro / Fewer holders = rarer
  volume: 25,     // Volume di scambio recente / Recent trading volume
  age: 10,        // Carte piu' vecchie hanno piu' valore / Older cards have more value
  creator: 20,    // Reputazione del creatore / Creator's reputation score
};

// =============================================================================
// VALIDAZIONE IMMAGINI - Limiti per le immagini delle carte
// IMAGE VALIDATION - Limits for card images
//
// Ogni carta ha un'immagine associata che viene caricata su IPFS.
// Questi limiti proteggono il sistema da file troppo grandi o formati
// non supportati che potrebbero causare problemi.
//
// Every card has an associated image that gets uploaded to IPFS.
// These limits protect the system from files that are too large or
// unsupported formats that could cause issues.
// =============================================================================

/** Dimensione massima dell'immagine in byte (5 MB) / Maximum image size in bytes (5 MB) */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB max

/**
 * Tipi MIME accettati per le immagini delle carte.
 * Accepted MIME types for card images.
 *
 * Solo questi formati vengono accettati dal bot. Il "as const" rende
 * l'array immutabile e permette a TypeScript di inferire i tipi esatti.
 *
 * Only these formats are accepted by the bot. The "as const" makes
 * the array immutable and allows TypeScript to infer exact types.
 */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

// =============================================================================
// LIMITI INPUT - Lunghezze massime per i campi testuali
// INPUT LIMITS - Maximum lengths for text fields
//
// Prevengono abusi e garantiscono che i dati salvati on-chain e su IPFS
// restino entro limiti ragionevoli. Nomi troppo lunghi costerebbero
// piu' gas e occuperebbero spazio inutile nei metadati.
//
// Prevent abuse and ensure data stored on-chain and on IPFS stays
// within reasonable limits. Names that are too long would cost more
// gas and take up unnecessary space in metadata.
// =============================================================================

/** Lunghezza massima del nome della carta / Maximum card name length */
export const MAX_NAME_LENGTH = 50;

/** Lunghezza massima della descrizione della carta / Maximum card description length */
export const MAX_DESCRIPTION_LENGTH = 500;

// =============================================================================
// GATEWAY IPFS - Servizi per accedere ai file su IPFS
// IPFS GATEWAYS - Services for accessing files on IPFS
//
// IPFS (InterPlanetary File System) e' un protocollo di storage decentralizzato.
// I file caricati su IPFS sono accessibili tramite un hash unico (CID).
// I "gateway" sono server HTTP che fanno da ponte tra il web tradizionale
// e la rete IPFS, permettendo di accedere ai file tramite un normale URL.
//
// Il bot prova piu' gateway in sequenza: se il primo non risponde,
// passa al successivo, garantendo maggiore affidabilita'.
//
// IPFS (InterPlanetary File System) is a decentralized storage protocol.
// Files uploaded to IPFS are accessible via a unique hash (CID).
// "Gateways" are HTTP servers that bridge traditional web and the IPFS
// network, allowing files to be accessed via a normal URL.
//
// The bot tries multiple gateways in sequence: if the first doesn't
// respond, it moves to the next, ensuring greater reliability.
// =============================================================================

/**
 * Lista ordinata di gateway IPFS da provare per recuperare immagini e metadati.
 * Ordered list of IPFS gateways to try for fetching images and metadata.
 *
 * Pinata e' il primo perche' e' il servizio dove il bot carica i file,
 * quindi e' il piu' probabile che li abbia gia' in cache.
 *
 * Pinata is first because it's the service where the bot uploads files,
 * so it's the most likely to already have them cached.
 */
export const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",     // Gateway Pinata (primario, usato per upload) / Pinata gateway (primary, used for uploads)
  "https://ipfs.io/ipfs/",                  // Gateway pubblico IPFS / Public IPFS gateway
  "https://cloudflare-ipfs.com/ipfs/",      // Gateway Cloudflare (veloce e affidabile) / Cloudflare gateway (fast and reliable)
  "https://dweb.link/ipfs/"                 // Gateway dweb.link (fallback) / dweb.link gateway (fallback)
];
