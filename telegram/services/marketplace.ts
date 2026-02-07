// =============================================================================
// SERVIZIO MARKETPLACE - Listing, acquisto e browsing di carte NFT
// MARKETPLACE SERVICE - NFT card listing, purchase and browsing
// =============================================================================
//
// Questo modulo gestisce tutte le interazioni con lo smart contract del marketplace.
// Il marketplace è un contratto sulla blockchain che permette agli utenti di mettere
// in vendita le proprie carte NFT e di acquistare quelle di altri utenti.
//
// This module handles all interactions with the marketplace smart contract.
// The marketplace is a contract on the blockchain that allows users to list their
// NFT cards for sale and purchase cards from other users.
//
// Come funziona il marketplace a livello blockchain:
//   1. LISTING (mettere in vendita): Il venditore approva il marketplace a trasferire
//      il suo NFT, poi chiama listNFT() che trasferisce la carta al contratto marketplace.
//      La carta è ora "in custodia" del contratto finché non viene venduta o rimossa.
//   2. ACQUISTO (comprare): Il compratore chiama buyNFT() inviando ETH. Il contratto
//      verifica il pagamento, trasferisce l'NFT al compratore e invia gli ETH al venditore.
//   3. BROWSING (sfogliare): Chiunque può leggere i listing attivi dal contratto senza
//      pagare gas (sono "view functions" — letture gratuite dalla blockchain).
//
// How the marketplace works at the blockchain level:
//   1. LISTING (putting up for sale): The seller approves the marketplace to transfer
//      their NFT, then calls listNFT() which transfers the card to the marketplace
//      contract. The card is now "in custody" of the contract until sold or delisted.
//   2. PURCHASE (buying): The buyer calls buyNFT() sending ETH. The contract
//      verifies the payment, transfers the NFT to the buyer and sends ETH to the seller.
//   3. BROWSING: Anyone can read active listings from the contract without
//      paying gas (these are "view functions" — free reads from the blockchain).
//
// Il bot Telegram astrae tutta questa complessità: l'utente vede un semplice menu
// con le carte disponibili e un bottone "Compra" — il resto avviene dietro le quinte.
//
// The Telegram bot abstracts all this complexity: the user sees a simple menu
// with available cards and a "Buy" button — the rest happens behind the scenes.
// =============================================================================

import { ethers } from "ethers";
import { CONTRACTS } from "../config.js";
import { provider, marketplaceContract, customCardsContract } from "../contracts/provider.js";
import { MARKETPLACE_ABI } from "../contracts/abis.js";
import { fetchNFTMetadata } from "./ipfs.js";
import { getWalletManager, marketplaceRateLimiter } from "../wallet/index.js";
import type { MarketplaceListing, BuyResult } from "../types.js";

// =============================================================================
// RECUPERO LISTING ARRICCHITI
// ENRICHED LISTING RETRIEVAL
// =============================================================================
//
// I dati on-chain di un listing sono minimali: venditore, contratto NFT, tokenId,
// prezzo, stato attivo, timestamp. Per mostrare informazioni utili all'utente
// (nome carta, immagine, statistiche), dobbiamo "arricchire" questi dati
// interrogando il contratto dell'NFT per le stats e scaricando i metadati da IPFS.
//
// On-chain listing data is minimal: seller, NFT contract, tokenId, price, active
// status, timestamp. To show useful information to the user (card name, image,
// stats), we must "enrich" this data by querying the NFT contract for stats
// and downloading metadata from IPFS.
// =============================================================================

/**
 * Recupera un listing arricchito con dati on-chain (stats, immagine, nome).
 * Fetches an enriched listing with on-chain data (stats, image, name).
 *
 * Questa funzione esegue fino a tre query per arricchire un singolo listing:
 *   1. getListing(id) → dati base dal marketplace (venditore, prezzo, stato)
 *   2. getCardStats(tokenId) → statistiche della carta dal contratto NFT (HP, ATK, ecc.)
 *   3. tokenURI(tokenId) + fetch IPFS → metadati off-chain (nome, descrizione, immagine)
 *
 * Se una delle query secondarie fallisce, il listing viene comunque restituito
 * con i soli dati base — un approccio "best effort" che garantisce che il browsing
 * del marketplace funzioni anche se IPFS è temporaneamente irraggiungibile.
 *
 * This function performs up to three queries to enrich a single listing:
 *   1. getListing(id) → basic data from marketplace (seller, price, status)
 *   2. getCardStats(tokenId) → card stats from the NFT contract (HP, ATK, etc.)
 *   3. tokenURI(tokenId) + fetch IPFS → off-chain metadata (name, description, image)
 *
 * If any secondary query fails, the listing is still returned with basic data only —
 * a "best effort" approach that ensures marketplace browsing works even if IPFS
 * is temporarily unreachable.
 *
 * @param listingId - L'ID numerico del listing nel contratto marketplace /
 *                    The numeric ID of the listing in the marketplace contract
 * @returns Il listing arricchito con tutti i dati disponibili, o null se non valido /
 *          The enriched listing with all available data, or null if invalid
 */
