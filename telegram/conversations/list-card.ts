import { InlineKeyboard } from "grammy";
import { ethers } from "ethers";
import { getWalletManager, marketplaceRateLimiter } from "../wallet/index.js";
import { draftStore } from "../storage/index.js";
import { CONTRACTS, RARITIES, NETWORK } from "../config.js";
import { provider, marketplaceWritable, customCardsWritable, customCardsContract } from "../contracts/provider.js";
import { MARKETPLACE_ABI } from "../contracts/abis.js";
import { fetchNFTMetadata } from "../services/ipfs.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import type { MyContext, MyConversation } from "../types.js";

// =============================================================================
// CONVERSAZIONE VENDITA CARTA - Flusso per mettere in vendita una carta custom
// LIST CARD CONVERSATION - Flow to list a card for sale
//
// Questa conversazione guida l'utente nel processo di mettere in vendita
// una carta NFT che ha creato precedentemente. La carta deve essere gia'
// stata mintata (status "minted") e l'utente deve ancora possederla.
//
// This conversation guides the user through the process of listing
// an NFT card they previously created for sale. The card must have
// already been minted (status "minted") and the user must still own it.
//
// === FLUSSO DELLA CONVERSAZIONE ===
// === CONVERSATION FLOW ===
//
// 1. CONTROLLI PRELIMINARI: Rate limit, wallet, contratti configurati
//    PRELIMINARY CHECKS: Rate limit, wallet, contracts configured
//
// 2. SELEZIONE CARTA: Mostra le carte mintate dell'utente come pulsanti
//    CARD SELECTION: Shows user's minted cards as buttons
//
// 3. VERIFICA OWNERSHIP ON-CHAIN: Chiama ownerOf() sul contratto NFT
//    per assicurarsi che l'utente possieda ancora la carta
//    ON-CHAIN OWNERSHIP VERIFICATION: Calls ownerOf() on the NFT contract
//    to make sure the user still owns the card
//
// 4. INSERIMENTO PREZZO: L'utente digita il prezzo in ETH
//    PRICE INPUT: User types the price in ETH
//
// 5. CONFERMA: Riepilogo e conferma prima di procedere
//    CONFIRMATION: Summary and confirmation before proceeding
//
// 6. TRANSAZIONI ON-CHAIN (2 step):
//    ON-CHAIN TRANSACTIONS (2 steps):
//    a. APPROVAL: Autorizza il contratto Marketplace a trasferire l'NFT
//       APPROVAL: Authorize the Marketplace contract to transfer the NFT
//    b. LISTING: Crea la listing sul marketplace con prezzo e immagine
//       LISTING: Create the listing on marketplace with price and image
//
// === PERCHE' SERVONO 2 TRANSAZIONI? ===
// === WHY ARE 2 TRANSACTIONS NEEDED? ===
//
// Nello standard ERC-721, un contratto esterno (il marketplace) non puo'
// trasferire un NFT a meno che il proprietario non lo abbia prima
// "approvato" (setApprovalForAll). Questo e' un meccanismo di sicurezza:
// - Step 1 (Approval): "Autorizzo il marketplace a spostare i miei NFT"
// - Step 2 (Listing): "Metti questa specifica carta in vendita a X ETH"
//
// In the ERC-721 standard, an external contract (the marketplace) cannot
// transfer an NFT unless the owner first "approved" it (setApprovalForAll).
// This is a security mechanism:
// - Step 1 (Approval): "I authorize the marketplace to move my NFTs"
// - Step 2 (Listing): "Put this specific card for sale at X ETH"
// =============================================================================

/**
 * Conversazione per mettere in vendita una carta NFT dal draftStore.
 * Conversation for listing an NFT card for sale from the draftStore.
 *
 * Questa conversazione viene usata quando l'utente vuole vendere una carta
 * che ha creato tramite il bot (presente nel draftStore con status "minted").
 * Per carte gia' on-chain non presenti nel draftStore, vedi listSelectedCardConversation.
 *
 * This conversation is used when the user wants to sell a card they created
 * through the bot (present in draftStore with "minted" status). For cards
 * already on-chain not in the draftStore, see listSelectedCardConversation.
 *
 * @param conversation - L'oggetto conversazione grammY per gestire il flusso multi-step.
 *                       The grammY conversation object to manage the multi-step flow.
 * @param ctx - Il contesto Telegram con info utente e metodi di risposta.
 *              The Telegram context with user info and reply methods.
 */
