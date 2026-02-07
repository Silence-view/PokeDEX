import { InlineKeyboard } from "grammy";
import { ethers } from "ethers";
import { getWalletManager, marketplaceRateLimiter } from "../wallet/index.js";
import { sessionStore } from "../storage/index.js";
import { CONTRACTS, RARITIES, NETWORK } from "../config.js";
import { provider, marketplaceWritable, customCardsContract } from "../contracts/provider.js";
import { MARKETPLACE_ABI } from "../contracts/abis.js";
import { fetchNFTMetadata } from "../services/ipfs.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import type { MyContext, MyConversation } from "../types.js";

// =============================================================================
// CONVERSAZIONE VENDITA CARTA SELEZIONATA - Vendere una carta pre-selezionata
// LIST SELECTED CARD CONVERSATION - Sell a pre-selected card
//
// Questa conversazione gestisce la vendita di carte che sono gia' on-chain
// e il cui token ID e' stato pre-selezionato dall'utente tramite il menu
// "My Cards". A differenza di listCardConversation (che parte dal draftStore),
// questa conversazione:
//
// This conversation handles the sale of cards that are already on-chain
// and whose token ID has been pre-selected by the user via the "My Cards"
// menu. Unlike listCardConversation (which starts from the draftStore),
// this conversation:
//
// 1. Recupera il token ID dalla sessione (session.pendingCardSell)
//    Retrieves the token ID from the session (session.pendingCardSell)
//
// 2. Carica i dati della carta direttamente dalla blockchain
//    Loads card data directly from the blockchain
//    (stats, nome dai metadati IPFS, stato banned)
//    (stats, name from IPFS metadata, banned status)
//
// 3. Chiede il prezzo e procede con approval + listing
//    Asks for price and proceeds with approval + listing
//
// === DIFFERENZA CON listCardConversation ===
// === DIFFERENCE FROM listCardConversation ===
//
// - listCardConversation: Parte dal draftStore locale. L'utente seleziona
//   tra i draft con status "minted". I dati della carta vengono dal draft.
//   Starts from local draftStore. User selects from drafts with "minted"
//   status. Card data comes from the draft.
//
// - listSelectedCardConversation (questo file): Parte da un token ID gia'
//   selezionato. I dati della carta vengono direttamente dalla blockchain
//   (getCardStats, tokenURI) e da IPFS (metadati). Piu' affidabile perche'
//   i dati sono sempre aggiornati, ma richiede piu' chiamate RPC.
//   Starts from an already-selected token ID. Card data comes directly
//   from the blockchain (getCardStats, tokenURI) and IPFS (metadata).
//   More reliable because data is always up-to-date, but requires more
//   RPC calls.
//
// === FLUSSO DETTAGLIATO ===
// === DETAILED FLOW ===
//
// 1. Recupera tokenId dalla sessione e lo cancella (one-time use)
//    Get tokenId from session and delete it (one-time use)
// 2. Verifica ownership on-chain con ownerOf()
//    Verify on-chain ownership with ownerOf()
// 3. Carica stats, stato banned, e metadati IPFS in parallelo
//    Load stats, banned status, and IPFS metadata in parallel
// 4. Chiedi prezzo all'utente (con validazione in loop)
//    Ask user for price (with loop validation)
// 5. Mostra conferma con riepilogo
//    Show confirmation with summary
// 6. Esegui approval + listing on-chain
//    Execute approval + listing on-chain
// =============================================================================

/**
 * Conversazione per vendere una carta a partire dal token ID in sessione.
 * Conversation for selling a card starting from the token ID in session.
 *
 * Questa conversazione viene avviata dopo che l'utente ha selezionato "Sell"
 * su una delle proprie carte dal menu "My Cards". Il token ID della carta
 * selezionata viene salvato in session.pendingCardSell prima di entrare
 * in questa conversazione.
 *
 * This conversation is started after the user selected "Sell" on one of
 * their cards from the "My Cards" menu. The token ID of the selected card
 * is saved in session.pendingCardSell before entering this conversation.
 *
 * @param conversation - L'oggetto conversazione grammY per il flusso multi-step.
 *                       The grammY conversation object for the multi-step flow.
 * @param ctx - Il contesto Telegram con dati utente e metodi di risposta.
 *              The Telegram context with user data and reply methods.
 */