export async function getEnrichedListing(listingId: number): Promise<MarketplaceListing | null> {
  if (!marketplaceContract) return null;

  try {
    // -------------------------------------------------------------------------
    // Fase 1: Recupera i dati base del listing dallo smart contract
    // Step 1: Fetch basic listing data from the smart contract
    // -------------------------------------------------------------------------
    let listing;
    try {
      listing = await marketplaceContract.getListing(listingId);
    } catch (decodeError: any) {
      // BAD_DATA indica che il listingId non esiste o i dati sono corrotti on-chain.
      // Questo è normale per ID che non sono mai stati usati o sono stati cancellati.
      // BAD_DATA indicates the listingId doesn't exist or data is corrupted on-chain.
      // This is normal for IDs that were never used or were cancelled.
      if (decodeError?.code === 'BAD_DATA') {
        return null;
      }
      throw decodeError;
    }

    // Un listing non attivo o con seller = zero address è stato cancellato o completato
    // An inactive listing or with seller = zero address has been cancelled or completed
    if (!listing.active || !listing.seller || listing.seller === ethers.ZeroAddress) {
      return null;
    }

    // Costruisci l'oggetto listing con i dati base on-chain
    // Build the listing object with basic on-chain data
    const enriched: MarketplaceListing = {
      listingId,
      seller: listing.seller,
      nftContract: listing.nftContract,
      tokenId: Number(listing.tokenId),
      price: listing.price,
      active: listing.active,
      createdAt: Number(listing.createdAt)
    };

    // -------------------------------------------------------------------------
    // Fase 2: Identifica il contratto NFT per recuperare dati aggiuntivi
    // Step 2: Identify the NFT contract to fetch additional data
    // -------------------------------------------------------------------------
    //
    // Il marketplace può ospitare NFT da contratti diversi. Qui controlliamo se
    // il contratto dell'NFT è il nostro PokeDEXCustomCards. Se non lo riconosciamo,
    // non possiamo leggere le stats (ogni contratto ha un'interfaccia diversa).
    //
    // The marketplace can host NFTs from different contracts. Here we check if
    // the NFT contract is our PokeDEXCustomCards. If we don't recognize it,
    // we can't read the stats (every contract has a different interface).
    const customCardsAddress = CONTRACTS.CUSTOM_CARDS || "";
    const isCustomCard = customCardsAddress &&
      listing.nftContract.toLowerCase() === customCardsAddress.toLowerCase();

    const contract = isCustomCard ? customCardsContract : null;

    if (!contract) {
      console.warn(`[Marketplace] No contract available for listing ${listingId}`);
    }

    // -------------------------------------------------------------------------
    // Fase 3: Arricchisci con stats e metadati IPFS (se il contratto è noto)
    // Step 3: Enrich with stats and IPFS metadata (if the contract is known)
    // -------------------------------------------------------------------------
    if (contract) {
      try {
        // Leggi le statistiche della carta direttamente dal contratto on-chain
        // Read card stats directly from the on-chain contract
        const stats = await contract.getCardStats(listing.tokenId);
        enriched.stats = {
          hp: Number(stats.hp),
          attack: Number(stats.attack),
          defense: Number(stats.defense),
          speed: Number(stats.speed),
          // Compatibilità con diverse versioni del contratto (pokemonType vs cardType)
          // Compatibility with different contract versions (pokemonType vs cardType)
          pokemonType: Number(stats.pokemonType || stats.cardType || 0),
          rarity: Number(stats.rarity),
          generation: Number(stats.generation || 1),
          experience: Number(stats.experience || 0)
        };

        try {
          // Scarica i metadati off-chain (nome, descrizione, immagine) da IPFS
          // Download off-chain metadata (name, description, image) from IPFS
          const tokenURI = await contract.tokenURI(listing.tokenId);
          const metadata = await fetchNFTMetadata(tokenURI);
          if (metadata) {
            enriched.name = metadata.name;
            enriched.description = metadata.description;
            enriched.imageUrl = metadata.image;
          }
        } catch {
          // Fallimento silenzioso — i metadati IPFS sono opzionali per il browsing
          // Silent failure — IPFS metadata is optional for browsing
        }
      } catch (e) {
        console.error(`Error getting stats for token ${listing.tokenId}:`, e);
      }
    }

    return enriched;
  } catch (error) {
    console.error(`Error fetching listing ${listingId}:`, error);
    return null;
  }
}

