// =============================================================================
// SERVIZIO DEPLOY - Minting di carte custom on-chain
// DEPLOY SERVICE - Custom card on-chain minting
// =============================================================================
//
// Questo modulo gestisce il "minting" — il processo di creazione di un nuovo NFT
// sulla blockchain. "Mintare" una carta significa registrarla permanentemente come
// un token unico sulla blockchain, con le sue statistiche e metadati.
//
// This module handles "minting" — the process of creating a new NFT on the
// blockchain. "Minting" a card means permanently registering it as a unique
// token on the blockchain, with its stats and metadata.
//
// Cosa succede quando un utente minta una carta:
//   1. I metadati (nome, immagine, stats) sono già su IPFS (vedi ipfs.ts)
//   2. La transazione createCard() viene inviata allo smart contract PokeDEXCustomCards
//   3. Il contratto verifica il pagamento della minting fee
//   4. Il contratto crea un nuovo token ERC-721 con un ID unico (tokenId)
//   5. Le statistiche (HP, ATK, DEF, SPD, tipo, rarità) vengono salvate on-chain
//   6. Il tokenURI (link IPFS ai metadati) viene associato al nuovo token
//   7. La proprietà del token viene assegnata all'indirizzo del wallet dell'utente
//
// What happens when a user mints a card:
//   1. Metadata (name, image, stats) is already on IPFS (see ipfs.ts)
//   2. The createCard() transaction is sent to the PokeDEXCustomCards smart contract
//   3. The contract verifies payment of the minting fee
//   4. The contract creates a new ERC-721 token with a unique ID (tokenId)
//   5. Stats (HP, ATK, DEF, SPD, type, rarity) are stored on-chain
//   6. The tokenURI (IPFS link to metadata) is associated with the new token
//   7. Token ownership is assigned to the user's wallet address
//
// Il minting fee è un costo in ETH richiesto dal contratto per creare nuove carte.
// Serve per prevenire spam e finanziare il progetto.
//
// The minting fee is an ETH cost required by the contract to create new cards.
// It serves to prevent spam and fund the project.
// =============================================================================

import { ethers } from "ethers";
import { CONTRACTS } from "../config.js";
import { provider, customCardsContract } from "../contracts/provider.js";
import { CUSTOM_CARDS_ABI } from "../contracts/abis.js";
import { getWalletManager } from "../wallet/index.js";
import type { DeployResult } from "../types.js";
import type { CardDraft } from "../storage/types.js";

// =============================================================================
// DEPLOY CARTA ON-CHAIN
// ON-CHAIN CARD DEPLOYMENT
// =============================================================================
//
// La funzione principale di questo modulo. Prende un "draft" (bozza) di carta
// completato dall'utente attraverso il bot e lo trasforma in un NFT permanente
// sulla blockchain. È un'operazione irreversibile: una volta mintata, la carta
// esiste per sempre sulla blockchain.
//
// The main function of this module. It takes a "draft" of a card completed by
// the user through the bot and turns it into a permanent NFT on the blockchain.
// This is an irreversible operation: once minted, the card exists forever on
// the blockchain.
// =============================================================================

/**
 * Deploya una carta on-chain usando il wallet custodial dell'utente.
 * Deploys a card on-chain using the user's custodial wallet.
 *
 * Processo completo di minting:
 *   1. VERIFICA WALLET: Controlla che l'utente abbia un wallet custodial valido
 *      e che i dati del wallet non siano corrotti (verifyWalletIntegrity)
 *   2. VERIFICA FONDI: Legge la minting fee dal contratto e controlla che il
 *      saldo del wallet sia sufficiente a coprirla
 *   3. INVIO TRANSAZIONE: Chiama createCard() sullo smart contract con le stats
 *      della carta e il link ai metadati IPFS, allegando la minting fee come valore ETH
 *   4. ATTESA CONFERMA: Aspetta che un miner/validatore includa la transazione
 *      in un blocco — solo allora la carta esiste davvero sulla blockchain
 *   5. PARSING TOKEN ID: Analizza i log della transazione per estrarre il tokenId
 *      della carta appena creata (emesso dall'evento Transfer di ERC-721)
 *
 * Complete minting process:
 *   1. WALLET VERIFICATION: Checks that the user has a valid custodial wallet
 *      and that wallet data is not corrupted (verifyWalletIntegrity)
 *   2. FUNDS VERIFICATION: Reads the minting fee from the contract and checks
 *      that the wallet balance is sufficient to cover it
 *   3. TRANSACTION SUBMISSION: Calls createCard() on the smart contract with the
 *      card stats and IPFS metadata link, attaching the minting fee as ETH value
 *   4. CONFIRMATION WAIT: Waits for a miner/validator to include the transaction
 *      in a block — only then does the card truly exist on the blockchain
 *   5. TOKEN ID PARSING: Analyzes transaction logs to extract the tokenId of
 *      the newly created card (emitted by the ERC-721 Transfer event)
 *
 * @param draft - Il draft completo della carta (stats, metadati, immagine già su IPFS) /
 *                The complete card draft (stats, metadata, image already on IPFS)
 * @returns Risultato del deploy con tokenId e hash della transazione /
 *          Deploy result with tokenId and transaction hash
 */
