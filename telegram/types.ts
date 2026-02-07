// =============================================================================
// TIPI CONDIVISI - Definizioni TypeScript usate in tutto il bot PokeDEX
// SHARED TYPES - TypeScript definitions used throughout the PokeDEX bot
//
// Questo file contiene tutte le interfacce e i tipi personalizzati che
// definiscono la struttura dei dati nel bot. TypeScript usa questi tipi
// per verificare a compile-time che i dati vengano usati correttamente,
// prevenendo errori a runtime.
//
// Le interfacce qui definite modellano:
// - Dati che arrivano dalla blockchain (CardStats, MarketplaceListing)
// - Dati interni del bot (BotSession, WalletAddressInfo)
// - Risultati di operazioni (BuyResult, DeployResult)
// - Configurazioni (RarityStatConfig)
//
// This file contains all custom interfaces and types that define
// data structures in the bot. TypeScript uses these types to verify
// at compile-time that data is used correctly, preventing runtime errors.
//
// The interfaces defined here model:
// - Data coming from the blockchain (CardStats, MarketplaceListing)
// - Bot internal data (BotSession, WalletAddressInfo)
// - Operation results (BuyResult, DeployResult)
// - Configurations (RarityStatConfig)
// =============================================================================

import { Context } from "grammy";
import { type Conversation, type ConversationFlavor } from "@grammyjs/conversations";
import { type SessionState } from "./storage/types.js";

// =============================================================================
// DATI ON-CHAIN - Strutture che rispecchiano i dati nello smart contract
// ON-CHAIN DATA - Structures that mirror data in the smart contract
// =============================================================================

/**
 * Statistiche di una carta Pokemon salvate on-chain.
 * Pokemon card stats stored on-chain.
 *
 * Questa interfaccia rispecchia la struttura restituita dalla funzione
 * `getCardStats(uint256 tokenId)` del contratto PokeDEXCustomCards.
 * I valori vengono letti direttamente dalla blockchain tramite ethers.js.
 *
 * This interface mirrors the structure returned by the
 * `getCardStats(uint256 tokenId)` function of the PokeDEXCustomCards contract.
 * Values are read directly from the blockchain via ethers.js.
 *
 * @property hp          - Punti vita della carta / Card's hit points
 * @property attack      - Potenza di attacco / Attack power
 * @property defense     - Resistenza ai danni / Damage resistance
 * @property speed       - Velocita' (determina chi attacca per primo) / Speed (determines who attacks first)
 * @property pokemonType - Indice del tipo (0-17, vedi POKEMON_TYPES in config.ts) / Type index (0-17, see POKEMON_TYPES in config.ts)
 * @property rarity      - Indice di rarita' (0-4, vedi RARITIES in config.ts) / Rarity index (0-4, see RARITIES in config.ts)
 * @property generation  - Generazione della carta (per eventuali futuri aggiornamenti) / Card generation (for possible future upgrades)
 * @property experience  - Punti esperienza accumulati / Accumulated experience points
 */
export interface CardStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  pokemonType: number;
  rarity: number;
  generation: number;
  experience: number;
}

// =============================================================================
// SESSIONE E CONTESTO DEL BOT - Gestione dello stato utente in grammY
// BOT SESSION AND CONTEXT - User state management in grammY
//
// grammY e' il framework Telegram usato da questo bot. Ogni utente che
// interagisce col bot ha una "sessione" che mantiene il suo stato
// (es. se sta creando una carta, quale step ha raggiunto, ecc.).
//
// grammY is the Telegram framework used by this bot. Every user who
// interacts with the bot has a "session" that maintains their state
// (e.g. if they're creating a card, which step they've reached, etc.).
// =============================================================================

/**
 * Sessione utente del bot (in-memory per grammY).
 * Bot user session (in-memory for grammY).
 *
 * Ogni utente Telegram che scrive al bot ha una sessione associata.
 * La sessione vive in memoria (non su disco) e viene ricreata al
 * riavvio del bot. Contiene lo stato corrente dell'utente nel flusso
 * di interazione (es. creazione carta, navigazione marketplace).
 *
 * Each Telegram user who messages the bot has an associated session.
 * The session lives in memory (not on disk) and is recreated when
 * the bot restarts. It contains the user's current state in the
 * interaction flow (e.g. card creation, marketplace browsing).
 *
 * @property telegramUserId - ID numerico dell'utente Telegram / Telegram user's numeric ID
 * @property walletAddress  - Indirizzo del wallet Ethereum dell'utente (se creato) / User's Ethereum wallet address (if created)
 * @property currentState   - Stato corrente nel flusso del bot / Current state in the bot flow
 * @property currentDraftId - ID della bozza di carta in lavorazione / ID of the card draft being worked on
 */