// =============================================================================
// PAGINAZIONE LISTING ATTIVI
// ACTIVE LISTING PAGINATION
// =============================================================================
//
// Il marketplace potrebbe contenere centinaia di listing, ma molti saranno
// inattivi (venduti o cancellati). Iteriamo al contrario (dal più recente)
// perché i listing più nuovi sono generalmente più interessanti per gli utenti.
// La paginazione con offset/limit permette di mostrare i risultati a "pagine"
// nel bot Telegram senza sovraccaricare né la blockchain né l'interfaccia.
//
// The marketplace could contain hundreds of listings, but many will be
// inactive (sold or cancelled). We iterate backwards (from most recent)
// because newer listings are generally more interesting to users. Pagination
// with offset/limit allows showing results in "pages" in the Telegram bot
// without overloading either the blockchain or the interface.
// =============================================================================

/**
 * Recupera i listing attivi con paginazione.
 * Fetches active listings with pagination.
 *
 * Algoritmo:
 *   1. Scansiona gli ID dei listing in avanti (da 1 in su)
 *   2. Si ferma dopo 10 slot vuoti consecutivi (fine dei listing)
 *   3. Raccoglie tutti i listing attivi e li ordina per ID decrescente
 *   4. Applica paginazione (offset/limit) sull'insieme ordinato
 *
 * Algorithm:
 *   1. Scans listing IDs forward (from 1 upward)
 *   2. Stops after 10 consecutive empty slots (end of listings)
 *   3. Collects all active listings and sorts by descending ID
 *   4. Applies pagination (offset/limit) on the sorted set
 *
 * NOTA: Il contratto deployato non ha totalListings(), quindi scansioniamo
 * in avanti e ci fermiamo quando non troviamo piu' listing.
 *
 * NOTE: The deployed contract has no totalListings(), so we scan forward
 * and stop when we no longer find listings.
 *
 * @param offset - Quanti listing attivi saltare (per paginazione) / How many active listings to skip (for pagination)
 * @param limit - Massimo numero di listing da restituire / Maximum number of listings to return
 * @returns Array di listing attivi arricchiti / Array of enriched active listings
 */
export async function getActiveListings(offset: number = 0, limit: number = 5): Promise<MarketplaceListing[]> {
  if (!marketplaceContract) return [];

  try {
    // Il contratto deployato NON ha totalListings(). Scansioniamo in avanti
    // da ID 1, fermandoci dopo N slot vuoti consecutivi (fine dei listing).
    //
    // The deployed contract does NOT have totalListings(). We scan forward
    // from ID 1, stopping after N consecutive empty slots (end of listings).
    const listings: MarketplaceListing[] = [];
    let skipped = 0;
    let consecutiveEmpty = 0;
    const MAX_CONSECUTIVE_EMPTY = 10; // Stop dopo 10 slot vuoti consecutivi / Stop after 10 consecutive empty slots
    const MAX_SCAN = 200;             // Limite assoluto di scansione / Absolute scan limit

    // Scansioniamo tutti i listing per trovare quelli attivi, poi ordiniamo
    // Scan all listings to find active ones, then sort
    const allActive: MarketplaceListing[] = [];

    for (let i = 1; i <= MAX_SCAN; i++) {
      try {
        const listing = await getEnrichedListing(i);
        if (listing && listing.active) {
          consecutiveEmpty = 0;
          allActive.push(listing);
        } else {
          consecutiveEmpty++;
          if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break;
        }
      } catch {
        consecutiveEmpty++;
        if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break;
      }
    }

    // Ordina per ID decrescente (piu' recenti prima) / Sort by descending ID (newest first)
    allActive.sort((a, b) => b.listingId - a.listingId);

    // Applica paginazione / Apply pagination
    const paginated = allActive.slice(offset, offset + limit);

    console.log(`[Marketplace] Found ${allActive.length} active listings, returning ${paginated.length} (offset=${offset}, limit=${limit})`);
    return paginated;
  } catch (error) {
    console.error("Error fetching active listings:", error);
    return [];
  }
}