export async function listCardConversation(conversation: MyConversation, ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("❌ Error: unable to identify user.");
    return;
  }

  // ---------------------------------------------------------------------------
  // RATE LIMITING MARKETPLACE - Protezione contro operazioni troppo frequenti
  // MARKETPLACE RATE LIMITING - Protection against too frequent operations
  //
  // Questo rate limiter e' separato da quello dei messaggi (in setup.ts).
  // Limita specificamente le operazioni marketplace (listing, buying, etc.)
  // per prevenire spam di transazioni blockchain che costerebbero gas.
  //
  // This rate limiter is separate from the message one (in setup.ts).
  // It specifically limits marketplace operations (listing, buying, etc.)
  // to prevent spamming blockchain transactions that would cost gas.
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
  // VERIFICA CONTRATTI - I contratti smart devono essere configurati
  // CONTRACT VERIFICATION - Smart contracts must be configured
  //
  // marketplaceWritable e customCardsWritable sono istanze dei contratti
  // connesse con un signer che puo' scrivere (inviare transazioni).
  // Se non sono configurati, il bot non puo' interagire con la blockchain.
  //
  // marketplaceWritable and customCardsWritable are contract instances
  // connected with a signer that can write (send transactions).
  // If not configured, the bot cannot interact with the blockchain.
  // ---------------------------------------------------------------------------
  if (!marketplaceWritable || !customCardsContract) {
    await ctx.reply("❌ Marketplace or contracts not properly configured.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // VERIFICA WALLET - L'utente deve avere un wallet funzionante
  // WALLET VERIFICATION - User must have a working wallet
  // ---------------------------------------------------------------------------
  // conversation.external() impedisce che la verifica wallet venga ri-eseguita
  // durante il replay grammY. Ritorna un codice stato per gestire i casi d'errore.
  // conversation.external() prevents wallet verification from re-executing
  // during grammY replay. Returns a status code to handle error cases.
  const walletStatus = await conversation.external(async () => {
    const wm = getWalletManager();
    if (!wm.hasWallet(userId)) return "no_wallet";
    const valid = await wm.verifyWalletIntegrity(userId);
    return valid ? "ok" : "invalid";
  });
  if (walletStatus === "no_wallet") {
    await ctx.reply("❌ Please create a wallet first to list cards on the marketplace.", {
      reply_markup: new InlineKeyboard().text("💼 Create Wallet", "wallet_create").row().text("🏠 Menu", "main_menu")
    });
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
  // SELEZIONE CARTA - Mostra le carte mintate disponibili per la vendita
  // CARD SELECTION - Show minted cards available for sale
  //
  // Filtra i draft dell'utente per trovare quelli con status "minted":
  // - status === "minted": La carta e' stata deployata con successo
  // - mintedTokenId !== undefined: Ha un token ID on-chain valido
  // - mintedContractAddress corrisponde al contratto corrente
  //   (potrebbe essere diverso se il contratto e' stato ri-deployato)
  //
  // Filters user's drafts to find those with "minted" status:
  // - status === "minted": Card was successfully deployed
  // - mintedTokenId !== undefined: Has a valid on-chain token ID
  // - mintedContractAddress matches the current contract
  //   (could differ if the contract was re-deployed)
  //
  // Mostriamo al massimo 5 carte per evitare tastiere troppo lunghe.
  // We show at most 5 cards to avoid keyboards that are too long.
  // ---------------------------------------------------------------------------
  // conversation.external() per la lettura dal file system (draftStore).
  // conversation.external() for file system reads (draftStore).
  const mintedDrafts = await conversation.external(() => {
    const drafts = draftStore.listByUser(userId);
    return drafts.filter(d =>
      d.status === "minted" &&
      d.mintedTokenId !== undefined &&
      (!d.mintedContractAddress || d.mintedContractAddress.toLowerCase() === CONTRACTS.CUSTOM_CARDS.toLowerCase())
    );
  });

  if (mintedDrafts.length === 0) {
    await ctx.reply("📭 You haven't created any cards yet!\n\nCreate a card first to list it for sale.", {
      reply_markup: new InlineKeyboard()
        .text("🎨 Create Card", "action_create_card")
        .row()
        .text("🏠 Menu", "main_menu")
    });
    return;
  }

  // Costruisci il messaggio con l'elenco e la tastiera di selezione
  // Build the message with the list and selection keyboard
  let message = "🏷️ *List a Card for Sale*\n\nYour minted cards:\n\n";

  const keyboard = new InlineKeyboard();
  for (const draft of mintedDrafts.slice(0, 5)) {
    const rarity = RARITIES[draft.stats.rarity] || RARITIES[0];
    message += `• ${rarity.emoji} *${draft.cardName}* (#${draft.mintedTokenId})\n`;
    keyboard.text(`${draft.cardName} #${draft.mintedTokenId}`, `list_select_${draft.draftId}`).row();
  }

  keyboard.text("❌ Cancel", "cancel_listing");

  await ctx.reply(message + "\nSelect a card to list:", {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });

  // Aspetta che l'utente selezioni una carta o cancelli
  // Wait for user to select a card or cancel
  const selectCtx = await conversation.waitForCallbackQuery(/^(list_select_|cancel_listing)/);
  await selectCtx.answerCallbackQuery();

  if (selectCtx.callbackQuery.data === "cancel_listing") {
    await ctx.reply("❌ Listing cancelled.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // conversation.external() per la lettura dal draftStore (file system).
  // conversation.external() for draftStore read (file system).
  const draftId = selectCtx.callbackQuery.data.replace("list_select_", "");
  const selectedDraft = await conversation.external(() =>
    draftStore.get(userId, draftId)
  );

  if (!selectedDraft || !selectedDraft.mintedTokenId) {
    await ctx.reply("❌ Card not found.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // ---------------------------------------------------------------------------
  // VERIFICA OWNERSHIP + DATI ON-CHAIN (con conversation.external())
  // OWNERSHIP + ON-CHAIN DATA VERIFICATION (with conversation.external())
  //
  // conversation.external() impedisce che queste chiamate blockchain vengano
  // ri-eseguite durante il replay grammY. Ritorna un oggetto con tutti i dati
  // necessari o un codice errore.
  //
  // conversation.external() prevents these blockchain calls from re-executing
  // during grammY replay. Returns an object with all needed data or error code.
  // ---------------------------------------------------------------------------
  const onChainCheck = await conversation.external(async () => {
    try {
      const wm = getWalletManager();
      const userSigner = await wm.getSigner(userId);

      // Verifica ownership on-chain
      // On-chain ownership verification
      const nftContractForCheck = new ethers.Contract(
        CONTRACTS.CUSTOM_CARDS,
        ["function ownerOf(uint256 tokenId) view returns (address)"],
        provider
      );
      const owner = await nftContractForCheck.ownerOf(selectedDraft.mintedTokenId);
      if (owner.toLowerCase() !== userSigner.address.toLowerCase()) {
        return { error: "not_owner" as const };
      }

      // Verifica ban status e metadati IPFS
      // Ban status and IPFS metadata verification
      let freshImage: string | undefined;
      if (customCardsContract) {
        try {
          const [isBanned, tokenURI] = await Promise.all([
            customCardsContract.isBanned(selectedDraft.mintedTokenId),
            customCardsContract.tokenURI(selectedDraft.mintedTokenId).catch(() => null)
          ]);
          if (isBanned) return { error: "banned" as const };
          if (tokenURI) {
            try {
              const metadata = await fetchNFTMetadata(tokenURI);
              if (metadata?.image) freshImage = metadata.image;
            } catch {}
          }
        } catch (chainError: any) {
          console.error(`[List] On-chain verification failed for token ${selectedDraft.mintedTokenId}:`, chainError.message);
        }
      }

      return { error: null, freshImageUrl: freshImage };
    } catch (ownerError: any) {
      console.error(`[List] ownerOf(${selectedDraft.mintedTokenId}) failed:`, ownerError.message);
      return { error: "contract_error" as const };
    }
  });

  if (onChainCheck.error === "not_owner") {
    await ctx.reply("❌ You no longer own this card. It may have been transferred.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }
  if (onChainCheck.error === "banned") {
    await ctx.reply("❌ This card is banned and cannot be listed on the marketplace.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }
  if (onChainCheck.error === "contract_error") {
    await ctx.reply("❌ Card not found on the current contract. It may have been minted on a previous contract deployment.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // INSERIMENTO PREZZO - L'utente digita il prezzo desiderato in ETH
  // PRICE INPUT - User types the desired price in ETH
  //
  // Il ciclo while gestisce input non validi: se l'utente invia qualcosa
  // che non e' un numero valido, o un prezzo fuori range (0 < price < 1000),
  // viene chiesto di riprovare. Questo e' un pattern comune nelle
  // conversazioni grammY per validazione input.
  //
  // The while loop handles invalid input: if the user sends something
  // that is not a valid number, or a price outside range (0 < price < 1000),
  // they are asked to try again. This is a common pattern in grammY
  // conversations for input validation.
  //
  // Nota: ignoriamo i callbackQuery durante l'input prezzo (l'utente
  // potrebbe premere pulsanti di messaggi precedenti per errore).
  //
  // Note: we ignore callbackQueries during price input (user might
  // press buttons from previous messages by mistake).
  // ---------------------------------------------------------------------------
  await ctx.reply(`💰 Set price for *${selectedDraft.cardName}*\n\nEnter price in ETH (e.g.: 0.01, 0.05, 0.1):`, {
    parse_mode: "Markdown"
  });

  let priceInEth: string = "";
  let validPrice = false;

  while (!validPrice) {
    const priceCtx = await conversation.wait();

    if (priceCtx.callbackQuery) {
      await priceCtx.answerCallbackQuery("Please enter a price in the chat").catch(() => {});
      continue;
    }

    if (!priceCtx.message?.text) {
      continue;
    }

    const priceText = priceCtx.message.text;
    const price = parseFloat(priceText);

    if (!isNaN(price) && price > 0 && price < 1000) {
      priceInEth = priceText;
      validPrice = true;
    } else {
      await ctx.reply("❌ Invalid price. Enter a number like: 0.01, 0.05, 0.1");
    }
  }

  // Converti il prezzo da ETH a Wei (1 ETH = 10^18 Wei)
  // Convert price from ETH to Wei (1 ETH = 10^18 Wei)
  // La blockchain lavora internamente con Wei per evitare errori di
  // arrotondamento con i numeri decimali.
  // The blockchain internally works with Wei to avoid rounding errors
  // with decimal numbers.
  const priceWei = ethers.parseEther(priceInEth);

  // ---------------------------------------------------------------------------
  // CONFERMA LISTING - Riepilogo finale prima dell'esecuzione
  // LISTING CONFIRMATION - Final summary before execution
  // ---------------------------------------------------------------------------
  const confirmKeyboard = new InlineKeyboard()
    .text("✅ Confirm Listing", "confirm_list")
    .row()
    .text("❌ Cancel", "cancel_list");

  await ctx.reply(
    `📋 *Confirm Listing*

🎴 *Card:* ${selectedDraft.cardName}
🆔 *Token ID:* #${selectedDraft.mintedTokenId}
💰 *Price:* ${priceInEth} ETH

Proceed with listing?`,
    { parse_mode: "Markdown", reply_markup: confirmKeyboard }
  );

  const confirmCtx = await conversation.waitForCallbackQuery(/^(confirm_list|cancel_list)$/);
  await confirmCtx.answerCallbackQuery();

  if (confirmCtx.callbackQuery.data === "cancel_list") {
    await ctx.reply("❌ Listing cancelled.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // ---------------------------------------------------------------------------
  // ESECUZIONE TRANSAZIONI ON-CHAIN - Approval + Listing
  // ON-CHAIN TRANSACTION EXECUTION - Approval + Listing
  //
  // Da qui in poi avvengono le transazioni reali sulla blockchain.
  // Aggiorniamo il messaggio di conferma con lo stato del progresso.
  //
  // From here on, real blockchain transactions happen.
  // We update the confirmation message with progress status.
  // ---------------------------------------------------------------------------
  await confirmCtx.editMessageText("🔄 *Processing listing...*\n\nStep 1/2: Approving marketplace...", { parse_mode: "Markdown" });

  try {
    // Doppio controllo wallet (potrebbe essere passato tempo dalla conferma)
    // Double-check wallet (time may have passed since confirmation)
    const walletManager = getWalletManager();
    if (!walletManager.hasWallet(userId)) {
      await ctx.reply("❌ Please create a wallet first to list cards on the marketplace.", {
        reply_markup: new InlineKeyboard().text("💼 Create Wallet", "wallet_create").row().text("🏠 Menu", "main_menu")
      });
      return;
    }

    const userSigner = await walletManager.getSigner(userId);
    if (!userSigner) {
      await ctx.reply("❌ Could not access wallet signer.", { reply_markup: getMainMenuKeyboard() });
      return;
    }

    const nftContract = CONTRACTS.CUSTOM_CARDS;

    // -------------------------------------------------------------------------
    // STEP 1/2: APPROVAL - Autorizzazione marketplace per trasferire NFT
    // STEP 1/2: APPROVAL - Marketplace authorization to transfer NFTs
    //
    // isApprovedForAll() controlla se il marketplace e' gia' autorizzato.
    // Se si', saltiamo questo step (risparmio gas).
    // Se no, chiamiamo setApprovalForAll() per autorizzarlo.
    //
    // isApprovedForAll() checks if the marketplace is already authorized.
    // If yes, we skip this step (gas savings).
    // If not, we call setApprovalForAll() to authorize it.
    //
    // Nota: setApprovalForAll autorizza il marketplace per TUTTI gli NFT
    // dell'utente su questo contratto, non solo per questa carta specifica.
    // Questo e' il pattern standard usato da OpenSea e altri marketplace.
    //
    // Note: setApprovalForAll authorizes the marketplace for ALL of the
    // user's NFTs on this contract, not just this specific card.
    // This is the standard pattern used by OpenSea and other marketplaces.
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
    // STEP 2/2: LISTING - Creazione della listing sul marketplace
    // STEP 2/2: LISTING - Create the listing on the marketplace
    //
    // Chiamiamo listNFT() sul contratto PokeDEXMarketplace con:
    // - nftContract: indirizzo del contratto NFT (PokeDEXCustomCards)
    // - mintedTokenId: ID del token da vendere
    // - priceWei: prezzo in Wei
    // - imageURI: URL dell'immagine IPFS per il display nel marketplace
    //
    // We call listNFT() on the PokeDEXMarketplace contract with:
    // - nftContract: NFT contract address (PokeDEXCustomCards)
    // - mintedTokenId: token ID to sell
    // - priceWei: price in Wei
    // - imageURI: IPFS image URL for marketplace display
    //
    // Dopo la transazione, cerchiamo l'evento "NFTListed" nei log per
    // ottenere il listing ID assegnato dal contratto.
    //
    // After the transaction, we search for the "NFTListed" event in logs
    // to get the listing ID assigned by the contract.
    // -------------------------------------------------------------------------
    await confirmCtx.editMessageText("🔄 *Processing listing...*\n\n✅ Step 1/2: Marketplace approved!\n🔄 Step 2/2: Creating listing...", { parse_mode: "Markdown" });

    const marketplaceWithSigner = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, userSigner);

    // Il contratto deployato usa listNFT a 3 parametri (senza imageURI).
    // The deployed contract uses 3-parameter listNFT (without imageURI).
    const listTx = await marketplaceWithSigner.listNFT(nftContract, selectedDraft.mintedTokenId, priceWei);
    const receipt = await listTx.wait();

    // Cerca l'evento NFTListed nei log della transazione per il listing ID
    // Search for NFTListed event in transaction logs for the listing ID
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

    // Messaggio di successo con link alla transazione e azioni successive
    // Success message with transaction link and next actions
    const successKeyboard = new InlineKeyboard()
      .url("🔍 View Transaction", `${NETWORK.explorer}/tx/${listTx.hash}`)
      .row()
      .text("📋 My Listings", "action_my_listings")
      .text("🏠 Menu", "main_menu");

    await confirmCtx.editMessageText(
      `✅ *Card Listed Successfully!*

🎴 *Card:* ${selectedDraft.cardName}
💰 *Price:* ${priceInEth} ETH
🆔 *Listing ID:* #${listingId || "pending"}
📜 *TX:* \`${listTx.hash.slice(0, 20)}...\`

Your card is now live on the marketplace!`,
      { parse_mode: "Markdown", reply_markup: successKeyboard }
    );

  } catch (error: any) {
    // Errore durante le transazioni on-chain (gas insufficiente, revert, etc.)
    // Error during on-chain transactions (insufficient gas, revert, etc.)
    console.error("Listing error:", error);
    const errMsg = (error.reason || error.message || "Transaction failed").replace(/[*_`\[]/g, "");
    await ctx.reply(`❌ *Listing Failed*\n\n${errMsg}`, {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard()
    });
  }
}
