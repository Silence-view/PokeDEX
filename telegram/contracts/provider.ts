// =============================================================================
// PROVIDER E ISTANZE CONTRATTI - Connessione alla blockchain e servizi esterni
// PROVIDER AND CONTRACT INSTANCES - Blockchain connection and external services
//
// Questo file crea e gestisce la connessione alla rete Ethereum Sepolia
// e le istanze dei contratti smart con cui il bot interagisce. Gestisce
// anche la connessione a Pinata per il caricamento dei file su IPFS.
//
// ARCHITETTURA DELLA CONNESSIONE / CONNECTION ARCHITECTURE
//
// Il bot interagisce con la blockchain a due livelli:
//
// 1. LETTURA (provider): Usa un "provider" JSON-RPC per leggere dati
//    dalla blockchain senza costi. Chiunque puo' leggere i dati pubblici.
//    Esempio: vedere le statistiche di una carta, controllare un listing.
//
// 2. SCRITTURA (signer): Usa un "signer" (wallet con chiave privata)
//    per firmare e inviare transazioni che modificano lo stato della
//    blockchain. Richiede ETH per pagare il gas (costo computazionale).
//    Esempio: mintare una carta, comprare un NFT dal marketplace.
//
// Per ogni contratto vengono create due istanze:
// - Una "read-only" collegata al provider (per letture gratuite)
// - Una "writable" collegata al signer (per transazioni a pagamento)
//
// This file creates and manages the connection to the Ethereum Sepolia
// network and the smart contract instances the bot interacts with. It also
// manages the Pinata connection for uploading files to IPFS.
//
// CONNECTION ARCHITECTURE
//
// The bot interacts with the blockchain at two levels:
//
// 1. READ (provider): Uses a JSON-RPC "provider" to read data from
//    the blockchain at no cost. Anyone can read public data.
//    Example: viewing a card's stats, checking a listing.
//
// 2. WRITE (signer): Uses a "signer" (wallet with private key) to
//    sign and send transactions that modify blockchain state.
//    Requires ETH to pay for gas (computational cost).
//    Example: minting a card, buying an NFT from the marketplace.
//
// For each contract, two instances are created:
// - A "read-only" one connected to the provider (for free reads)
// - A "writable" one connected to the signer (for paid transactions)
// =============================================================================

import { ethers } from "ethers";
import pinataSDK from "@pinata/sdk";
import { CONTRACTS } from "../config.js";
import { CUSTOM_CARDS_ABI, MARKETPLACE_ABI } from "./abis.js";

// =============================================================================
// PROVIDER JSON-RPC - Connessione alla rete Sepolia
// JSON-RPC PROVIDER - Connection to the Sepolia network
//
// Un provider JSON-RPC comunica con un nodo Ethereum tramite il protocollo
// JSON-RPC su HTTP/HTTPS. Il nodo esegue le query e restituisce i risultati.
//
// L'URL del nodo viene letto dalla variabile d'ambiente SEPOLIA_RPC_URL.
// Se non configurata, usa un nodo pubblico gratuito (publicnode.com) che
// ha limiti di rate ma funziona per lo sviluppo e il testing.
//
// A JSON-RPC provider communicates with an Ethereum node via the JSON-RPC
// protocol over HTTP/HTTPS. The node executes queries and returns results.
//
// The node URL is read from the SEPOLIA_RPC_URL environment variable.
// If not configured, it falls back to a free public node (publicnode.com)
// which has rate limits but works for development and testing.
// =============================================================================

/**
 * Provider JSON-RPC per la lettura di dati dalla blockchain Sepolia.
 * JSON-RPC provider for reading data from the Sepolia blockchain.
 *
 * Questo e' il punto di accesso principale alla rete Ethereum. Tutte le
 * operazioni di lettura (saldi, statistiche carte, listing marketplace)
 * passano attraverso questo provider.
 *
 * This is the main access point to the Ethereum network. All read
 * operations (balances, card stats, marketplace listings) go through
 * this provider.
 */
export const provider = new ethers.JsonRpcProvider(
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com"
);