// =============================================================================
// ACQUISTO NFT ON-CHAIN
// ON-CHAIN NFT PURCHASE
// =============================================================================
//
// L'acquisto è l'operazione più critica e delicata del marketplace. Coinvolge
// trasferimento di ETH reali e di NFT, quindi richiede molteplici controlli
// di sicurezza prima di procedere:
//
// The purchase is the most critical and delicate operation of the marketplace.
// It involves real ETH and NFT transfers, so it requires multiple security
// checks before proceeding:
//
//   1. Rate limiting — impedisce spam di transazioni (protezione anti-bot e anti-errore)
//   2. Verifica wallet — l'utente deve avere un wallet custodial attivo
//   3. Verifica saldo — deve avere abbastanza ETH per coprire il prezzo
//   4. Esecuzione transazione — invio della transazione firmata alla blockchain
//   5. Attesa conferma — aspetta che la transazione sia inclusa in un blocco
//
//   1. Rate limiting — prevents transaction spam (anti-bot and anti-error protection)
//   2. Wallet verification — the user must have an active custodial wallet
//   3. Balance check — must have enough ETH to cover the price
//   4. Transaction execution — sending the signed transaction to the blockchain
//   5. Confirmation wait — waits for the transaction to be included in a block
// =============================================================================

/**
 * Acquista un NFT dal marketplace usando il wallet custodial dell'utente.
 * Purchases an NFT from the marketplace using the user's custodial wallet.
 *
 * Flusso completo dell'acquisto:
 *   1. Verifica rate limit (max N operazioni al minuto per utente)
 *   2. Recupera il wallet custodial dell'utente dal WalletManager
 *   3. Controlla che il saldo sia sufficiente a coprire il prezzo
 *   4. Crea un'istanza del contratto marketplace collegata al signer dell'utente
 *   5. Chiama buyNFT() sul contratto, inviando ETH come "value" della transazione
 *   6. Attende la conferma on-chain (la transazione viene inclusa in un blocco)
 *   7. Restituisce l'hash della transazione come prova dell'acquisto
 *
 * Complete purchase flow:
 *   1. Verify rate limit (max N operations per minute per user)
 *   2. Retrieve the user's custodial wallet from WalletManager
 *   3. Check that the balance is sufficient to cover the price
 *   4. Create a marketplace contract instance connected to the user's signer
 *   5. Call buyNFT() on the contract, sending ETH as the transaction "value"
 *   6. Wait for on-chain confirmation (transaction gets included in a block)
 *   7. Return the transaction hash as proof of purchase
 *
 * Il "signer" è un oggetto che può firmare transazioni — nel nostro caso, è la
 * chiave privata del wallet custodial dell'utente gestita dal WalletManager.
 * Ogni transazione sulla blockchain deve essere firmata crittograficamente.
 *
 * The "signer" is an object that can sign transactions — in our case, it's the
 * private key of the user's custodial wallet managed by the WalletManager.
 * Every transaction on the blockchain must be cryptographically signed.
 *
 * @param listingId - L'ID del listing da acquistare / The ID of the listing to purchase
 * @param price - Il prezzo in wei (la più piccola unità di ETH: 1 ETH = 10^18 wei) /
 *                The price in wei (the smallest ETH unit: 1 ETH = 10^18 wei)
 * @param userId - L'ID Telegram dell'utente compratore / The Telegram ID of the buying user
 * @returns Risultato con successo/errore e hash della transazione /
 *          Result with success/error and transaction hash
 */
