import { InlineKeyboard } from "grammy";
import { getWalletManager } from "../wallet/index.js";
import { sessionStore, draftStore } from "../storage/index.js";
import { POKEMON_TYPES, RARITIES, TYPE_EMOJIS, CONTRACTS, NETWORK, MAX_IMAGE_SIZE_BYTES, MAX_NAME_LENGTH } from "../config.js";
import { generateStatsForRarity } from "../services/rarity.js";
import { downloadPhotoFromTelegram, uploadImageToPinata, uploadMetadataToPinata, buildNFTMetadata, sanitizeCardName, sanitizeForMetadata, sanitizeForMarkdown } from "../services/ipfs.js";
import { deployCardOnChain } from "../services/deploy.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import { bot } from "../bot/setup.js";
import type { MyContext, MyConversation } from "../types.js";

// =============================================================================
// CONVERSAZIONE CREAZIONE CARTA - Flusso guidato completo per creare una carta NFT
// CARD CREATION CONVERSATION - Complete guided flow to create an NFT card
//
// Questa e' la conversazione piu' importante del bot. Guida l'utente attraverso
// tutti i passaggi necessari per creare una carta Pokemon personalizzata come
// NFT sulla blockchain.
//
// This is the bot's most important conversation. It guides the user through
// all the steps needed to create a custom Pokemon card as an NFT on the
// blockchain.
//
// === COME FUNZIONANO LE CONVERSAZIONI grammY ===
// === HOW grammY CONVERSATIONS WORK ===
//
// Le conversazioni grammY permettono di scrivere flussi multi-step come
// funzioni async normali. Ogni volta che si chiama `conversation.wait()`,
// la funzione si "congela" e aspetta il prossimo messaggio dell'utente.
// Quando il messaggio arriva, la funzione riprende esattamente da dove
// si era fermata. Internamente, grammY usa un sistema di "replay":
// riesegue la funzione dall'inizio, ma salta tutti i wait() gia' risolti.
//
// grammY conversations allow writing multi-step flows as normal async
// functions. Each time `conversation.wait()` is called, the function
// "freezes" and waits for the user's next message. When the message
// arrives, the function resumes exactly where it stopped. Internally,
// grammY uses a "replay" system: it re-executes the function from the
// beginning but skips all already-resolved wait() calls.
//
// === FLUSSO DELLA CONVERSAZIONE (4 STEP) ===
// === CONVERSATION FLOW (4 STEPS) ===
//
// STEP 1: IMMAGINE - L'utente crea la carta su pokecardmaker.net,
//         fa uno screenshot e lo invia al bot.
//         IMAGE - User creates the card on pokecardmaker.net,
//         takes a screenshot and sends it to the bot.
//
// STEP 2: NOME - L'utente sceglie il nome della carta.
//         Validazione: lunghezza massima, caratteri permessi.
//         NAME - User chooses the card name.
//         Validation: max length, allowed characters.
//
// STEP 3: RARITA' - L'utente sceglie la rarita' tramite pulsanti inline.
//         Le statistiche vengono generate automaticamente in base alla rarita'.
//         RARITY - User chooses rarity via inline buttons.
//         Stats are auto-generated based on rarity.
//
// STEP 4: DEPLOY - Upload dell'immagine e dei metadati su IPFS (Pinata),
//         poi mint dell'NFT on-chain tramite il contratto PokeDEXCustomCards.
//         DEPLOY - Upload image and metadata to IPFS (Pinata),
//         then mint the NFT on-chain via the PokeDEXCustomCards contract.
//
// === GESTIONE ERRORI ===
// === ERROR HANDLING ===
//
// In ogni step, se l'utente fornisce input non valido o si verifica un
// errore, il draft viene salvato e l'utente puo' riprendere con /drafts.
// Questo evita di perdere il progresso in caso di problemi di rete,
// errori blockchain, o semplicemente se l'utente cambia idea.
//
// At every step, if the user provides invalid input or an error occurs,
// the draft is saved and the user can resume with /drafts. This prevents
// losing progress due to network issues, blockchain errors, or simply
// if the user changes their mind.
// =============================================================================