export async function deployCardOnChain(draft: CardDraft): Promise<DeployResult> {
  // Verifica che il contratto PokeDEXCustomCards sia configurato e inizializzato
  // Verify that the PokeDEXCustomCards contract is configured and initialized
  if (!customCardsContract) {
    return { success: false, error: "CustomCards contract not configured" };
  }

  // Il metadataUri è l'hash IPFS dei metadati JSON — senza questo, la carta
  // non avrebbe nome, descrizione o immagine associati
  // The metadataUri is the IPFS hash of the JSON metadata — without this, the card
  // would have no associated name, description or image
  if (!draft.metadataUri) {
    return { success: false, error: "No metadata URI - upload to IPFS first" };
  }

  try {
    // =========================================================================
    // FASE 1: VERIFICA DEL WALLET CUSTODIAL
    // STEP 1: CUSTODIAL WALLET VERIFICATION
    // =========================================================================
    //
    // Il "wallet custodial" è un wallet creato e gestito dal bot per conto
    // dell'utente. La chiave privata è conservata in modo sicuro dal sistema.
    // L'utente non deve gestire seed phrase o chiavi private — il bot lo fa per lui.
    // Questo semplifica enormemente l'esperienza ma richiede fiducia nel sistema.
    //
    // The "custodial wallet" is a wallet created and managed by the bot on behalf
    // of the user. The private key is securely stored by the system. The user
    // doesn't need to manage seed phrases or private keys — the bot does it for them.
    // This greatly simplifies the experience but requires trust in the system.
    // =========================================================================
    const walletManager = getWalletManager();

    if (!walletManager.hasWallet(draft.telegramUserId)) {
      return { success: false, error: "Please create a wallet first using the Wallet menu" };
    }

    // Verifica integrità: controlla che i dati del wallet non siano corrotti.
    // Questo è cruciale perché un wallet corrotto potrebbe portare alla perdita
    // di fondi o al fallimento della transazione.
    //
    // Integrity check: verifies that wallet data is not corrupted.
    // This is crucial because a corrupted wallet could lead to loss of
    // funds or transaction failure.
    console.log(`[Deploy] Verifying wallet integrity for user ${draft.telegramUserId}`);
    const isWalletValid = await walletManager.verifyWalletIntegrity(draft.telegramUserId);
    if (!isWalletValid) {
      console.error(`[Deploy] Wallet integrity check failed for user ${draft.telegramUserId}`);
      return {
        success: false,
        error: "Cannot access your wallet. The wallet data may be corrupted. Please create a new wallet from the Wallet menu."
      };
    }

    // Ottieni il "signer" — l'oggetto che detiene la chiave privata e può firmare transazioni
    // Get the "signer" — the object that holds the private key and can sign transactions
    const userSigner = await walletManager.getSigner(draft.telegramUserId);
    console.log(`[Deploy] Using user's custodial wallet: ${userSigner.address}`);

    // =========================================================================
    // FASE 2: VERIFICA FONDI
    // STEP 2: FUNDS VERIFICATION
    // =========================================================================
    //
    // La minting fee è definita nel contratto e può essere modificata
    // dall'amministratore. La leggiamo dinamicamente invece di usare un valore
    // hardcoded per assicurarci di inviare sempre l'importo corretto.
    //
    // The minting fee is defined in the contract and can be changed by the
    // administrator. We read it dynamically instead of using a hardcoded value
    // to ensure we always send the correct amount.
    // =========================================================================
    const mintingFee = await customCardsContract.mintingFee();
    console.log(`Minting fee: ${ethers.formatEther(mintingFee)} ETH`);

    // Controlla il saldo del wallet dell'utente sulla blockchain
    // Check the user's wallet balance on the blockchain
    const balance = await provider.getBalance(userSigner.address);
    if (balance < mintingFee) {
      return {
        success: false,
        error: `Insufficient balance. Need ${ethers.formatEther(mintingFee)} ETH, have ${ethers.formatEther(balance)} ETH`
      };
    }

    // =========================================================================
    // FASE 3: INVIO TRANSAZIONE DI MINTING
    // STEP 3: MINTING TRANSACTION SUBMISSION
    // =========================================================================
    //
    // Creiamo una nuova istanza del contratto collegata al signer dell'utente.
    // Questo è necessario perché il contratto "read-only" (customCardsContract)
    // è collegato solo al provider e non può inviare transazioni.
    //
    // We create a new contract instance connected to the user's signer.
    // This is necessary because the "read-only" contract (customCardsContract)
    // is connected only to the provider and cannot send transactions.
    // =========================================================================
    console.log(`Deploying card: ${draft.cardName}`);
    console.log(`Stats: HP=${draft.stats.hp}, ATK=${draft.stats.attack}, DEF=${draft.stats.defense}, SPD=${draft.stats.speed}`);
    console.log(`Type=${draft.stats.pokemonType}, Rarity=${draft.stats.rarity}, Royalty=${draft.royaltyPercentage}`);

    const customCardsWithSigner = new ethers.Contract(CONTRACTS.CUSTOM_CARDS, CUSTOM_CARDS_ABI, userSigner);

    // createCard() è la funzione dello smart contract che minta il nuovo NFT.
    // Parametri:
    //   - metadataUri: link IPFS ai metadati JSON (nome, immagine, descrizione)
    //   - hp, attack, defense, speed: statistiche della carta (salvate on-chain)
    //   - pokemonType: tipo Pokemon (0=Normal, 1=Fire, ecc.)
    //   - rarity: livello di rarità (0=Common ... 4=Legendary)
    //   - royaltyPercentage: % di royalty per vendite secondarie (ERC-2981)
    //   - { value: mintingFee }: ETH da inviare come pagamento
    //
    // createCard() is the smart contract function that mints the new NFT.
    // Parameters:
    //   - metadataUri: IPFS link to JSON metadata (name, image, description)
    //   - hp, attack, defense, speed: card stats (stored on-chain)
    //   - pokemonType: Pokemon type (0=Normal, 1=Fire, etc.)
    //   - rarity: rarity tier (0=Common ... 4=Legendary)
    //   - royaltyPercentage: % royalty for secondary sales (ERC-2981)
    //   - { value: mintingFee }: ETH to send as payment
    const tx = await customCardsWithSigner.createCard(
      draft.metadataUri,
      draft.stats.hp,
      draft.stats.attack,
      draft.stats.defense,
      draft.stats.speed,
      draft.stats.pokemonType,
      draft.stats.rarity,
      draft.royaltyPercentage,
      { value: mintingFee }
    );

    console.log(`Transaction sent: ${tx.hash}`);

    // =========================================================================
    // FASE 4: ATTESA CONFERMA ON-CHAIN
    // STEP 4: ON-CHAIN CONFIRMATION WAIT
    // =========================================================================
    //
    // tx.wait() blocca l'esecuzione finché la transazione non è inclusa in un
    // blocco confermato. Questo può richiedere da pochi secondi a diversi minuti
    // a seconda della congestione della rete e del gas price impostato.
    //
    // tx.wait() blocks execution until the transaction is included in a
    // confirmed block. This can take from a few seconds to several minutes
    // depending on network congestion and the gas price set.
    // =========================================================================
    const receipt = await tx.wait(1, 120_000);
    console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);

    // =========================================================================
    // FASE 5: PARSING DEL TOKEN ID DAI LOG DELLA TRANSAZIONE
    // STEP 5: PARSING TOKEN ID FROM TRANSACTION LOGS
    // =========================================================================
    //
    // Quando un NFT ERC-721 viene creato ("mintato"), il contratto emette un
    // evento Transfer(from=0x0, to=indirizzo_utente, tokenId=nuovo_id).
    // L'indirizzo "from" è 0x0 (zero address) perché il token viene creato
    // dal nulla. Il tokenId è l'identificatore unico della nuova carta.
    //
    // When an ERC-721 NFT is created ("minted"), the contract emits a
    // Transfer(from=0x0, to=user_address, tokenId=new_id) event.
    // The "from" address is 0x0 (zero address) because the token is created
    // from nothing. The tokenId is the unique identifier of the new card.
    //
    // Proviamo prima con l'interfaccia ABI del contratto (più affidabile),
    // poi come fallback leggiamo i topic grezzi dei log.
    //
    // We try first with the contract's ABI interface (more reliable),
    // then as a fallback we read the raw log topics.
    // =========================================================================
    let tokenId: number | undefined;

    // Tentativo 1: parsing tramite ABI — l'SDK ethers.js decodifica automaticamente i log
    // Attempt 1: ABI-based parsing — ethers.js SDK automatically decodes logs
    for (const log of receipt.logs) {
      try {
        const parsed = customCardsWithSigner.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });
        // Cerchiamo l'evento Transfer dove 'from' è l'indirizzo zero (= minting)
        // We look for the Transfer event where 'from' is the zero address (= minting)
        if (parsed?.name === "Transfer" && parsed.args[0] === ethers.ZeroAddress) {
          tokenId = Number(parsed.args[2]);
          break;
        }
      } catch (parseErr) {
        // Non tutti i log corrispondono alla nostra ABI — è normale
        // Not all logs match our ABI — this is normal
      }
    }

    // Tentativo 2 (fallback): parsing manuale dei topic grezzi
    // Attempt 2 (fallback): manual parsing of raw topics
    // Il topic[0] è l'hash della signature dell'evento Transfer(address,address,uint256)
    // topic[0] is the hash of the Transfer(address,address,uint256) event signature
    if (tokenId === undefined) {
      const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      for (const log of receipt.logs) {
        if (log.topics[0] === transferTopic && log.topics.length >= 4) {
          // topic[1] è 'from', padded a 32 byte — estraiamo gli ultimi 20 byte (40 hex chars)
          // topic[1] is 'from', padded to 32 bytes — we extract the last 20 bytes (40 hex chars)
          const from = "0x" + log.topics[1].slice(26);
          if (from === ethers.ZeroAddress) {
            // topic[3] è il tokenId come uint256 — lo convertiamo in numero
            // topic[3] is the tokenId as uint256 — we convert it to number
            tokenId = Number(BigInt(log.topics[3]));
            console.log(`[Deploy] Recovered tokenId ${tokenId} from raw Transfer log`);
            break;
          }
        }
      }
    }

    if (tokenId === undefined) {
      console.error(`[Deploy] Could not parse tokenId from ${receipt.logs.length} logs in tx ${tx.hash}`);
    }

    return { success: true, tokenId, txHash: tx.hash };

  } catch (error: any) {
    // =========================================================================
    // GESTIONE ERRORI SPECIFICI DELLA BLOCKCHAIN
    // BLOCKCHAIN-SPECIFIC ERROR HANDLING
    // =========================================================================
    //
    // Gli errori blockchain sono diversi dai normali errori JavaScript. Ci sono
    // categorie specifiche che richiedono messaggi diversi per l'utente:
    //
    // Blockchain errors are different from normal JavaScript errors. There are
    // specific categories that require different messages for the user:
    // =========================================================================
    console.error("[Deploy] Error:", error);

    // Errore wallet: la chiave privata è corrotta o inaccessibile
    // Wallet error: the private key is corrupted or inaccessible
    if (error.message?.includes("Wallet access failed") ||
        error.message?.includes("unable to authenticate") ||
        error.message?.includes("Unsupported state") ||
        error.message?.includes("corrupted")) {
      return {
        success: false,
        error: "Cannot access your wallet. Please create a new wallet from the Wallet menu."
      };
    }

    // Errore fondi: non abbastanza ETH per coprire gas + minting fee
    // Funds error: not enough ETH to cover gas + minting fee
    if (error.code === "INSUFFICIENT_FUNDS") {
      return {
        success: false,
        error: "Insufficient funds for transaction. Please add ETH to your wallet."
      };
    }

    // Errore contratto: la funzione è stata chiamata correttamente ma il contratto
    // ha rifiutato l'operazione (es. minting disabilitato, limite raggiunto, ecc.)
    // Contract error: the function was called correctly but the contract
    // rejected the operation (e.g. minting disabled, limit reached, etc.)
    if (error.code === "CALL_EXCEPTION" || error.reason) {
      return {
        success: false,
        error: `Transaction reverted: ${error.reason || "Contract rejected the transaction"}`
      };
    }

    // Errore generico — restituisci il messaggio più informativo disponibile
    // Generic error — return the most informative message available
    return {
      success: false,
      error: error.reason || error.message || "Transaction failed"
    };
  }
}