// =============================================================================
// SIGNER - Wallet del bot per firmare le transazioni
// SIGNER - Bot wallet for signing transactions
//
// Il "signer" e' un wallet Ethereum con una chiave privata che permette
// di firmare transazioni. Senza un signer, il bot puo' solo leggere
// dalla blockchain ma non puo' eseguire operazioni di scrittura.
//
// ATTENZIONE SICUREZZA: La chiave privata (PRIVATE_KEY) nel file .env
// controlla i fondi del wallet. Se compromessa, tutti i fondi possono
// essere rubati. Non condividerla mai e non commitarla nel repository.
//
// The "signer" is an Ethereum wallet with a private key that allows
// signing transactions. Without a signer, the bot can only read from
// the blockchain but cannot execute write operations.
//
// SECURITY WARNING: The private key (PRIVATE_KEY) in the .env file
// controls the wallet's funds. If compromised, all funds can be stolen.
// Never share it and never commit it to the repository.
// =============================================================================

/**
 * Wallet del bot per firmare transazioni on-chain.
 * Bot wallet for signing on-chain transactions.
 *
 * Se la variabile PRIVATE_KEY e' configurata nel .env, il bot crea un
 * wallet Ethereum collegato al provider Sepolia. Questo wallet viene
 * usato per pagare il gas delle transazioni (minting, acquisti, ecc.).
 *
 * Se PRIVATE_KEY non e' configurata, signer resta null e le operazioni
 * di scrittura non saranno disponibili (il bot funzionera' solo in
 * modalita' di sola lettura).
 *
 * If the PRIVATE_KEY variable is configured in .env, the bot creates
 * an Ethereum wallet connected to the Sepolia provider. This wallet
 * is used to pay gas for transactions (minting, purchases, etc.).
 *
 * If PRIVATE_KEY is not configured, signer stays null and write
 * operations won't be available (the bot will work in read-only mode).
 */
export let signer: ethers.Wallet | null = null;
if (process.env.PRIVATE_KEY) {
  signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`🔑 Bot wallet: ${signer.address}`);
}

// =============================================================================
// ISTANZE CONTRATTI - Oggetti ethers.js per interagire con i contratti smart
// CONTRACT INSTANCES - ethers.js objects for interacting with smart contracts
//
// In ethers.js, un "Contract" e' un oggetto JavaScript che rappresenta
// uno smart contract deployato sulla blockchain. Fornisce metodi che
// corrispondono alle funzioni del contratto definite nell'ABI.
//
// Per ogni contratto creiamo due versioni:
// - Read-only (collegata al provider): per chiamate gratuite senza gas
// - Writable (collegata al signer): per transazioni che modificano lo stato
//
// Le istanze vengono create dalla funzione initContracts() che deve essere
// chiamata all'avvio del bot, dopo aver caricato la configurazione.
//
// In ethers.js, a "Contract" is a JavaScript object that represents
// a smart contract deployed on the blockchain. It provides methods
// corresponding to the contract functions defined in the ABI.
//
// For each contract we create two versions:
// - Read-only (connected to the provider): for free calls without gas
// - Writable (connected to the signer): for state-changing transactions
//
// Instances are created by the initContracts() function which must be
// called at bot startup, after loading the configuration.
// =============================================================================

// Istanze read-only dei contratti (per letture gratuite dalla blockchain)
// Read-only contract instances (for free reads from the blockchain)
export let customCardsContract: ethers.Contract | null = null;
export let marketplaceContract: ethers.Contract | null = null;

// Istanze writable dei contratti (per transazioni che costano gas)
// Writable contract instances (for transactions that cost gas)
export let customCardsWritable: ethers.Contract | null = null;
export let marketplaceWritable: ethers.Contract | null = null;

/**
 * Inizializza le istanze dei contratti smart.
 * Initializes the smart contract instances.
 *
 * Questa funzione crea gli oggetti Contract di ethers.js per ogni contratto
 * il cui indirizzo e' configurato nel file .env. Deve essere chiamata una
 * sola volta all'avvio del bot.
 *
 * Per ogni contratto configurato:
 * 1. Crea un'istanza read-only collegata al provider (per query gratuite)
 * 2. Se il signer e' disponibile, crea anche un'istanza writable
 *    (per transazioni firmate che modificano lo stato della blockchain)
 *
 * Se un indirizzo contratto non e' configurato (stringa vuota nel .env),
 * la corrispondente istanza resta null e le funzionalita' relative
 * saranno disabilitate nel bot.
 *
 * This function creates ethers.js Contract objects for each contract
 * whose address is configured in the .env file. It must be called
 * once at bot startup.
 *
 * For each configured contract:
 * 1. Creates a read-only instance connected to the provider (for free queries)
 * 2. If the signer is available, also creates a writable instance
 *    (for signed transactions that modify blockchain state)
 *
 * If a contract address is not configured (empty string in .env),
 * the corresponding instance stays null and related features
 * will be disabled in the bot.
 */