/**
 * Conversazione principale per la creazione di una carta NFT personalizzata.
 * Main conversation for creating a custom NFT card.
 *
 * Questa funzione viene registrata come conversazione grammY e puo' essere
 * avviata tramite ctx.conversation.enter("cardCreationConversation").
 * Gestisce l'intero flusso dall'immagine al deploy on-chain.
 *
 * This function is registered as a grammY conversation and can be started
 * via ctx.conversation.enter("cardCreationConversation"). It handles the
 * entire flow from image to on-chain deployment.
 *
 * @param conversation - L'oggetto conversazione grammY che gestisce il flusso.
 *                       The grammY conversation object that manages the flow.
 *                       Fornisce metodi come wait(), waitForCallbackQuery(), etc.
 *                       Provides methods like wait(), waitForCallbackQuery(), etc.
 * @param ctx - Il contesto Telegram del messaggio che ha avviato la conversazione.
 *              The Telegram context of the message that started the conversation.
 *              Contiene info sull'utente, chat, e metodi per rispondere.
 *              Contains user info, chat, and methods to reply.
 */
export async function cardCreationConversation(conversation: MyConversation, ctx: MyContext) {
  // ---------------------------------------------------------------------------
  // IDENTIFICAZIONE UTENTE - Recupero dati base dal contesto Telegram
  // USER IDENTIFICATION - Retrieve basic data from Telegram context
  //
  // ctx.from contiene i dati dell'utente che ha inviato il messaggio:
  // - id: ID numerico univoco Telegram (usato come chiave per wallet/sessione)
  // - username: @username Telegram (opzionale, l'utente puo' non averlo)
  // - first_name: Nome visualizzato dell'utente
  //
  // ctx.from contains the data of the user who sent the message:
  // - id: Unique Telegram numeric ID (used as key for wallet/session)
  // - username: @Telegram username (optional, user may not have one)
  // - first_name: User's display name
  // ---------------------------------------------------------------------------
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;

  if (!userId) {
    await ctx.reply("❌ Error: unable to identify user.");
    return;
  }

  // ---------------------------------------------------------------------------
  // VERIFICA WALLET - Controllo che l'utente abbia un wallet funzionante
  // WALLET VERIFICATION - Check that the user has a working wallet
  //
  // Per mintare un NFT serve un wallet Ethereum. Il bot usa wallet custodial:
  // il bot genera e gestisce la coppia chiave privata/pubblica per l'utente.
  // Controlliamo due cose:
  // 1. hasWallet(): Il wallet esiste? Se no, l'utente deve crearlo prima.
  // 2. verifyWalletIntegrity(): Il wallet e' accessibile e non corrotto?
  //    Puo' corrompersi se le chiavi di crittografia del bot cambiano.
  //
  // To mint an NFT, an Ethereum wallet is needed. The bot uses custodial
  // wallets: the bot generates and manages the private/public key pair for
  // the user. We check two things:
  // 1. hasWallet(): Does the wallet exist? If not, user must create it first.
  // 2. verifyWalletIntegrity(): Is the wallet accessible and not corrupted?
  //    It can become corrupted if the bot's encryption keys change.
  // ---------------------------------------------------------------------------
  const walletManager = getWalletManager();

  if (!walletManager.hasWallet(userId)) {
    await ctx.reply(
      "❌ *Wallet Required*\n\n" +
      "You need a wallet to mint cards. Creating one takes just a few seconds!\n\n" +
      "👇 *Click below to create your wallet:*",
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("👛 Create Wallet", "wallet_create")
      }
    );
    return;
  }

  const isWalletValid = await walletManager.verifyWalletIntegrity(userId);
  if (!isWalletValid) {
    await ctx.reply(
      "❌ *Wallet Access Error*\n\n" +
      "Your wallet data appears to be corrupted or inaccessible.\n\n" +
      "This can happen if:\n" +
      "• The bot was restarted with different encryption keys\n" +
      "• Wallet files were manually modified\n\n" +
      "👇 *Please create a new wallet to continue:*",
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("👛 Create New Wallet", "wallet_create")
      }
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // INIZIALIZZAZIONE SESSIONE E DRAFT - Creazione bozza carta
  // SESSION AND DRAFT INITIALIZATION - Card draft creation
  //
  // - sessionStore: Gestisce lo stato della sessione utente (stato corrente,
  //   draft attivo, etc.). / Manages user session state (current state,
  //   active draft, etc.).
  // - draftStore: Gestisce le bozze delle carte. Ogni bozza ha un ID univoco
  //   (UUID) e viene salvata su disco come file JSON.
  //   Manages card drafts. Each draft has a unique ID (UUID) and is saved
  //   to disk as a JSON file.
  // - setCurrentDraft(): Collega il draft alla sessione corrente dell'utente.
  //   Links the draft to the user's current session.
  // ---------------------------------------------------------------------------
  const userSession = sessionStore.getOrCreate(userId, username, firstName);
  const draft = draftStore.create(userId, username, firstName || username || "Creator");
  sessionStore.setCurrentDraft(userId, draft.draftId);

  // ========== STEP 1: Invia a CardMaker e aspetta immagine ==========
  // ========== STEP 1: Send to CardMaker and wait for image ==========
  //
  // L'utente viene indirizzato a pokecardmaker.net dove puo' creare
  // visualmente la propria carta Pokemon. Dopo aver creato la carta,
  // fa uno screenshot e lo invia come foto al bot.
  //
  // The user is directed to pokecardmaker.net where they can visually
  // create their own Pokemon card. After creating the card, they take
  // a screenshot and send it as a photo to the bot.
  //
  // conversation.wait() congela la funzione qui fino a quando l'utente
  // non invia un nuovo messaggio (foto, testo, o callback da pulsante).
  //
  // conversation.wait() freezes the function here until the user sends
  // a new message (photo, text, or button callback).
  // ---------------------------------------------------------------------------
  await ctx.reply(`🎨 *Create Your Pokemon Card!*

1️⃣ Create your card at the link below
2️⃣ When finished, screenshot/save the image
3️⃣ Send the image here

👇 *Click to open the card maker:*`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard()
      .url("🎨 Open PokeCardMaker", "https://pokecardmaker.net/create")
      .row()
      .text("❌ Cancel", "cancel_creation")
  });

  // Aspetta il prossimo messaggio dell'utente (foto o cancellazione)
  // Wait for the user's next message (photo or cancellation)
  const imageCtx = await conversation.wait();

  // Gestione cancellazione: l'utente ha premuto "Cancel"
  // Cancellation handling: user pressed "Cancel"
  if (imageCtx.callbackQuery?.data === "cancel_creation") {
    await imageCtx.answerCallbackQuery();
    draftStore.delete(userId, draft.draftId);
    await ctx.reply("❌ Creation cancelled.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // Verifica che il messaggio contenga una foto
  // Verify the message contains a photo
  // Telegram invia le foto come array di diverse risoluzioni.
  // Telegram sends photos as an array of different resolutions.
  if (!imageCtx.message?.photo) {
    await ctx.reply("❌ Please send an image of your card. Use /createcard to try again.");
    draftStore.delete(userId, draft.draftId);
    return;
  }

  // Prendiamo l'ultima foto dell'array (la piu' grande / massima risoluzione)
  // We take the last photo in the array (the largest / highest resolution)
  const photo = imageCtx.message.photo[imageCtx.message.photo.length - 1];

  // Controllo dimensione file: le immagini troppo grandi non possono essere
  // caricate su IPFS efficientemente e rallenterebbero il processo.
  // File size check: images that are too large cannot be uploaded to IPFS
  // efficiently and would slow down the process.
  if (photo.file_size && photo.file_size > MAX_IMAGE_SIZE_BYTES) {
    const sizeMB = (photo.file_size / (1024 * 1024)).toFixed(2);
    const maxMB = (MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    await ctx.reply(`❌ Image is too large (${sizeMB}MB). Maximum size is ${maxMB}MB. Please compress the image and try again.`);
    draftStore.delete(userId, draft.draftId);
    return;
  }

  // Salva il file_id di Telegram nel draft. Il file_id e' un riferimento
  // univoco al file sui server Telegram, non il file stesso.
  // Lo useremo piu' tardi per scaricare l'immagine effettiva.
  //
  // Save the Telegram file_id in the draft. The file_id is a unique
  // reference to the file on Telegram servers, not the file itself.
  // We will use it later to download the actual image.
  draft.imageTelegramFileId = photo.file_id;
  draft.imageSource = "telegram";
  draftStore.save(draft);

  await ctx.reply("✅ Image received! Processing...");

  // ========== STEP 2: Nome carta ==========
  // ========== STEP 2: Card name ==========
  //
  // L'utente inserisce il nome della propria carta Pokemon come testo.
  // Il nome viene validato per:
  // - Lunghezza massima (MAX_NAME_LENGTH caratteri)
  // - Caratteri permessi (sanitizeCardName rimuove caratteri pericolosi)
  //
  // The user enters their Pokemon card name as text.
  // The name is validated for:
  // - Maximum length (MAX_NAME_LENGTH characters)
  // - Allowed characters (sanitizeCardName removes dangerous characters)
  // ---------------------------------------------------------------------------
  await ctx.reply("📛 What's your Pokemon's name?");
  const nameCtx = await conversation.wait();

  if (!nameCtx.message?.text) {
    await ctx.reply("❌ No name provided. Draft saved, use /drafts to continue later.");
    return;
  }

  const rawName = nameCtx.message.text.trim();
  if (rawName.length > MAX_NAME_LENGTH) {
    await ctx.reply(`❌ Name too long (max ${MAX_NAME_LENGTH} characters). Please try again.`);
    return;
  }

  // sanitizeCardName(): Rimuove caratteri HTML, script injection, e altri
  // input pericolosi. Essenziale perche' il nome finira' nei metadati NFT
  // e potrebbe essere visualizzato su marketplace di terze parti.
  //
  // sanitizeCardName(): Removes HTML characters, script injection, and other
  // dangerous input. Essential because the name will end up in NFT metadata
  // and could be displayed on third-party marketplaces.
  try {
    draft.cardName = sanitizeCardName(rawName);
  } catch {
    await ctx.reply("❌ Invalid name. Please use letters, numbers, and basic punctuation only.");
    return;
  }

  draft.creatorName = sanitizeForMetadata(firstName || username || "Creator", MAX_NAME_LENGTH);
  draftStore.save(draft);

  // ========== STEP 3: Scegli rarita' ==========
  // ========== STEP 3: Choose rarity ==========
  //
  // L'utente sceglie la rarita' della carta tramite pulsanti inline.
  // La rarita' determina la potenza delle statistiche generate:
  // - Common (0): Statistiche base / Base stats
  // - Uncommon (1): Leggermente migliori / Slightly better
  // - Rare (2): Buone statistiche / Good stats
  // - Ultra Rare (3): Statistiche alte / High stats
  // - Legendary (4): Statistiche massime / Maximum stats
  //
  // The user chooses the card rarity via inline buttons.
  // Rarity determines the strength of generated stats.
  //
  // generateStatsForRarity() genera HP, Attack, Defense e Speed con un
  // certo range casuale basato sulla rarita'. Piu' alta la rarita', piu'
  // forti saranno le statistiche.
  //
  // generateStatsForRarity() generates HP, Attack, Defense and Speed with
  // a random range based on rarity. Higher rarity = stronger stats.
  //
  // Il tipo Pokemon viene assegnato casualmente (0-17, i 18 tipi Pokemon).
  // Pokemon type is assigned randomly (0-17, the 18 Pokemon types).
  //
  // waitForCallbackQuery() e' una versione specializzata di wait() che
  // aspetta solo callback da pulsanti inline che matchano il regex fornito.
  //
  // waitForCallbackQuery() is a specialized version of wait() that only
  // waits for inline button callbacks matching the provided regex.
  // ---------------------------------------------------------------------------
  const rarityKeyboard = new InlineKeyboard()
    .text("⚪ Common", "rarity_0")
    .text("🟢 Uncommon", "rarity_1")
    .row()
    .text("🔵 Rare", "rarity_2")
    .text("🟣 Ultra Rare", "rarity_3")
    .row()
    .text("🟡 Legendary", "rarity_4");

  await ctx.reply(`✨ Choose rarity for *${sanitizeForMarkdown(draft.cardName)}*

Stats will be auto-generated based on rarity!
Higher rarity = stronger stats.`, {
    parse_mode: "Markdown",
    reply_markup: rarityKeyboard
  });

  const rarityCtx = await conversation.waitForCallbackQuery(/^rarity_\d$/);
  await rarityCtx.answerCallbackQuery();

  // Estrai il numero di rarita' dal callback_data (es: "rarity_3" -> 3)
  // Extract rarity number from callback_data (e.g., "rarity_3" -> 3)
  const rarity = parseInt(rarityCtx.callbackQuery.data.split("_")[1]);
  draft.stats.rarity = rarity;

  // Genera statistiche casuali appropriate per la rarita' scelta
  // Generate random stats appropriate for the chosen rarity
  const generatedStats = generateStatsForRarity(rarity);
  draft.stats.hp = generatedStats.hp;
  draft.stats.attack = generatedStats.attack;
  draft.stats.defense = generatedStats.defense;
  draft.stats.speed = generatedStats.speed;

  // Tipo Pokemon casuale (0-17): Normal, Fire, Water, Grass, Electric, etc.
  // Random Pokemon type (0-17): Normal, Fire, Water, Grass, Electric, etc.
  draft.stats.pokemonType = Math.floor(Math.random() * 18);
  draftStore.save(draft);

  // Mostra riepilogo delle statistiche generate all'utente
  // Show generated stats summary to the user
  const type = POKEMON_TYPES[draft.stats.pokemonType];
  const typeEmoji = TYPE_EMOJIS[type] || "❓";
  const rarityInfo = RARITIES[rarity];

  await rarityCtx.editMessageText(`✅ *${draft.cardName}* - ${rarityInfo.emoji} ${rarityInfo.name}

${typeEmoji} Type: ${type} (random)
❤️ HP: ${draft.stats.hp} | ⚔️ ATK: ${draft.stats.attack}
🛡️ DEF: ${draft.stats.defense} | 💨 SPD: ${draft.stats.speed}`, { parse_mode: "Markdown" });

  // Royalty fissa al 5% (500 basis points) per il creatore
  // Fixed 5% royalty (500 basis points) for the creator
  // Questo significa che il creatore riceve il 5% su ogni vendita secondaria.
  // This means the creator receives 5% on every secondary sale.
  draft.royaltyPercentage = 500;
  draftStore.save(draft);

  // ========== STEP 4: Upload IPFS e deploy on-chain ==========
  // ========== STEP 4: Upload to IPFS and deploy on-chain ==========
  //
  // Questo e' lo step finale e piu' complesso. Avviene in 3 sotto-step:
  // This is the final and most complex step. It happens in 3 sub-steps:
  //
  // Sub-step 1/3: UPLOAD IMMAGINE SU IPFS
  //   - Scarichiamo l'immagine dai server Telegram usando il file_id
  //   - La carichiamo su IPFS tramite Pinata (servizio di pinning IPFS)
  //   - Otteniamo un hash CID che identifica permanentemente l'immagine
  //   Sub-step 1/3: IMAGE UPLOAD TO IPFS
  //   - Download the image from Telegram servers using the file_id
  //   - Upload it to IPFS via Pinata (IPFS pinning service)
  //   - Get a CID hash that permanently identifies the image
  //
  // Sub-step 2/3: CREAZIONE E UPLOAD METADATI
  //   - Costruiamo i metadati NFT standard (ERC-721 metadata)
  //   - Include: nome, descrizione, immagine IPFS, attributi (stats, tipo, rarita')
  //   - Li carichiamo su IPFS e otteniamo l'URI dei metadati
  //   Sub-step 2/3: METADATA CREATION AND UPLOAD
  //   - Build standard NFT metadata (ERC-721 metadata)
  //   - Includes: name, description, IPFS image, attributes (stats, type, rarity)
  //   - Upload to IPFS and get the metadata URI
  //
  // Sub-step 3/3: DEPLOY ON-CHAIN (MINT)
  //   - Chiamiamo il contratto PokeDEXCustomCards per mintare l'NFT
  //   - La transazione viene firmata dal wallet custodial dell'utente
  //   - Al successo, otteniamo il token ID e l'hash della transazione
  //   Sub-step 3/3: ON-CHAIN DEPLOY (MINT)
  //   - Call the PokeDEXCustomCards contract to mint the NFT
  //   - The transaction is signed by the user's custodial wallet
  //   - On success, we get the token ID and transaction hash
  //
  // Durante tutto il processo, aggiorniamo il messaggio di stato in tempo
  // reale per tenere l'utente informato sul progresso.
  //
  // Throughout the process, we update the status message in real time
  // to keep the user informed of the progress.
  // ---------------------------------------------------------------------------
  const statusMsg = await ctx.reply("📤 *Step 1/3:* Uploading image to IPFS...", { parse_mode: "Markdown" });

  try {
    // Sub-step 1/3: Download immagine da Telegram e upload su IPFS
    // Sub-step 1/3: Download image from Telegram and upload to IPFS
    const imageBuffer = await downloadPhotoFromTelegram(bot, draft.imageTelegramFileId!);

    // Genera un nome file univoco basato sul nome carta + parte dell'UUID del draft
    // Generate a unique filename based on card name + part of the draft UUID
    const fileName = `${draft.cardName.replace(/[^a-zA-Z0-9]/g, "_")}-${draft.draftId.slice(0, 8)}.png`;
    const imageHash = await uploadImageToPinata(imageBuffer, fileName);
    draft.ipfsImageHash = imageHash;
    draft.ipfsImageUrl = `ipfs://${imageHash}`;

    // Sub-step 2/3: Costruzione e upload metadati NFT
    // Sub-step 2/3: Build and upload NFT metadata
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
      "✅ *Step 1/3:* Image uploaded!\n📤 *Step 2/3:* Creating metadata...", { parse_mode: "Markdown" });

    const metadata = buildNFTMetadata(draft, imageHash);
    const metadataHash = await uploadMetadataToPinata(metadata, draft.cardName);
    draft.metadataUri = `ipfs://${metadataHash}`;
    draft.status = "uploading";
    draftStore.save(draft);

    // Sub-step 3/3: Deploy on-chain (mint dell'NFT)
    // Sub-step 3/3: On-chain deploy (NFT minting)
    draft.status = "minting";
    draftStore.save(draft);

    // Mostra pulsante "Refresh Status" per controllare il progresso
    // Show "Refresh Status" button to check progress
    const pendingKeyboard = new InlineKeyboard()
      .text("🔄 Refresh Status", `refresh_mint_${draft.draftId}`)
      .row()
      .text("❌ Cancel", "main_menu");

    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
      `✅ *Step 1/3:* Image uploaded!
✅ *Step 2/3:* Metadata created!
🚀 *Step 3/3:* Deploying on-chain...

⏳ *Waiting for blockchain confirmation...*

_Click "Refresh Status" to check progress_`,
      { parse_mode: "Markdown", reply_markup: pendingKeyboard });

    // deployCardOnChain() firma e invia la transazione di mint
    // deployCardOnChain() signs and sends the mint transaction
    const deployResult = await deployCardOnChain(draft);

    // ---------------------------------------------------------------------------
    // GESTIONE RISULTATO DEPLOY - Successo o fallimento
    // DEPLOY RESULT HANDLING - Success or failure
    // ---------------------------------------------------------------------------
    if (deployResult.success) {
      // Aggiorna il draft con i dati della transazione riuscita
      // Update the draft with successful transaction data
      draft.status = "minted";
      draft.mintTxHash = deployResult.txHash;
      draft.mintedTokenId = deployResult.tokenId;
      draft.mintedContractAddress = CONTRACTS.CUSTOM_CARDS;
      draft.mintedAt = Date.now();
      draftStore.save(draft);

      const type = POKEMON_TYPES[draft.stats.pokemonType];
      const typeEmoji = TYPE_EMOJIS[type] || "❓";
      const rarityInfo = RARITIES[draft.stats.rarity];

      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
        `✅ *CARD DEPLOYED!*`, { parse_mode: "Markdown" });

      // Tastiera con link alla transazione su Etherscan + azioni post-mint
      // Keyboard with Etherscan transaction link + post-mint actions
      const successKeyboard = new InlineKeyboard()
        .url("🔍 View on Etherscan", `${NETWORK.explorer}/tx/${deployResult.txHash}`)
        .row()
        .text("🎴 My Cards", "action_my_cards")
        .text("🏠 Menu", "main_menu");

      await ctx.reply(`🎉 *${sanitizeForMarkdown(draft.cardName)}* is now an NFT!

${rarityInfo.emoji} *Rarity:* ${rarityInfo.name}
${typeEmoji} *Type:* ${type}
❤️ HP: ${draft.stats.hp} | ⚔️ ATK: ${draft.stats.attack}
🛡️ DEF: ${draft.stats.defense} | 💨 SPD: ${draft.stats.speed}

🆔 *Token ID:* #${deployResult.tokenId || "pending"}
📜 *TX:* \`${deployResult.txHash?.slice(0, 20)}...\`

🛒 Ready to sell? Use the Marketplace to list your card!`, {
        parse_mode: "Markdown",
        reply_markup: successKeyboard
      });

    } else {
      // Deploy fallito: salva l'errore e informa l'utente
      // Deploy failed: save the error and inform the user
      // Il draft resta salvato per poter riprovare con /drafts
      // The draft remains saved to retry with /drafts
      draft.status = "failed";
      draft.errorMessage = deployResult.error;
      draftStore.save(draft);

      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
        `❌ *Deploy failed*\n\n${deployResult.error}`, { parse_mode: "Markdown" });

      await ctx.reply("Your draft is saved. Try again later with /drafts.", {
        reply_markup: getMainMenuKeyboard()
      });
    }

  } catch (error: any) {
    // Errore generico (rete, IPFS, blockchain, etc.)
    // Generic error (network, IPFS, blockchain, etc.)
    console.error("Card creation error:", error);
    draft.status = "failed";
    draft.errorMessage = error.message;
    draftStore.save(draft);

    await ctx.reply(`❌ *Error:* ${error.message}\n\nYour draft is saved. Try /drafts later.`, {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard()
    });
  }
}