export async function buyNFTOnChain(listingId: number, price: bigint, userId?: number): Promise<BuyResult> {
  // Verifica che il contratto marketplace sia configurato nell'ambiente
  // Verify that the marketplace contract is configured in the environment
  if (!CONTRACTS.MARKETPLACE) {
    return { success: false, error: "Marketplace not configured" };
  }

  // L'ID utente è obbligatorio per identificare il wallet custodial
  // User ID is mandatory to identify the custodial wallet
  if (!userId) {
    return { success: false, error: "User ID required for purchase" };
  }

  // -------------------------------------------------------------------------
  // Rate Limiting: protezione contro transazioni accidentali o malevole
  // Rate Limiting: protection against accidental or malicious transactions
  // -------------------------------------------------------------------------
  // Limita il numero di operazioni marketplace per utente in un dato intervallo
  // di tempo. Questo previene:
  //   - Acquisti doppi accidentali (utente che clicca due volte "Compra")
  //   - Attacchi di spam che svuoterebbero il wallet dell'utente
  //   - Sovraccarico del nodo blockchain con troppe transazioni
  //
  // Limits the number of marketplace operations per user within a given time
  // window. This prevents:
  //   - Accidental double purchases (user clicking "Buy" twice)
  //   - Spam attacks that would drain the user's wallet
  //   - Overloading the blockchain node with too many transactions
  const rateLimitResult = marketplaceRateLimiter.isAllowed(userId.toString());
  if (!rateLimitResult.allowed) {
    const waitTime = Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000);
    return { success: false, error: `Too many marketplace operations. Please wait ${waitTime} seconds.` };
  }

  try {
    // -------------------------------------------------------------------------
    // Recupero e verifica del wallet custodial dell'utente
    // Retrieval and verification of the user's custodial wallet
    // -------------------------------------------------------------------------
    const walletManager = getWalletManager();
    if (!walletManager.hasWallet(userId)) {
      return { success: false, error: "Please create a wallet first to make purchases" };
    }

    // Il signer è l'oggetto ethers.js che detiene la chiave privata e può
    // firmare transazioni per conto dell'utente
    // The signer is the ethers.js object that holds the private key and can
    // sign transactions on behalf of the user
    const activeSigner = await walletManager.getSigner(userId);
    if (!activeSigner) {
      return { success: false, error: "Failed to access your wallet" };
    }

    // -------------------------------------------------------------------------
    // Verifica saldo: l'utente deve avere abbastanza ETH per pagare
    // Balance check: the user must have enough ETH to pay
    // -------------------------------------------------------------------------
    // Nota: non controlliamo il costo del gas qui — il provider lo gestisce
    // automaticamente. Se il saldo è appena sufficiente per il prezzo ma non
    // per il gas, la transazione fallirà con un errore INSUFFICIENT_FUNDS.
    //
    // Note: we don't check gas cost here — the provider handles it automatically.
    // If the balance is barely enough for the price but not for gas, the
    // transaction will fail with an INSUFFICIENT_FUNDS error.
    const balance = await provider.getBalance(activeSigner.address);
    if (balance < price) {
      return {
        success: false,
        error: `Insufficient balance. Need ${ethers.formatEther(price)} ETH, have ${ethers.formatEther(balance)} ETH`
      };
    }

    console.log(`Buying listing #${listingId} for ${ethers.formatEther(price)} ETH from ${activeSigner.address}`);

    // -------------------------------------------------------------------------
    // Esecuzione della transazione on-chain
    // On-chain transaction execution
    // -------------------------------------------------------------------------
    // Creiamo una nuova istanza del contratto marketplace collegata al signer
    // dell'utente (non al provider read-only). Questo permette di SCRIVERE
    // sulla blockchain (inviare transazioni), non solo leggere.
    //
    // We create a new marketplace contract instance connected to the user's
    // signer (not the read-only provider). This allows WRITING to the blockchain
    // (sending transactions), not just reading.
    const marketplace = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, activeSigner);

    // buyNFT(listingId) con { value: price } invia ETH insieme alla chiamata.
    // Il contratto deployato prende solo listingId — il prezzo viene inviato come msg.value.
    //
    // buyNFT(listingId) with { value: price } sends ETH along with the call.
    // The deployed contract takes only listingId — price is sent as msg.value.
    const tx = await marketplace.buyNFT(listingId, { value: price });
    console.log(`Transaction sent: ${tx.hash}`);

    // Attende conferma con timeout di 120s per evitare hang su Sepolia
    // Waits for confirmation with 120s timeout to avoid hanging on Sepolia
    const receipt = await tx.wait(1, 120_000);
    console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);

    return { success: true, txHash: tx.hash };
  } catch (error: any) {
    console.error("Buy error:", error);

    // Messaggi di errore chiari per ogni tipo di fallimento
    // Clear error messages for each type of failure
    if (error.code === "CALL_EXCEPTION") {
      const reason = error.reason || error.revert?.args?.[0];
      if (reason) {
        return { success: false, error: `Contract rejected: ${reason}` };
      }
      return {
        success: false,
        error: "The contract rejected this transaction. The listing may no longer be active, or the price may have changed."
      };
    }
    if (error.code === "TIMEOUT") {
      return {
        success: false,
        error: `Transaction sent but not confirmed within 2 minutes. Check the block explorer for TX: ${error.transaction?.hash || "unknown"}`
      };
    }
    if (error.code === "INSUFFICIENT_FUNDS") {
      return { success: false, error: "Insufficient ETH balance (including gas fees)." };
    }
    return {
      success: false,
      error: error.reason || error.shortMessage || "Transaction failed. Please try again."
    };
  }
}