export function initContracts() {
  // Inizializza il contratto CustomCards (ERC-721 per le carte Pokemon)
  // Initialize the CustomCards contract (ERC-721 for Pokemon cards)
  if (CONTRACTS.CUSTOM_CARDS) {
    customCardsContract = new ethers.Contract(CONTRACTS.CUSTOM_CARDS, CUSTOM_CARDS_ABI, provider);
    if (signer) {
      customCardsWritable = new ethers.Contract(CONTRACTS.CUSTOM_CARDS, CUSTOM_CARDS_ABI, signer);
    }
  }

  // Inizializza il contratto Marketplace (compravendita carte)
  // Initialize the Marketplace contract (card buying and selling)
  if (CONTRACTS.MARKETPLACE) {
    marketplaceContract = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, provider);
    if (signer) {
      marketplaceWritable = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, signer);
    }
  }
}

// =============================================================================
// CLIENT PINATA - Servizio per il caricamento di file su IPFS
// PINATA CLIENT - Service for uploading files to IPFS
//
// Pinata e' un servizio di "pinning" IPFS. Quando carichi un file su IPFS,
// ottieni un hash unico (CID) che punta al contenuto. Tuttavia, i file su
// IPFS scompaiono se nessun nodo li "conserva" (pin). Pinata garantisce che
// i tuoi file restino disponibili mantenendone copie sui propri server.
//
// Il bot usa Pinata per caricare:
// 1. Le immagini delle carte Pokemon (come file)
// 2. I metadati JSON delle carte (nome, descrizione, link all'immagine)
//
// Senza Pinata configurato, il bot non puo' creare nuove carte
// (perche' non ha dove salvare immagini e metadati).
//
// Pinata is an IPFS "pinning" service. When you upload a file to IPFS,
// you get a unique hash (CID) pointing to the content. However, files
// on IPFS disappear if no node "keeps" (pins) them. Pinata ensures
// your files stay available by maintaining copies on their servers.
//
// The bot uses Pinata to upload:
// 1. Pokemon card images (as files)
// 2. Card JSON metadata (name, description, image link)
//
// Without Pinata configured, the bot cannot create new cards
// (because it has nowhere to save images and metadata).
// =============================================================================

/**
 * Client Pinata per il caricamento di file su IPFS.
 * Pinata client for uploading files to IPFS.
 *
 * Viene inizializzato solo se le credenziali Pinata sono configurate
 * nel file .env (PINATA_API_KEY e PINATA_SECRET_KEY). Se l'autenticazione
 * fallisce, il client viene rimesso a null e la creazione di carte
 * sara' disabilitata.
 *
 * Initialized only if Pinata credentials are configured in the .env
 * file (PINATA_API_KEY and PINATA_SECRET_KEY). If authentication
 * fails, the client is reset to null and card creation will be disabled.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let pinata: any = null;

// Tenta di connettersi a Pinata se le credenziali sono disponibili
// Attempt to connect to Pinata if credentials are available
if (process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY) {
  // Crea l'istanza del client Pinata con API key e secret key
  // Create the Pinata client instance with API key and secret key
  pinata = new (pinataSDK as any)(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY);

  // Verifica che le credenziali siano valide tentando un'autenticazione di test.
  // Questo e' asincrono: il bot continua ad avviarsi mentre la verifica avviene in background.
  //
  // Verify that the credentials are valid by attempting a test authentication.
  // This is async: the bot continues starting up while verification happens in the background.
  pinata.testAuthentication()
    .then(() => console.log("✅ Pinata authentication successful"))
    .catch((err: any) => {
      // Se l'autenticazione fallisce, disabilita Pinata e mostra un avviso.
      // Il bot funzionera' ancora, ma non potra' creare nuove carte.
      //
      // If authentication fails, disable Pinata and show a warning.
      // The bot will still work, but won't be able to create new cards.
      console.error("❌ Pinata authentication failed:", err.message || err);
      console.warn("⚠️ Card creation will fail without valid Pinata credentials");
      pinata = null;
    });
} else {
  // Le credenziali Pinata non sono configurate nel .env
  // Pinata credentials are not configured in .env
  console.warn("⚠️ Pinata not configured - PINATA_API_KEY and PINATA_SECRET_KEY environment variables are required for IPFS uploads");
}