export interface BotSession {
  telegramUserId: number;
  walletAddress?: string;
  currentState: SessionState;
  currentDraftId?: string;
}

/**
 * Contesto personalizzato del bot con supporto sessione e conversazioni.
 * Custom bot context with session and conversation support.
 *
 * In grammY, il "Context" rappresenta un singolo aggiornamento ricevuto
 * da Telegram (messaggio, callback, ecc.). Questo tipo estende il contesto
 * base con:
 * - ConversationFlavor: permette di usare le conversazioni multi-step
 *   (dialoghi interattivi che durano piu' messaggi)
 * - session: i dati della sessione utente definiti in BotSession
 *
 * In grammY, the "Context" represents a single update received from
 * Telegram (message, callback, etc.). This type extends the base context
 * with:
 * - ConversationFlavor: enables multi-step conversations
 *   (interactive dialogs that span multiple messages)
 * - session: the user session data defined in BotSession
 */
export type MyContext = Context & ConversationFlavor<Context> & { session: BotSession };

/**
 * Tipo di conversazione del bot.
 * Bot conversation type.
 *
 * Le "conversazioni" in grammY sono flussi interattivi multi-step.
 * Ad esempio, la creazione di una carta e' una conversazione:
 * il bot chiede il nome, poi il tipo, poi le stats, ecc.
 * Ogni step attende una risposta dell'utente prima di procedere.
 *
 * "Conversations" in grammY are multi-step interactive flows.
 * For example, card creation is a conversation: the bot asks for
 * the name, then the type, then the stats, etc. Each step waits
 * for the user's response before proceeding.
 */
export type MyConversation = Conversation<MyContext>;

// =============================================================================
// DATI WALLET - Informazioni sul wallet Ethereum dell'utente
// WALLET DATA - Information about the user's Ethereum wallet
// =============================================================================

/**
 * Informazioni sul wallet dell'utente con saldo.
 * User wallet info with balance.
 *
 * Restituita quando l'utente chiede di vedere il proprio wallet.
 * Contiene sia il saldo grezzo in wei sia la versione formattata
 * in ETH (leggibile dall'utente).
 *
 * Returned when the user asks to view their wallet.
 * Contains both the raw balance in wei and the formatted version
 * in ETH (human-readable).
 *
 * @property address          - Indirizzo Ethereum (0x...) / Ethereum address (0x...)
 * @property balance          - Saldo grezzo in wei (1 ETH = 10^18 wei) / Raw balance in wei (1 ETH = 10^18 wei)
 * @property balanceFormatted - Saldo formattato in ETH (es. "0.05 ETH") / Formatted balance in ETH (e.g. "0.05 ETH")
 */
export interface WalletAddressInfo {
  address: string;
  balance: string;
  balanceFormatted: string;
}

// =============================================================================
// CONFIGURAZIONE RARITA' - Limiti per la generazione delle statistiche
// RARITY CONFIGURATION - Limits for stat generation
// =============================================================================

/**
 * Configurazione delle statistiche per livello di rarita'.
 * Stats configuration per rarity tier.
 *
 * Definisce i vincoli che le statistiche di una carta devono rispettare
 * in base alla sua rarita'. Usata durante la creazione di una carta
 * per validare che i valori inseriti dall'utente siano bilanciati.
 *
 * Defines the constraints that a card's stats must respect based on
 * its rarity. Used during card creation to validate that user-entered
 * values are balanced.
 *
 * @property minStat         - Valore minimo per ogni singola statistica / Minimum value for each individual stat
 * @property maxStat         - Valore massimo per ogni singola statistica / Maximum value for each individual stat
 * @property totalStatBudget - Budget totale: somma massima di tutte le stat / Total budget: maximum sum of all stats
 */
export interface RarityStatConfig {
  minStat: number;
  maxStat: number;
  totalStatBudget: number;
}

// =============================================================================
// DATI MARKETPLACE - Strutture per il mercato NFT
// MARKETPLACE DATA - Structures for the NFT marketplace
//
// Il marketplace permette agli utenti di vendere e comprare carte NFT.
// Un "listing" e' un'inserzione di vendita: un utente mette una carta
// in vendita a un certo prezzo, e un altro utente puo' acquistarla.
//
// The marketplace allows users to sell and buy NFT cards. A "listing"
// is a sale listing: a user puts a card up for sale at a certain price,
// and another user can purchase it.
// =============================================================================