export async function listSelectedCardConversation(conversation: MyConversation, ctx: MyContext) {
  console.log("[Sell] Conversation started");

  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("❌ Error: unable to identify user.");
    return;
  }

  console.log(`[Sell] User ID: ${userId}`);

  // ---------------------------------------------------------------------------
  // RATE LIMITING - Protezione contro operazioni marketplace troppo frequenti
  // RATE LIMITING - Protection against too frequent marketplace operations
  //
  // Stesso rate limiter di listCardConversation. Condiviso tra tutte le
  // operazioni marketplace per evitare che un utente spammi transazioni.
  //
  // Same rate limiter as listCardConversation. Shared across all marketplace
  // operations to prevent a user from spamming transactions.
  // ---------------------------------------------------------------------------
  // conversation.external() impedisce che il rate limiter venga ri-eseguito
  // durante il replay della conversazione grammY, evitando falsi blocchi.
  // conversation.external() prevents the rate limiter from re-executing
  // during grammY conversation replay, avoiding false blocks.
  const rateLimitResult = await conversation.external(() =>
    marketplaceRateLimiter.isAllowed(userId.toString())
  );
  if (!rateLimitResult.allowed) {
    const waitTime = Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000);
    await ctx.reply(`⏳ Too many marketplace operations. Please wait ${waitTime} seconds.`, {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // VERIFICA CONTRATTI - Marketplace e contratto carte devono esistere
  // CONTRACT VERIFICATION - Marketplace and cards contract must exist
  // ---------------------------------------------------------------------------
  if (!marketplaceWritable || !customCardsContract) {
    await ctx.reply("❌ Marketplace or contracts not properly configured.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // RECUPERO TOKEN ID DALLA SESSIONE - One-time use
  // RETRIEVE TOKEN ID FROM SESSION - One-time use
  //
  // Il token ID viene salvato in sessione dal handler del pulsante "Sell"
  // nel menu "My Cards" (in un altro file). Lo recuperiamo e lo cancelliamo
  // immediatamente per evitare che venga riutilizzato accidentalmente.
  //
  // The token ID is saved in session by the "Sell" button handler
  // in the "My Cards" menu (in another file). We retrieve it and delete
  // it immediately to prevent accidental reuse.
  // ---------------------------------------------------------------------------
  // CRITICO: conversation.external() e' OBBLIGATORIO qui.
  // Senza di esso, il replay di grammY ri-esegue sessionStore.get() dopo che
  // pendingCardSell e' stato cancellato, causando "No card selected" e bloccando
  // l'intero flusso di vendita. conversation.external() cachea il risultato
  // e lo restituisce durante i replay successivi senza ri-eseguire la funzione.
  //
  // CRITICAL: conversation.external() is MANDATORY here.
  // Without it, grammY's replay re-executes sessionStore.get() after
  // pendingCardSell has been deleted, causing "No card selected" and blocking
  // the entire sell flow. conversation.external() caches the result
  // and returns it during subsequent replays without re-executing the function.
  const tokenId = await conversation.external(() => {
    const session = sessionStore.get(userId);
    const tid = session?.pendingCardSell;
    if (session && tid) {
      delete session.pendingCardSell;
      sessionStore.save(session);
    }
    return tid;
  });

  if (!tokenId) {
    await ctx.reply("❌ No card selected for sale.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // ---------------------------------------------------------------------------
  // VERIFICA WALLET - Controlli di integrita' del wallet custodial
  // WALLET VERIFICATION - Custodial wallet integrity checks
  // ---------------------------------------------------------------------------
  // conversation.external() evita verifiche wallet ridondanti durante il replay.
  // conversation.external() avoids redundant wallet checks during replay.
  const walletStatus = await conversation.external(async () => {
    const wm = getWalletManager();
    if (!wm.hasWallet(userId)) return "no_wallet";
    const valid = await wm.verifyWalletIntegrity(userId);
    return valid ? "ok" : "invalid";
  });

  if (walletStatus === "no_wallet") {
    await ctx.reply("❌ No wallet available for signing transactions.", { reply_markup: getMainMenuKeyboard() });
    return;
  }
  if (walletStatus === "invalid") {
    await ctx.reply(
      "❌ *Wallet Access Error*\n\nYour wallet data is inaccessible. Please create a new wallet from the Wallet menu.",
      { parse_mode: "Markdown", reply_markup: getMainMenuKeyboard() }
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // CARICAMENTO DATI CARTA DALLA BLOCKCHAIN - Ownership + Stats + Metadati
  // LOADING CARD DATA FROM BLOCKCHAIN - Ownership + Stats + Metadata
  //
  // Questa sezione effettua diverse chiamate alla blockchain e a IPFS
  // per raccogliere tutte le informazioni sulla carta:
  //
  // This section makes several calls to the blockchain and IPFS
  // to gather all information about the card:
  //
  // 1. ownerOf(tokenId): Verifica che l'utente possieda ancora la carta
  //    Verifies that the user still owns the card
  //
  // 2. Promise.all() per 3 chiamate parallele (ottimizzazione performance):
  //    Promise.all() for 3 parallel calls (performance optimization):
  //    a. getCardStats(tokenId): Statistiche on-chain (rarita', HP, ATK, etc.)
  //       On-chain stats (rarity, HP, ATK, etc.)
  //    b. isBanned(tokenId): Se la carta e' stata bannata (contenuto inappropriato)
  //       Whether the card was banned (inappropriate content)
  //    c. tokenURI(tokenId): URI dei metadati IPFS (nome, immagine, etc.)
  //       IPFS metadata URI (name, image, etc.)
  //
  // 3. fetchNFTMetadata(tokenURI): Scarica i metadati da IPFS per il nome
  //    Downloads metadata from IPFS for the name
  // ---------------------------------------------------------------------------
  const loadingMsg = await ctx.reply(`🔄 *Loading Card #${tokenId}...*`, { parse_mode: "Markdown" });

  // Tutte le chiamate blockchain e IPFS sono wrappate in conversation.external()
  // per evitare ri-esecuzioni inutili (e potenzialmente costose) durante il replay.
  // All blockchain and IPFS calls are wrapped in conversation.external()
  // to avoid unnecessary (and potentially expensive) re-executions during replay.
  const cardData = await conversation.external(async () => {
    try {
      const wm = getWalletManager();
      const userSigner = await wm.getSigner(userId);

      // Verifica ownership on-chain / Verify on-chain ownership
      try {
        const owner = await customCardsContract!.ownerOf(tokenId);
        if (owner.toLowerCase() !== userSigner.address.toLowerCase()) {
          return { error: "not_owner" as const };
        }
      } catch (ownerError: any) {
        console.error(`[Sell] ownerOf(${tokenId}) failed:`, ownerError.message);
        return { error: "not_found" as const };
      }

      // Carica stats, stato banned e tokenURI in parallelo
      // Load stats, banned status and tokenURI in parallel
      const [stats, isBanned, tokenURI] = await Promise.all([
        customCardsContract!.getCardStats(tokenId),
        customCardsContract!.isBanned(tokenId),
        customCardsContract!.tokenURI(tokenId).catch(() => null)
      ]);

      if (isBanned) return { error: "banned" as const };

      // Costruisci nome dalla rarita' / Build name from rarity
      const rarity = RARITIES[Number(stats.rarity)] || RARITIES[0];
      let cardName = `${rarity.emoji} Card #${tokenId}`;
      let imageUrl: string | undefined;

      // Prova metadati IPFS per nome descrittivo / Try IPFS metadata for descriptive name
      if (tokenURI) {
        try {
          const metadata = await fetchNFTMetadata(tokenURI);
          if (metadata) {
            cardName = metadata.name || cardName;
            imageUrl = metadata.image;
          }
        } catch {}
      }

      return { error: null, cardName, imageUrl, signerAddress: userSigner.address };
    } catch (error) {
      console.error("Error fetching card stats:", error);
      return { error: "fetch_failed" as const };
    }
  });

  // Rimuovi il messaggio "Loading..."
  // Remove the "Loading..." message
  await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

  if (cardData.error === "not_owner") {
    await ctx.reply("❌ You no longer own this card. It may have been transferred or minted on a previous contract.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }
  if (cardData.error === "not_found") {
    await ctx.reply("❌ Card not found on the current contract. It may have been minted on a previous contract deployment.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }
  if (cardData.error === "banned") {
    await ctx.reply("❌ This card is banned and cannot be listed on the marketplace.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }
  if (cardData.error) {
    await ctx.reply("❌ Could not fetch card information.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  const { cardName } = cardData;

  // ---------------------------------------------------------------------------
  // INSERIMENTO PREZZO - Input utente con validazione
  // PRICE INPUT - User input with validation
  //
  // Come in listCardConversation, l'utente digita il prezzo in ETH.
  // Supportiamo anche la virgola come separatore decimale
  // (es: "0,05" viene normalizzato a "0.05") per utenti europei/italiani.
  //
  // As in listCardConversation, the user types the price in ETH.
  // We also support comma as decimal separator
  // (e.g., "0,05" is normalized to "0.05") for European/Italian users.
  //
  // L'utente puo' anche cancellare premendo il pulsante "Cancel".
  // The user can also cancel by pressing the "Cancel" button.
  // ---------------------------------------------------------------------------
  await ctx.reply(`💰 *Sell ${cardName}*\n\nEnter price in ETH (e.g.: 0.01, 0.05, 0.1):`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("❌ Cancel", "cancel_selected_listing")
  });

  let priceInEth: string = "";
  let validPrice = false;

  while (!validPrice) {
    const priceCtx = await conversation.wait();

    // Gestione cancellazione tramite pulsante inline
    // Cancellation handling via inline button
    if (priceCtx.callbackQuery?.data === "cancel_selected_listing") {
      await priceCtx.answerCallbackQuery();
      await ctx.reply("❌ Listing cancelled.", { reply_markup: getMainMenuKeyboard() });
      return;
    }

    // Ignora altri callback (pulsanti di messaggi precedenti)
    // Ignore other callbacks (buttons from previous messages)
    if (priceCtx.callbackQuery) {
      await priceCtx.answerCallbackQuery("Please enter a price in the chat").catch(() => {});
      continue;
    }

    // Ignora messaggi senza testo (foto, sticker, etc.)
    // Ignore messages without text (photos, stickers, etc.)
    if (!priceCtx.message?.text) {
      continue;
    }

    // Normalizza: rimuovi spazi e sostituisci virgola con punto
    // Normalize: trim spaces and replace comma with dot
    const priceText = priceCtx.message.text.trim().replace(",", ".");
    const price = parseFloat(priceText);

    console.log(`[Sell] User entered: "${priceCtx.message.text}", normalized: "${priceText}", parsed: ${price}`);

    if (!isNaN(price) && price > 0 && price < 1000) {
      priceInEth = price.toString();
      validPrice = true;
      console.log(`[Sell] Valid price: ${priceInEth} ETH`);
    } else {
      await ctx.reply("❌ Invalid price. Enter a number like: 0.01, 0.05, 0.1");
    }
  }

  // Converti prezzo da ETH a Wei con ethers.parseEther
  // Convert price from ETH to Wei with ethers.parseEther
  // parseEther gestisce correttamente la precisione a 18 decimali
  // parseEther correctly handles 18-decimal precision
  let priceWei: bigint;
  try {
    priceWei = ethers.parseEther(priceInEth);
    console.log(`[Sell] Price in wei: ${priceWei.toString()}`);
  } catch (parseError) {
    console.error("[Sell] Error parsing price to wei:", parseError);
    await ctx.reply("❌ Error processing price. Please try again.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // ---------------------------------------------------------------------------
  // CONFERMA LISTING - Riepilogo con pulsanti Conferma/Annulla
  // LISTING CONFIRMATION - Summary with Confirm/Cancel buttons
  // ---------------------------------------------------------------------------
  const confirmKeyboard = new InlineKeyboard()
    .text("✅ Confirm Listing", "confirm_selected_list")
    .row()
    .text("❌ Cancel", "cancel_selected_list");

  await ctx.reply(
    `📋 *Confirm Listing*

🎴 *Card:* ${cardName}
🆔 *Token ID:* #${tokenId}
💰 *Price:* ${priceInEth} ETH

Proceed with listing?`,
    { parse_mode: "Markdown", reply_markup: confirmKeyboard }
  );

  const confirmCtx = await conversation.waitForCallbackQuery(/^(confirm_selected_list|cancel_selected_list)$/);
  await confirmCtx.answerCallbackQuery();

  if (confirmCtx.callbackQuery.data === "cancel_selected_list") {
    await ctx.reply("❌ Listing cancelled.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // ---------------------------------------------------------------------------
  // ESECUZIONE TRANSAZIONI ON-CHAIN - Approval + Listing
  // ON-CHAIN TRANSACTION EXECUTION - Approval + Listing
  //
  // Stesso pattern di listCardConversation: prima approval (se necessario),
  // poi listing. Vedi i commenti in list-card.ts per spiegazioni dettagliate
  // sul perche' servono 2 transazioni (ERC-721 approval pattern).
  //
  // Same pattern as listCardConversation: first approval (if needed),
  // then listing. See comments in list-card.ts for detailed explanations
  // on why 2 transactions are needed (ERC-721 approval pattern).
  // ---------------------------------------------------------------------------
  await confirmCtx.editMessageText("🔄 *Processing listing...*\n\nStep 1/2: Approving marketplace...", { parse_mode: "Markdown" });

  try {
    // Ri-verifica wallet (puo' essere passato tempo dall'inizio)
    // Re-verify wallet (time may have passed since the beginning)
    const walletManager = getWalletManager();
    if (!walletManager.hasWallet(userId)) {
      await ctx.reply("❌ No wallet available for signing transactions.", { reply_markup: getMainMenuKeyboard() });
      return;
    }

    const isWalletValid = await walletManager.verifyWalletIntegrity(userId);
    if (!isWalletValid) {
      await ctx.reply(
        "❌ *Wallet Access Error*\n\nYour wallet data is inaccessible. Please create a new wallet from the Wallet menu.",
        { parse_mode: "Markdown", reply_markup: getMainMenuKeyboard() }
      );
      return;
    }

    const userSigner = await walletManager.getSigner(userId);
    if (!userSigner) {
      await ctx.reply("❌ Could not access wallet signer.", { reply_markup: getMainMenuKeyboard() });
      return;
    }

    // Ri-verifica ownership (la carta potrebbe essere stata trasferita
    // durante l'attesa dell'input prezzo dell'utente)
    // Re-verify ownership (the card might have been transferred
    // while waiting for the user's price input)
    try {
      const owner = await customCardsContract!.ownerOf(tokenId);
      if (owner.toLowerCase() !== userSigner.address.toLowerCase()) {
        await ctx.reply("❌ You no longer own this card. It may have been transferred.", {
          reply_markup: getMainMenuKeyboard()
        });
        return;
      }
    } catch {
      await ctx.reply("❌ Could not verify card ownership.", { reply_markup: getMainMenuKeyboard() });
      return;
    }

    const nftContract = CONTRACTS.CUSTOM_CARDS;

    // -------------------------------------------------------------------------
    // STEP 1/2: APPROVAL - Autorizzazione marketplace
    // STEP 1/2: APPROVAL - Marketplace authorization
    //
    // Controlla se il marketplace e' gia' approvato. Se no, invia la
    // transazione di approvazione. Se la transazione fallisce (status !== 1),
    // interrompi il processo.
    //
    // Check if marketplace is already approved. If not, send the approval
    // transaction. If the transaction fails (status !== 1), abort the process.
    // -------------------------------------------------------------------------
    const approvalABI = ["function isApprovedForAll(address owner, address operator) view returns (bool)"];
    const nftForCheck = new ethers.Contract(nftContract, approvalABI, provider);
    const isApproved = await nftForCheck.isApprovedForAll(userSigner.address, CONTRACTS.MARKETPLACE);

    if (!isApproved) {
      const approveABI = ["function setApprovalForAll(address operator, bool approved)"];
      const nftForApprove = new ethers.Contract(nftContract, approveABI, userSigner);

      const approveTx = await nftForApprove.setApprovalForAll(CONTRACTS.MARKETPLACE, true);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt.status !== 1) {
        await ctx.reply("❌ Marketplace approval transaction failed. Please try again.", { reply_markup: getMainMenuKeyboard() });
        return;
      }
      console.log("Marketplace approved for user:", userSigner.address);
    }

    // -------------------------------------------------------------------------
    // STEP 2/2: LISTING - Creazione listing sul marketplace
    // STEP 2/2: LISTING - Create listing on the marketplace
    //
    // Chiama listNFT() sul contratto marketplace deployato (versione a 3 parametri).
    // Il contratto deployato non accetta imageURI come parametro.
    //
    // Calls listNFT() on the deployed marketplace contract (3-parameter version).
    // The deployed contract does not accept imageURI as a parameter.
    // -------------------------------------------------------------------------
    await confirmCtx.editMessageText("🔄 *Processing listing...*\n\n✅ Step 1/2: Marketplace approved!\n🔄 Step 2/2: Creating listing...", { parse_mode: "Markdown" });

    const marketplaceWithSigner = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, userSigner);

    const listTx = await marketplaceWithSigner.listNFT(nftContract, tokenId, priceWei);
    const receipt = await listTx.wait();

    // Cerca l'evento NFTListed nei log per ottenere il listing ID
    // Search for NFTListed event in logs to get the listing ID
    let listingId: number | undefined;
    for (const log of receipt.logs) {
      try {
        const parsed = marketplaceWithSigner.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });
        if (parsed?.name === "NFTListed") {
          listingId = Number(parsed.args[0]);
          break;
        }
      } catch {}
    }

    // Messaggio di successo finale con link Etherscan e navigazione
    // Final success message with Etherscan link and navigation
    const successKeyboard = new InlineKeyboard()
      .url("🔍 View Transaction", `${NETWORK.explorer}/tx/${listTx.hash}`)
      .row()
      .text("📋 My Listings", "action_my_listings")
      .text("🏠 Menu", "main_menu");

    await confirmCtx.editMessageText(
      `✅ *Card Listed Successfully!*

🎴 *Card:* ${cardName}
💰 *Price:* ${priceInEth} ETH
🆔 *Listing ID:* #${listingId || "pending"}
📜 *TX:* \`${listTx.hash.slice(0, 20)}...\`

Your card is now live on the marketplace!`,
      { parse_mode: "Markdown", reply_markup: successKeyboard }
    );

  } catch (error: any) {
    // Errore generico durante le transazioni (gas insufficiente, revert, rete, etc.)
    // Generic error during transactions (insufficient gas, revert, network, etc.)
    console.error("Card listing error:", error);
    const errMsg = (error.reason || error.message || "Transaction failed").replace(/[*_`\[]/g, "");
    await ctx.reply(`❌ *Listing Failed*\n\n${errMsg}`, {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard()
    });
  }
}