/**
 * Listing arricchito dal marketplace con dati on-chain e metadati.
 * Enriched marketplace listing with on-chain data and metadata.
 *
 * Combina i dati della struct `Listing` del contratto Marketplace
 * con i metadati della carta (nome, descrizione, immagine, stats)
 * letti dal contratto CustomCards e da IPFS. Questa combinazione
 * permette al bot di mostrare un'anteprima completa della carta.
 *
 * Combines data from the Marketplace contract's `Listing` struct
 * with card metadata (name, description, image, stats) read from
 * the CustomCards contract and IPFS. This combination allows the
 * bot to display a complete card preview.
 *
 * @property listingId   - ID univoco del listing nel contratto / Unique listing ID in the contract
 * @property seller      - Indirizzo Ethereum del venditore / Seller's Ethereum address
 * @property nftContract - Indirizzo del contratto NFT (CustomCards) / NFT contract address (CustomCards)
 * @property tokenId     - ID del token NFT in vendita / Token ID of the NFT for sale
 * @property price       - Prezzo in wei (bigint per precisione) / Price in wei (bigint for precision)
 * @property active      - Se il listing e' ancora attivo o e' stato completato/cancellato / Whether the listing is still active or has been completed/cancelled
 * @property createdAt   - Timestamp Unix di creazione del listing / Unix timestamp of listing creation
 * @property name        - Nome della carta dai metadati IPFS (opzionale) / Card name from IPFS metadata (optional)
 * @property description - Descrizione della carta dai metadati IPFS (opzionale) / Card description from IPFS metadata (optional)
 * @property imageUrl    - URL dell'immagine della carta (opzionale) / Card image URL (optional)
 * @property stats       - Statistiche della carta lette on-chain (opzionale) / Card stats read on-chain (optional)
 */
export interface MarketplaceListing {
  listingId: number;
  seller: string;
  nftContract: string;
  tokenId: number;
  price: bigint;
  active: boolean;
  createdAt: number;
  name?: string;
  description?: string;
  imageUrl?: string;
  stats?: CardStats;
}

// =============================================================================
// RISULTATI OPERAZIONI - Strutture per i risultati delle transazioni
// OPERATION RESULTS - Structures for transaction results
//
// Le operazioni blockchain possono fallire per vari motivi (gas insufficiente,
// errore nel contratto, rete congestionata). Queste interfacce standardizzano
// il modo in cui il bot comunica il risultato all'utente.
//
// Blockchain operations can fail for various reasons (insufficient gas,
// contract error, network congestion). These interfaces standardize
// how the bot communicates the result to the user.
// =============================================================================

/**
 * Risultato di un acquisto NFT dal marketplace.
 * Result of an NFT purchase from the marketplace.
 *
 * Dopo che un utente tenta di comprare una carta, questa struttura
 * indica se la transazione e' andata a buon fine. In caso di successo
 * contiene l'hash della transazione (per verificarla su Etherscan);
 * in caso di errore contiene il messaggio di errore.
 *
 * After a user attempts to buy a card, this structure indicates
 * whether the transaction succeeded. On success it contains the
 * transaction hash (to verify on Etherscan); on failure it contains
 * the error message.
 *
 * @property success - true se la transazione e' riuscita / true if the transaction succeeded
 * @property txHash  - Hash della transazione su blockchain (solo se successo) / Transaction hash on blockchain (only on success)
 * @property error   - Messaggio di errore leggibile (solo se fallita) / Human-readable error message (only on failure)
 */
export interface BuyResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Risultato del deploy (minting) di una carta on-chain.
 * Result of deploying (minting) a card on-chain.
 *
 * Quando un utente completa la creazione di una carta e conferma il
 * minting, la transazione viene inviata al contratto CustomCards.
 * Se riesce, il tokenId indica l'ID univoco della carta appena creata
 * sulla blockchain.
 *
 * When a user completes card creation and confirms minting, the
 * transaction is sent to the CustomCards contract. On success,
 * the tokenId indicates the unique ID of the newly created card
 * on the blockchain.
 *
 * @property success - true se il minting e' riuscito / true if minting succeeded
 * @property tokenId - ID del token NFT appena creato (solo se successo) / ID of the newly minted NFT token (only on success)
 * @property txHash  - Hash della transazione di minting / Minting transaction hash
 * @property error   - Messaggio di errore (solo se fallito) / Error message (only on failure)
 */
export interface DeployResult {
  success: boolean;
  tokenId?: number;
  txHash?: string;
  error?: string;
}
