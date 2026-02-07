// =============================================================================
// FUNZIONI AZIONE - View riutilizzabili tra comandi e callback
// ACTION FUNCTIONS - Reusable views shared between commands and callbacks
//
// Questo file contiene le funzioni "show" che costruiscono e inviano le
// schermate principali del bot. Ogni funzione corrisponde a una pagina o
// vista che l'utente vede nella chat (es. la collezione carte, il marketplace,
// il wallet, ecc.).
//
// This file contains the "show" functions that build and send the bot's main
// screens. Each function corresponds to a page or view the user sees in the
// chat (e.g. card collection, marketplace, wallet, etc.).
//
// Perche' sono separate dai comandi?
// Why are they separate from commands?
//   Perche' la stessa vista puo' essere raggiunta sia da un comando slash
//   (es. /cards) sia da un bottone inline (es. premendo "My Cards" nel menu).
//   Il comando e il callback chiamano la stessa funzione "show".
//
//   Because the same view can be reached both from a slash command (e.g. /cards)
//   and from an inline button (e.g. pressing "My Cards" in the menu). The
//   command and the callback both call the same "show" function.
//
// Formato callback_data di InlineKeyboard:
// InlineKeyboard callback_data format:
//   Ogni bottone inline ha un "callback_data" - una stringa che il bot riceve
//   quando l'utente preme il bottone. Convenzioni usate in questo progetto:
//
//   Every inline button has a "callback_data" - a string the bot receives
//   when the user presses the button. Conventions used in this project:
//
//   - "action_<nome>"          -> Navigazione / Navigation (es. "action_wallet")
//   - "view_card_<id>"  -> Visualizza carta / View card (es. "view_card_5")
//   - "sell_card_<id>"  -> Vendi carta / Sell card (es. "sell_card_3")
//   - "browse_market_<page>"   -> Sfoglia marketplace / Browse marketplace (es. "browse_market_0")
//   - "buy_listing_<id>"       -> Compra inserzione / Buy listing (es. "buy_listing_12")
//   - "wallet_<azione>"        -> Azioni wallet / Wallet actions (es. "wallet_deposit")
//   - "main_menu"              -> Torna al menu principale / Return to main menu
// =============================================================================

import { InlineKeyboard, InputMediaBuilder } from "grammy";
import { ethers } from "ethers";
import { CONTRACTS, NETWORK, POKEMON_TYPES, RARITIES, TYPE_EMOJIS } from "../config.js";
import { customCardsContract, marketplaceContract } from "../contracts/provider.js";
import { sessionStore, draftStore } from "../storage/index.js";
import { getUserWalletAddress } from "../services/wallet-helpers.js";
import { getEnrichedListing, getActiveListings } from "../services/marketplace.js";
import { fetchNFTMetadata } from "../services/ipfs.js";
import { getEthPriceUSD } from "../services/eth-price.js";
import { getWalletStats } from "../services/wallet-stats.js";
import { formatAddress, getEtherscanLink, formatTimeAgo } from "../bot/helpers.js";
import { getMainMenuKeyboard } from "../bot/menu.js";
import { SECURITY_NOTICE, ANTI_PHISHING_WARNING } from "../bot/security.js";
import { bot } from "../bot/setup.js";
import {
  getWalletManager,
  sendSensitiveMessage,
  SENSITIVITY_LEVELS,
} from "../wallet/index.js";
import type { MyContext } from "../types.js";

// =============================================================================
// SEZIONE 1: AIUTO E NAVIGAZIONE / HELP & NAVIGATION
// =============================================================================

/**
 * Mostra il menu di aiuto con tutti i comandi disponibili.
 * Shows the help menu with all available commands.
 *
 * Elenca i comandi raggruppati per categoria:
 * Lists commands grouped by category:
 * - Carte personalizzate / Cards   (/createcard, /mycreations, /drafts)
 * - Collezione / Collection               (/cards, /card)
 * - Marketplace                           (/market, /browse, /listings, /sell)
 * - Account                               (/wallet, /security, /contracts)
 *
 * In fondo mostra la legenda delle rarita':
 * At the bottom shows the rarity legend:
 *   Common -> Uncommon -> Rare -> Ultra Rare -> Legendary
 */
export async function showHelp(ctx: MyContext) {
  await ctx.reply(
    `📚 *PokeDEX Guide*

*Cards:*
/createcard - Create a new card
/mycreations - Your created cards
/drafts - Saved drafts

*Collection:*
/cards - Your cards
/card <id> - Card details

*Marketplace:*
/market - NFT Marketplace
/browse - Browse NFTs with images
/listings - Your listings
/sell - List a card for sale

*Account:*
/wallet - Manage wallet
/security - Security info
/contracts - Contract addresses

*Getting Started:*
⛽ Get free test ETH from the faucet
🎨 Create your first card
🛒 Browse and buy from the marketplace

*Rarity:* ⚪Common | 🟢Uncommon | 🔵Rare | 🟣Ultra | 🟡Legendary`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("⛽ Get Test ETH", "wallet_faucet_info")
        .text("👛 Wallet", "action_wallet")
        .row()
        .text("🎨 Create Card", "action_create_card")
        .text("🛒 Marketplace", "action_marketplace")
        .row()
        .text("🏠 Menu", "main_menu")
    }
  );
}

// =============================================================================
// SEZIONE 2: CARTE / CARDS
//
// Funzioni per visualizzare la collezione di carte NFT dell'utente,
// i dettagli di una singola carta, le creazioni e le bozze.
//
// Functions to display the user's NFT card collection,
// individual card details, creations, and drafts.
// =============================================================================

/**
 * Mostra la collezione di carte NFT dell'utente.
 * Shows the user's NFT card collection.
 *
 * Come funziona il recupero delle carte dalla blockchain:
 * How fetching cards from the blockchain works:
 *
 * 1. Recupera l'indirizzo wallet dell'utente dal database locale
 *    Retrieves the user's wallet address from the local database
 *
 * 2. Chiama customCardsContract.tokensOfOwner(walletAddress) che interroga
 *    lo smart contract ERC-721 sulla blockchain per ottenere tutti i token ID
 *    di proprieta' di quell'indirizzo.
 *    Calls customCardsContract.tokensOfOwner(walletAddress) which queries the
 *    ERC-721 smart contract on the blockchain to get all token IDs owned by
 *    that address.
 *
 * 3. Per ogni carta, recupera le statistiche on-chain (HP, attacco, etc.)
 *    tramite customCardsContract.getCardStats(tokenId).
 *    For each card, fetches on-chain stats (HP, attack, etc.) via
 *    customCardsContract.getCardStats(tokenId).
 *
 * 4. Costruisce un messaggio con la lista e una tastiera inline con bottoni
 *    per visualizzare i dettagli di ogni carta (callback: "view_card_<id>").
 *    Builds a message with the list and an inline keyboard with buttons to
 *    view each card's details (callback: "view_card_<id>").
 *
 * Limite: mostra al massimo 10 carte per non sovraccaricare la chat.
 * Limit: shows at most 10 cards to avoid overwhelming the chat.
 */
export async function showMyCards(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  const loadingMsg = await ctx.reply("🔄 Loading your collection...");

  try {
    // FASE 1: Recupera tokenIds + listing status in PARALLELO (2 RPC calls)
    // PHASE 1: Fetch tokenIds + listing status in PARALLEL (2 RPC calls)
    const [ownedIds, listingIds] = await Promise.all([
      customCardsContract
        ? customCardsContract.tokensOfOwner(walletAddress).catch(() => [])
        : Promise.resolve([]),
      marketplaceContract
        ? marketplaceContract.getSellerListings(walletAddress).catch(() => [])
        : Promise.resolve([]),
    ]);

    // FASE 2: Check listing attivi in PARALLELO (batch getListing)
    // PHASE 2: Check active listings in PARALLEL (batch getListing)
    const listedCards: { tokenId: number; listingId: number; price: bigint }[] = [];
    if (marketplaceContract && listingIds.length > 0) {
      const recentIds = [...listingIds].slice(-20).reverse();
      const listingResults = await Promise.all(
        recentIds.map(async (lid) => {
          try {
            const listing = await marketplaceContract!.getListing(Number(lid));
            if (listing.active && listing.seller && listing.seller !== ethers.ZeroAddress) {
              return { tokenId: Number(listing.tokenId), listingId: Number(lid), price: listing.price };
            }
          } catch {}
          return null;
        })
      );
      for (const r of listingResults) {
        if (r) listedCards.push(r);
      }
    }

    // FASE 3: Costruisci lista DEDUPLICATA (ZERO RPC calls)
    // Il marketplace usa approval-based listing: le carte listate restano nel wallet,
    // quindi tokensOfOwner() le ritorna ancora. Usiamo una Map per deduplicare.
    // PHASE 3: Build DEDUPLICATED list (ZERO RPC calls)
    // The marketplace uses approval-based listing: listed cards stay in the wallet,
    // so tokensOfOwner() still returns them. We use a Map to deduplicate.
    const cardMap = new Map<number, CardEntry>();
    for (const tokenId of ownedIds) {
      cardMap.set(Number(tokenId), { tokenId: Number(tokenId), isListed: false });
    }
    for (const listed of listedCards) {
      const existing = cardMap.get(listed.tokenId);
      if (existing) {
        existing.isListed = true;
        existing.listingId = listed.listingId;
        existing.listingPrice = listed.price;
      } else {
        cardMap.set(listed.tokenId, {
          tokenId: listed.tokenId,
          isListed: true,
          listingId: listed.listingId,
          listingPrice: listed.price,
        });
      }
    }
    const allCardEntries = Array.from(cardMap.values());

    if (allCardEntries.length === 0) {
      try { await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id); } catch {}
      await ctx.reply("📭 You don't have any cards yet!\n\nCreate your first card!", {
        reply_markup: new InlineKeyboard()
          .text("🎨 Create Card", "action_create_card")
          .text("🏠 Menu", "main_menu")
      });
      return;
    }

    // FASE 4: Arricchisci SOLO la carta #0 (stats + metadata in parallelo)
    // PHASE 4: Enrich ONLY card #0 (stats + metadata in parallel)
    const enriched = await enrichCardEntry(allCardEntries[0]);

    try { await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id); } catch {}

    await showMyCardAt(ctx, enriched, 0, allCardEntries.length);
  } catch (error) {
    console.error("Error fetching cards:", error);
    try { await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id); } catch {}
    await ctx.reply("❌ Error loading your cards. Please try again.");
  }
}

/**
 * Struttura leggera per una carta (senza dati pesanti come stats/metadata).
 * Lightweight card structure (without heavy data like stats/metadata).
 */
export interface CardEntry {
  tokenId: number;
  isListed: boolean;
  listingId?: number;
  listingPrice?: bigint;
}

/**
 * Struttura carta arricchita con stats e metadata (per il display).
 * Enriched card structure with stats and metadata (for display).
 */
export interface EnrichedCardEntry extends CardEntry {
  name?: string;
  imageUrl?: string;
  stats?: import("../types.js").CardStats;
}

/**
 * Arricchisce UNA singola carta con stats + metadata in parallelo.
 * Enriches ONE single card with stats + metadata in parallel.
 * Solo 2-3 RPC calls per carta (getCardStats + tokenURI in parallelo).
 * Only 2-3 RPC calls per card (getCardStats + tokenURI in parallel).
 */
export async function enrichCardEntry(entry: CardEntry): Promise<EnrichedCardEntry> {
  const enriched: EnrichedCardEntry = { ...entry };
  if (!customCardsContract) return enriched;

  try {
    // Fetch stats e tokenURI in PARALLELO (2 RPC calls simultanee)
    // Fetch stats and tokenURI in PARALLEL (2 simultaneous RPC calls)
    const [stats, tokenURI] = await Promise.all([
      customCardsContract.getCardStats(entry.tokenId).catch(() => null),
      customCardsContract.tokenURI(entry.tokenId).catch(() => null),
    ]);

    if (stats) {
      enriched.stats = {
        hp: Number(stats.hp),
        attack: Number(stats.attack),
        defense: Number(stats.defense),
        speed: Number(stats.speed),
        pokemonType: Number(stats.pokemonType || stats.cardType || 0),
        rarity: Number(stats.rarity),
        generation: Number(stats.generation || 1),
        experience: Number(stats.experience || 0),
      };
    }

    if (tokenURI) {
      try {
        const metadata = await fetchNFTMetadata(tokenURI);
        if (metadata) {
          enriched.name = metadata.name;
          enriched.imageUrl = metadata.image;
        }
      } catch {}
    }
  } catch {}

  return enriched;
}

/**
 * Recupera la lista leggera di carte (tokenIds + listing status) in modo veloce.
 * Fetches the lightweight card list (tokenIds + listing status) fast.
 * Solo 2 RPC calls + N listing checks in parallelo.
 * Only 2 RPC calls + N listing checks in parallel.
 */
export async function getCardEntries(walletAddress: string): Promise<CardEntry[]> {
  const [ownedIds, listingIds] = await Promise.all([
    customCardsContract
      ? customCardsContract.tokensOfOwner(walletAddress).catch(() => [])
      : Promise.resolve([]),
    marketplaceContract
      ? marketplaceContract.getSellerListings(walletAddress).catch(() => [])
      : Promise.resolve([]),
  ]);

  // Usa Map per deduplicare: il marketplace usa approval-based listing,
  // quindi tokensOfOwner() ritorna anche le carte listate.
  // Use Map to deduplicate: the marketplace uses approval-based listing,
  // so tokensOfOwner() also returns listed cards.
  const cardMap = new Map<number, CardEntry>();

  for (const tokenId of ownedIds) {
    cardMap.set(Number(tokenId), { tokenId: Number(tokenId), isListed: false });
  }

  if (marketplaceContract && listingIds.length > 0) {
    const recentIds = [...listingIds].slice(-20).reverse();
    const listingResults = await Promise.all(
      recentIds.map(async (lid) => {
        try {
          const listing = await marketplaceContract!.getListing(Number(lid));
          if (listing.active && listing.seller && listing.seller !== ethers.ZeroAddress) {
            return { tokenId: Number(listing.tokenId), listingId: Number(lid), price: listing.price };
          }
        } catch {}
        return null;
      })
    );
    for (const r of listingResults) {
      if (r) {
        const existing = cardMap.get(r.tokenId);
        if (existing) {
          existing.isListed = true;
          existing.listingId = r.listingId;
          existing.listingPrice = r.price;
        } else {
          cardMap.set(r.tokenId, { tokenId: r.tokenId, isListed: true, listingId: r.listingId, listingPrice: r.price });
        }
      }
    }
  }

  return Array.from(cardMap.values());
}

/**
 * Costruisce la didascalia e la tastiera per una singola carta nel carousel "My Cards".
 * Builds the caption and keyboard for a single card in the "My Cards" carousel.
 */
export function buildMyCardView(
  card: EnrichedCardEntry,
  index: number,
  total: number
) {
  const type = card.stats ? (POKEMON_TYPES[card.stats.pokemonType] || "Unknown") : "Unknown";
  const typeEmoji = TYPE_EMOJIS[type] || "❓";
  const rarity = card.stats ? (RARITIES[card.stats.rarity] || RARITIES[0]) : RARITIES[0];

  let caption = `🎴 *${card.name || `Card #${card.tokenId}`}*\n\n`;
  caption += `${rarity.emoji} *Rarity:* ${rarity.name}\n`;
  caption += `${typeEmoji} *Type:* ${type}\n\n`;
  caption += `❤️ HP: ${card.stats?.hp || "?"} | ⚔️ ATK: ${card.stats?.attack || "?"}\n`;
  caption += `🛡️ DEF: ${card.stats?.defense || "?"} | 💨 SPD: ${card.stats?.speed || "?"}\n\n`;

  if (card.isListed) {
    const priceEth = card.listingPrice ? ethers.formatEther(card.listingPrice) : "?";
    caption += `🏷️ *Listed on Marketplace*\n`;
    caption += `💰 Price: ${priceEth} ETH\n`;
    caption += `🆔 Listing: #${card.listingId}\n`;
  } else {
    caption += `📦 *In your wallet*\n`;
  }

  caption += `\n🆔 *Token:* #${card.tokenId}`;

  const keyboard = new InlineKeyboard();

  if (total > 1) {
    const prevIndex = (index - 1 + total) % total;
    const nextIndex = (index + 1) % total;
    keyboard
      .text("📑", `my_cards_grid_0`)
      .text("« Prev", `my_card_${prevIndex}_${total}`)
      .text(`${index + 1}/${total}`, "noop")
      .text("Next »", `my_card_${nextIndex}_${total}`);
    keyboard.row();
  }

  if (!card.isListed) {
    keyboard.text("🛒 Sell", `sell_card_${card.tokenId}`);
  } else {
    keyboard.text("❌ Cancel Listing", `cancel_my_listing_${card.listingId}`);
  }
  keyboard.row();
  keyboard.text("🛍️ Marketplace", "browse_market_0").text("🏠 Menu", "main_menu");

  return { caption, keyboard };
}

/**
 * Costruisce la griglia compatta per la selezione diretta delle carte.
 * Builds a compact grid for direct card selection (jump-to-card).
 *
 * Mostra fino a 10 carte per pagina con nome e stato listing.
 * Shows up to 10 cards per page with name and listing status.
 */
export function buildMyCardsGrid(
  entries: CardEntry[],
  names: Map<number, string>,
  page: number
) {
  const perPage = 10;
  const totalPages = Math.ceil(entries.length / perPage);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * perPage;
  const pageEntries = entries.slice(start, start + perPage);

  let caption = `📑 *Your Collection* (${entries.length} cards)`;
  if (totalPages > 1) caption += ` — Page ${safePage + 1}/${totalPages}`;
  caption += `\n\nTap a card to view it:`;

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < pageEntries.length; i++) {
    const entry = pageEntries[i];
    const globalIdx = start + i;
    const name = names.get(entry.tokenId) || `#${entry.tokenId}`;
    const truncName = name.length > 12 ? name.slice(0, 11) + "…" : name;
    const prefix = entry.isListed ? "🏷️" : "🎴";
    keyboard.text(`${prefix} ${truncName}`, `grid_card_${globalIdx}_${entries.length}`);
    if (i % 2 === 1) keyboard.row();
  }
  if (pageEntries.length % 2 === 1) keyboard.row();

  if (totalPages > 1) {
    if (safePage > 0) keyboard.text("◀ Prev", `my_cards_grid_${safePage - 1}`);
    if (safePage < totalPages - 1) keyboard.text("Next ▶", `my_cards_grid_${safePage + 1}`);
    keyboard.row();
  }

  keyboard.text("🔙 Back", `my_card_0_${entries.length}`).text("🏠 Menu", "main_menu");

  return { caption, keyboard };
}

/**
 * Invia una singola carta arricchita come messaggio con foto nel carousel.
 * Sends a single enriched card as a photo message in the carousel.
 */
export async function showMyCardAt(
  ctx: MyContext,
  card: EnrichedCardEntry,
  index: number,
  total: number
) {
  const { caption, keyboard } = buildMyCardView(card, index, total);

  if (card.imageUrl) {
    try {
      await ctx.replyWithPhoto(card.imageUrl, {
        caption,
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return;
    } catch (imgError) {
      console.error("My card image send failed:", imgError);
    }
  }

  await ctx.reply(caption + "\n\n📷 _(Image unavailable)_", {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
}

/**
 * Mostra i dettagli completi di una carta.
 * Shows the full details of a card.
 *
 * Dati on-chain mostrati / On-chain data displayed:
 * - Statistiche di combattimento / Battle stats:  HP, Attack, Defense, Speed
 * - Tipo Pokemon / Pokemon type:     Normal, Fire, Water, Grass, Electric, etc.
 * - Rarita' / Rarity:                Common -> Legendary (5 livelli / 5 tiers)
 * - Potenza di battaglia / Battle power:  valore calcolato dallo smart contract
 *                                         value computed by the smart contract
 * - Stato di verifica / Verification status:  se la carta e' stata approvata
 *                                             whether the card has been approved
 * - Stato di ban / Ban status:        se la carta e' stata bannata (contenuto illecito)
 *                                     whether the card was banned (illicit content)
 * - Creatore / Creator:               indirizzo wallet di chi ha creato la carta
 *                                     wallet address of whoever created the card
 * - Proprietario / Owner:             chi attualmente possiede il token NFT
 *                                     who currently owns the NFT token
 *
 * Se disponibile, mostra anche l'immagine della carta recuperata dall'IPFS
 * tramite il tokenURI (metadati NFT standard ERC-721).
 *
 * If available, also shows the card image fetched from IPFS via the tokenURI
 * (standard ERC-721 NFT metadata).
 *
 * Se l'utente e' il proprietario e la carta non e' bannata, mostra un bottone
 * "Sell" per mettere la carta in vendita sul marketplace.
 *
 * If the user is the owner and the card is not banned, shows a "Sell" button
 * to list the card for sale on the marketplace.
 *
 * @param ctx - Contesto Telegram / Telegram context
 * @param cardId - ID del token NFT sulla blockchain / NFT token ID on the blockchain
 */
export async function showCardDetails(ctx: MyContext, cardId: number) {
  if (!customCardsContract) {
    await ctx.reply("❌ CustomCards contract not configured.");
    return;
  }

  const loadingMsg = await ctx.reply("🔄 Loading card details...");

  try {
    // Recupera i dati on-chain della carta dallo smart contract
    // Fetch the card's on-chain data from the smart contract
    const stats = await customCardsContract.getCardStats(cardId);
    const power = await customCardsContract.calculateBattlePower(cardId);
    const isBanned = await customCardsContract.isBanned(cardId);

    // Mappa degli indici numerici ai nomi leggibili
    // Mapping from numeric indices to human-readable names
    const rarityNames = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary"];
    const typeNames = ["Normal", "Fire", "Water", "Grass", "Electric", "Psychic", "Fighting", "Dark", "Dragon"];
    const rarity = rarityNames[stats.rarity] || "Unknown";
    const cardType = typeNames[stats.cardType] || "Unknown";

    // Controlla se l'utente corrente e' il creatore o il proprietario
    // Check if the current user is the creator or the owner
    const userId = ctx.from?.id;
    const walletAddress = userId ? await getUserWalletAddress(userId) : null;
    const isCreator = walletAddress?.toLowerCase() === stats.creator.toLowerCase();

    let isOwner = false;
    try {
      // ownerOf() e' un metodo standard ERC-721 che restituisce il proprietario attuale
      // ownerOf() is a standard ERC-721 method that returns the current owner
      const owner = await customCardsContract.ownerOf(cardId);
      isOwner = walletAddress?.toLowerCase() === owner.toLowerCase();
    } catch {}

    // Costruisci il messaggio con tutte le statistiche della carta
    // Build the message with all card statistics
    let caption = `🎨 *Card #${cardId}*\n\n`;
    caption += `❤️ HP: ${stats.hp}\n`;
    caption += `⚔️ Attack: ${stats.attack}\n`;
    caption += `🛡️ Defense: ${stats.defense}\n`;
    caption += `💨 Speed: ${stats.speed}\n`;
    caption += `🏷️ Type: ${cardType}\n`;
    caption += `⭐ Rarity: ${rarity}\n`;
    caption += `💪 Battle Power: ${power}\n`;
    caption += `✅ Verified: ${stats.verified ? "Yes" : "No"}\n`;
    caption += `🚫 Banned: ${isBanned ? "Yes" : "No"}\n`;
    caption += `👤 Creator: ${isCreator ? "You! ✓" : formatAddress(stats.creator)}`;
    if (isOwner && !isCreator) {
      caption += `\n👛 Owner: You`;
    }

    // Costruisci la tastiera con "Sell" (se applicabile) e navigazione
    // Build the keyboard with "Sell" (if applicable) and navigation
    const keyboard = new InlineKeyboard();
    if (isOwner && CONTRACTS.MARKETPLACE && !isBanned) {
      keyboard.text("🛒 Sell", `sell_card_${cardId}`).row();
    }
    keyboard.text("🎴 My Cards", "action_my_cards").text("🏠 Menu", "main_menu");

    // Prova a recuperare l'immagine della carta dai metadati IPFS
    // Try to fetch the card image from IPFS metadata
    let imageUrl: string | undefined;
    try {
      // tokenURI() restituisce l'URL dei metadati JSON (standard ERC-721)
      // tokenURI() returns the JSON metadata URL (ERC-721 standard)
      const tokenURI = await customCardsContract.tokenURI(cardId);
      // fetchNFTMetadata scarica il JSON e ne estrae il campo "image"
      // fetchNFTMetadata downloads the JSON and extracts the "image" field
      const metadata = await fetchNFTMetadata(tokenURI);
      imageUrl = metadata?.image;
    } catch {}

    // Cancella il messaggio di caricamento
    // Delete the loading message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}

    // Se abbiamo un'immagine, inviala come foto con didascalia
    // If we have an image, send it as a photo with caption
    if (imageUrl) {
      try {
        await ctx.replyWithPhoto(imageUrl, {
          caption,
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
        return;
      } catch {}
    }

    // Fallback: invia solo testo se l'immagine non e' disponibile
    // Fallback: send text only if the image is not available
    await ctx.reply(caption + (imageUrl ? "" : "\n\n📷 _(No image available)_"), {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  } catch (error) {
    console.error("Error showing card:", error);
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}
    await ctx.reply("❌ Card not found.");
  }
}

/**
 * Mostra le carte create dall'utente (non necessariamente possedute).
 * Shows cards created by the user (not necessarily owned).
 *
 * Differenza chiave rispetto a showMyCards:
 * Key difference from showMyCards:
 * - showMyCards mostra le carte che l'utente POSSIEDE attualmente
 *   showMyCards shows cards the user CURRENTLY OWNS
 * - showMyCreations mostra le carte che l'utente ha CREATO (mintato),
 *   anche se le ha vendute e ora appartengono a qualcun altro
 *   showMyCreations shows cards the user CREATED (minted),
 *   even if they sold them and they now belong to someone else
 *
 * Usa getCreatorCards() dello smart contract che tiene traccia dell'indirizzo
 * creatore originale di ogni carta (immutabile una volta mintata).
 *
 * Uses getCreatorCards() from the smart contract which tracks the original
 * creator address for every card (immutable once minted).
 */
export async function showMyCreations(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!customCardsContract) {
    await ctx.reply("❌ CustomCards contract not configured.");
    return;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ You need to create or connect a wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  const loadingMsg = await ctx.reply("🔄 Loading your creations...");

  try {
    // Recupera tutti gli ID di carte create da questo wallet
    // Fetch all card IDs created by this wallet
    const cardIds = await customCardsContract.getCreatorCards(walletAddress);

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}

    if (cardIds.length === 0) {
      await ctx.reply("📭 You haven't created any cards yet!\n\nCreate your first card!", {
        reply_markup: new InlineKeyboard().text("🎨 Create Card", "action_create_card")
      });
      return;
    }

    let message = `🎨 *Your Creations*\n\nYou've created *${cardIds.length}* card(s):\n\n`;

    for (const cardId of cardIds.slice(0, 10)) {
      try {
        const stats = await customCardsContract.getCardStats(cardId);
        // Controlla se la carta e' ancora di proprieta' del creatore
        // Check if the card is still owned by the creator
        const owner = await customCardsContract.ownerOf(cardId);
        const isOwned = owner.toLowerCase() === walletAddress.toLowerCase();
        const verified = stats.verified ? "✅" : "⏳";
        // Se venduta, mostra "(sold)" accanto al nome
        // If sold, show "(sold)" next to the name
        const ownershipTag = isOwned ? "" : " _(sold)_";
        message += `• Card #${cardId} ${verified}${ownershipTag}\n`;
      } catch {
        message += `• Card #${cardId}\n`;
      }
    }

    if (cardIds.length > 10) {
      message += `\n...and ${cardIds.length - 10} more cards`;
    }

    const keyboard = new InlineKeyboard()
      .text("🎨 Create New", "action_create_card")
      .text("🏠 Menu", "main_menu");

    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (error) {
    console.error("Error fetching creations:", error);
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}
    await ctx.reply("❌ Error fetching creations.");
  }
}

/**
 * Mostra le bozze (draft) di carte salvate localmente.
 * Shows locally saved card drafts.
 *
 * Le bozze sono salvate nel draftStore (file JSON su disco), non sulla blockchain.
 * Drafts are saved in the draftStore (JSON files on disk), not on the blockchain.
 *
 * Stati possibili di una bozza / Possible draft statuses:
 * - "in_progress"     -> L'utente sta ancora inserendo i dati
 *                        The user is still entering data
 * - "ready_to_mint"   -> Tutti i dati sono completi, pronta per il minting
 *                        All data is complete, ready for minting
 * - "minted"          -> Gia' mintata on-chain (mantenuta come storico)
 *                        Already minted on-chain (kept as history)
 */
export async function showMyDrafts(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Recupera tutte le bozze di questo utente dal file system locale
  // Retrieve all drafts for this user from the local file system
  const drafts = draftStore.listByUser(userId);

  if (drafts.length === 0) {
    await ctx.reply("📭 You don't have any saved drafts.\n\nCreate a new card!", {
      reply_markup: new InlineKeyboard().text("🎨 Create Card", "action_create_card")
    });
    return;
  }

  let message = `📋 *Your Drafts*\n\n`;

  for (const draft of drafts.slice(0, 10)) {
    // Mappa lo stato della bozza a un'icona/etichetta leggibile
    // Map the draft status to a readable icon/label
    const status = draft.status === "ready_to_mint" ? "✅ Ready" :
                   draft.status === "minted" ? "🎉 Minted" : "📝 In progress";
    message += `• *${draft.cardName || "Unnamed"}* - ${status}\n`;
  }

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard()
      .text("🎨 Create Card", "action_create_card")
      .text("🏠 Menu", "main_menu")
  });
}

// =============================================================================
// SEZIONE 3: MARKETPLACE
//
// Funzioni per la schermata principale del marketplace, la navigazione
// paginata delle inserzioni, e la lista delle inserzioni dell'utente.
//
// Functions for the marketplace main screen, paginated browsing of
// listings, and the user's own listings list.
// =============================================================================

/**
 * Mostra la schermata principale del marketplace NFT.
 * Shows the NFT marketplace main screen.
 *
 * Questa e' la "homepage" del marketplace. Mostra:
 * This is the marketplace "homepage". It shows:
 * - Una descrizione delle funzionalita' (sfoglia, compra, vendi, royalties)
 *   A description of features (browse, buy, sell, royalties)
 * - La commissione del marketplace (letta dallo smart contract on-chain)
 *   The marketplace fee (read from the on-chain smart contract)
 * - Bottoni di navigazione per le varie sezioni
 *   Navigation buttons for the various sections
 *
 * La commissione viene letta dinamicamente dal contratto marketplaceContract
 * tramite marketplaceContract.marketplaceFee(). Il valore e' in centesimi
 * (es. 250 = 2.50%).
 *
 * The fee is read dynamically from the marketplaceContract via
 * marketplaceContract.marketplaceFee(). The value is in hundredths
 * (e.g. 250 = 2.50%).
 */
export async function showMarketplace(ctx: MyContext) {
  if (!CONTRACTS.MARKETPLACE) {
    await ctx.reply("❌ Marketplace not deployed yet.");
    return;
  }

  // Recupera la commissione del marketplace dallo smart contract
  // Fetch the marketplace fee from the smart contract
  let feePercent = "2.5";
  if (marketplaceContract) {
    try {
      const fee = await marketplaceContract.marketplaceFee();
      // Converte da centesimi a percentuale (es. 250 -> 2.50)
      // Convert from hundredths to percentage (e.g. 250 -> 2.50)
      feePercent = (Number(fee) / 100).toFixed(2);
    } catch {}
  }

  // Tastiera inline con le azioni principali del marketplace
  // Inline keyboard with the main marketplace actions
  const keyboard = new InlineKeyboard()
    .text("🛍️ Browse NFTs", "browse_market_0")
    .row()
    .text("📋 My Listings", "action_my_listings")
    .text("📥 My Offers", "action_my_offers")
    .row()
    .text("💰 Sell Card", "action_sell")
    .text("🏠 Menu", "main_menu");

  await ctx.reply(
    `🛒 *PokeDEX Marketplace*

Buy and sell NFT cards directly from Telegram!

*Features:*
• 🛍️ Browse NFTs with images
• 💳 Buy directly from bot
• 📋 List your cards for sale
• 💎 Creator royalties supported

*Fees:*
• Marketplace: ${feePercent}%
• Royalties: up to 10%`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

/**
 * Sfoglia le inserzioni attive del marketplace con immagini e paginazione.
 * Browse active marketplace listings with images and pagination.
 *
 * Come funziona la visualizzazione delle inserzioni:
 * How listing display works:
 *
 * 1. Mostra un messaggio di caricamento ("Loading marketplace...")
 *    Shows a loading message ("Loading marketplace...")
 *
 * 2. Chiama getActiveListings(offset, limit) che interroga lo smart contract
 *    per ottenere le inserzioni attive, poi arricchisce ogni inserzione con:
 *    Calls getActiveListings(offset, limit) which queries the smart contract
 *    to get active listings, then enriches each listing with:
 *    - Nome della carta / Card name
 *    - Statistiche (HP, ATK, DEF, SPD) / Stats (HP, ATK, DEF, SPD)
 *    - Tipo Pokemon e rarita' / Pokemon type and rarity
 *    - URL dell'immagine (da IPFS) / Image URL (from IPFS)
 *    - Prezzo in ETH / Price in ETH
 *    - Indirizzo del venditore / Seller address
 *
 * 3. Per ogni inserzione, invia un messaggio con foto (se disponibile),
 *    statistiche, prezzo, e un bottone "Buy" con callback "buy_listing_<id>".
 *    For each listing, sends a message with photo (if available), stats,
 *    price, and a "Buy" button with callback "buy_listing_<id>".
 *
 * 4. In fondo mostra i bottoni di navigazione "Previous" / "Next" per
 *    cambiare pagina (callback: "browse_market_<page>").
 *    At the bottom shows "Previous" / "Next" navigation buttons to change
 *    page (callback: "browse_market_<page>").
 *
 * @param ctx  - Contesto Telegram / Telegram context
 * @param page - Numero di pagina (0-indexed) / Page number (0-indexed)
 */
export async function showMarketplaceBrowser(ctx: MyContext, page: number = 0) {
  // Mostra un indicatore di caricamento, poi lo cancella quando i dati arrivano
  // Show a loading indicator, then delete it when data arrives
  const loadingMsg = await ctx.reply("🔄 Loading marketplace...");

  try {
    // Paginazione: 3 inserzioni per pagina
    // Pagination: 3 listings per page
    const itemsPerPage = 3;
    const listings = await getActiveListings(page * itemsPerPage, itemsPerPage);

    // Cancella il messaggio di caricamento
    // Delete the loading message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}

    // Gestisci il caso in cui non ci sono inserzioni
    // Handle the case where there are no listings
    if (listings.length === 0) {
      if (page === 0) {
        // Nessuna inserzione nel marketplace - suggerisci di vendere
        // No listings in marketplace - suggest selling
        await ctx.reply("📭 No active listings yet!\n\nBe the first to list a card!", {
          reply_markup: new InlineKeyboard()
            .text("💰 Sell Card", "action_sell")
            .row()
            .text("🏠 Menu", "main_menu")
        });
      } else {
        // Fine delle pagine - offri di tornare indietro
        // End of pages - offer to go back
        await ctx.reply("📭 No more listings on this page.", {
          reply_markup: new InlineKeyboard()
            .text("« Previous", `browse_market_${page - 1}`)
            .row()
            .text("🏠 Menu", "main_menu")
        });
      }
      return;
    }

    // Invia un messaggio per ogni inserzione con immagine e dettagli
    // Send a message for each listing with image and details
    for (const listing of listings) {
      // Determina tipo Pokemon, emoji, e rarita'
      // Determine Pokemon type, emoji, and rarity
      const type = listing.stats ? (POKEMON_TYPES[listing.stats.pokemonType] || "Unknown") : "Unknown";
      const typeEmoji = TYPE_EMOJIS[type] || "❓";
      const rarity = listing.stats ? (RARITIES[listing.stats.rarity] || RARITIES[0]) : RARITIES[0];
      // Converte il prezzo da Wei (unita' base di Ethereum) a ETH leggibile
      // Convert price from Wei (Ethereum's base unit) to readable ETH
      const priceEth = ethers.formatEther(listing.price);

      // Costruisci la didascalia con tutte le informazioni della carta
      // Build the caption with all card information
      const caption = `🎴 *${listing.name || `Card #${listing.tokenId}`}*

${rarity.emoji} *Rarity:* ${rarity.name}
${typeEmoji} *Type:* ${type}

*Stats:*
❤️ HP: ${listing.stats?.hp || "?"}
⚔️ ATK: ${listing.stats?.attack || "?"}
🛡️ DEF: ${listing.stats?.defense || "?"}
💨 SPD: ${listing.stats?.speed || "?"}

💰 *Price:* ${priceEth} ETH
👤 *Seller:* \`${formatAddress(listing.seller)}\`
🆔 *Listing:* #${listing.listingId}`;

      // Bottoni: "Buy" per acquistare, "View on Etherscan" per verificare on-chain
      // Buttons: "Buy" to purchase, "View on Etherscan" to verify on-chain
      const buyKeyboard = new InlineKeyboard()
        .text(`🛒 Buy for ${priceEth} ETH`, `buy_listing_${listing.listingId}`)
        .row()
        .url("🔍 View on Etherscan", `${NETWORK.explorer}/address/${listing.nftContract}?a=${listing.tokenId}`);

      // Prova a inviare con immagine, altrimenti fallback a solo testo
      // Try to send with image, otherwise fallback to text only
      if (listing.imageUrl) {
        try {
          await ctx.replyWithPhoto(listing.imageUrl, {
            caption,
            parse_mode: "Markdown",
            reply_markup: buyKeyboard
          });
        } catch (imgError) {
          console.error("Image send failed:", imgError);
          await ctx.reply(caption + "\n\n📷 _(Image unavailable)_", {
            parse_mode: "Markdown",
            reply_markup: buyKeyboard
          });
        }
      } else {
        await ctx.reply(caption + "\n\n📷 _(No image)_", {
          parse_mode: "Markdown",
          reply_markup: buyKeyboard
        });
      }
    }

    // Tastiera di navigazione tra le pagine.
    // Mostra "Next" solo se la pagina corrente e' piena (ci potrebbero essere altre inserzioni).
    //
    // Page navigation keyboard.
    // Show "Next" only if the current page is full (there might be more listings).
    const navKeyboard = new InlineKeyboard();
    if (page > 0) {
      navKeyboard.text("« Previous", `browse_market_${page - 1}`);
    }
    if (listings.length === itemsPerPage) {
      navKeyboard.text("Next »", `browse_market_${page + 1}`);
    }
    navKeyboard.row().text("🏠 Menu", "main_menu");

    await ctx.reply(`📄 Page ${page + 1}`, { reply_markup: navKeyboard });

  } catch (error) {
    console.error("Marketplace browser error:", error);
    await ctx.reply("❌ Error loading marketplace. Try again later.", {
      reply_markup: getMainMenuKeyboard()
    });
  }
}

/**
 * Mostra le inserzioni (listing) attive dell'utente sul marketplace con carousel.
 * Shows the user's active marketplace listings with an image carousel.
 *
 * Interroga lo smart contract con getSellerListings(walletAddress) per
 * ottenere tutti gli ID delle inserzioni create dall'utente. Per ognuna
 * recupera dati arricchiti (nome, immagine, stats, prezzo, data creazione)
 * e mostra la prima come foto con tastiera di navigazione prev/next.
 *
 * Queries the smart contract with getSellerListings(walletAddress) to
 * get all listing IDs created by the user. For each one, fetches enriched
 * data (name, image, stats, price, creation date) and displays the first
 * as a photo with prev/next navigation keyboard.
 */
export async function showMyListings(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!marketplaceContract) {
    await ctx.reply("❌ Marketplace contract not configured.");
    return;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  const loadingMsg = await ctx.reply("🔄 Loading your listings...");

  try {
    // Recupera gli ID delle inserzioni di questo venditore e filtra le attive
    // Fetch listing IDs for this seller and filter active ones
    const listingIds = await marketplaceContract.getSellerListings(walletAddress);
    const activeListings: import("../types.js").MarketplaceListing[] = [];

    // Controlla i listing piu' recenti per primi (gli ultimi nell'array)
    // Check most recent listings first (last in the array)
    // Nota: ethers.js restituisce Result (frozen) — [...] lo converte in array mutabile
    // Note: ethers.js returns Result (frozen) — [...] converts it to a mutable array
    const recentIds = [...listingIds].slice(-20).reverse();
    for (const listingId of recentIds) {
      try {
        const listing = await getEnrichedListing(Number(listingId));
        if (listing && listing.active) {
          activeListings.push(listing);
        }
      } catch {}
    }

    // Cancella il messaggio di caricamento
    // Delete loading message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}

    if (activeListings.length === 0) {
      await ctx.reply("📭 You don't have any active listings!", {
        reply_markup: new InlineKeyboard()
          .text("💰 Sell a Card", "action_sell")
          .row()
          .text("🏠 Menu", "main_menu")
      });
      return;
    }

    // Mostra la prima inserzione come carousel
    // Show first listing as carousel
    await showMyListingAt(ctx, activeListings, 0);

  } catch (error) {
    console.error("[showMyListings] OUTER ERROR:", error);
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}
    await ctx.reply("❌ Error fetching listings.", {
      reply_markup: getMainMenuKeyboard()
    });
  }
}

/**
 * Costruisce la didascalia e la tastiera per una singola inserzione dell'utente.
 * Builds the caption and keyboard for a single user listing.
 *
 * Usata sia da showMyListings() (invio iniziale) sia dai callback di navigazione
 * (quando l'utente preme prev/next per cambiare carta nel carousel).
 *
 * Used by both showMyListings() (initial send) and navigation callbacks
 * (when the user presses prev/next to switch cards in the carousel).
 *
 * @param listing - Il listing arricchito da mostrare / The enriched listing to display
 * @param index   - Indice corrente nel carousel / Current index in the carousel
 * @param total   - Totale inserzioni attive / Total active listings
 * @returns Oggetto con caption e keyboard / Object with caption and keyboard
 */
export function buildMyListingView(
  listing: import("../types.js").MarketplaceListing,
  index: number,
  total: number
) {
  const type = listing.stats ? (POKEMON_TYPES[listing.stats.pokemonType] || "Unknown") : "Unknown";
  const typeEmoji = TYPE_EMOJIS[type] || "❓";
  const rarity = listing.stats ? (RARITIES[listing.stats.rarity] || RARITIES[0]) : RARITIES[0];
  const priceEth = ethers.formatEther(listing.price);

  const caption = `🎴 *${listing.name || `Card #${listing.tokenId}`}*

${rarity.emoji} *Rarity:* ${rarity.name}
${typeEmoji} *Type:* ${type}

❤️ HP: ${listing.stats?.hp || "?"} | ⚔️ ATK: ${listing.stats?.attack || "?"}
🛡️ DEF: ${listing.stats?.defense || "?"} | 💨 SPD: ${listing.stats?.speed || "?"}

💰 *Price:* ${priceEth} ETH
⏰ *Listed:* ${listing.createdAt ? formatTimeAgo(listing.createdAt) : "Unknown"}
🆔 *Listing:* #${listing.listingId}`;

  // Tastiera di navigazione: prev, counter, next + cancel + menu
  // Navigation keyboard: prev, counter, next + cancel + menu
  const keyboard = new InlineKeyboard();

  // Riga navigazione (prev / counter / next)
  // Navigation row (prev / counter / next)
  if (total > 1) {
    const prevIndex = (index - 1 + total) % total;
    const nextIndex = (index + 1) % total;
    keyboard
      .text("« Prev", `my_listing_${prevIndex}`)
      .text(`${index + 1}/${total}`, "noop")
      .text("Next »", `my_listing_${nextIndex}`);
    keyboard.row();
  }

  keyboard.text("❌ Cancel Listing", `cancel_my_listing_${listing.listingId}`);
  keyboard.row();
  keyboard.text("🛍️ Marketplace", "browse_market_0").text("🏠 Menu", "main_menu");

  return { caption, keyboard };
}

/**
 * Invia una singola inserzione come messaggio con foto nel carousel.
 * Sends a single listing as a photo message in the carousel.
 *
 * Chiamata al primo caricamento (showMyListings) per inviare il messaggio iniziale.
 * Called on first load (showMyListings) to send the initial message.
 *
 * @param ctx      - Contesto grammY / grammY context
 * @param listings - Array di inserzioni attive dell'utente / Array of user's active listings
 * @param index    - Indice della inserzione da mostrare / Index of the listing to show
 */
export async function showMyListingAt(
  ctx: MyContext,
  listings: import("../types.js").MarketplaceListing[],
  index: number
) {
  const listing = listings[index];
  const { caption, keyboard } = buildMyListingView(listing, index, listings.length);

  if (listing.imageUrl) {
    try {
      await ctx.replyWithPhoto(listing.imageUrl, {
        caption,
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return;
    } catch (imgError) {
      console.error("My listing image send failed:", imgError);
    }
  }

  // Fallback a testo se l'immagine non e' disponibile
  // Fallback to text if image is unavailable
  await ctx.reply(caption + "\n\n📷 _(Image unavailable)_", {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
}

// =============================================================================
// SEZIONE 4: WALLET (PORTAFOGLIO)
//
// Il bot offre un wallet "custodial" integrato: il portafoglio crypto viene
// creato e gestito dal bot stesso, con la chiave privata criptata e salvata
// sul server. L'utente non deve installare MetaMask o altre app esterne.
//
// The bot offers a built-in "custodial" wallet: the crypto wallet is created
// and managed by the bot itself, with the private key encrypted and saved on
// the server. The user doesn't need to install MetaMask or other external apps.
//
// Vantaggi / Advantages:
// - Semplicita': basta un tap per comprare/vendere NFT
//   Simplicity: just one tap to buy/sell NFTs
// - Nessuna app esterna necessaria
//   No external app needed
//
// Sicurezza / Security:
// - La chiave privata puo' essere esportata (per importare in MetaMask)
//   The private key can be exported (to import into MetaMask)
// - I messaggi sensibili (saldi, chiavi) vengono auto-cancellati dopo un timeout
//   Sensitive messages (balances, keys) are auto-deleted after a timeout
// =============================================================================

/**
 * Mostra la schermata di gestione del wallet.
 * Shows the wallet management screen.
 *
 * Se l'utente ha gia' uno o piu' wallet:
 * If the user already has one or more wallets:
 * - Mostra la lista dei wallet con nome, indirizzo abbreviato e saldo ETH
 *   Shows the wallet list with name, abbreviated address, and ETH balance
 * - Evidenzia il wallet attivo con un segno di spunta (usato per le transazioni)
 *   Highlights the active wallet with a checkmark (used for transactions)
 * - Offre bottoni per: Deposito, Prelievo, Esporta chiave privata,
 *   Esporta seed phrase, Crea nuovo wallet, Cambia wallet, Etherscan
 *   Offers buttons for: Deposit, Withdraw, Export private key,
 *   Export seed phrase, Create new wallet, Switch wallet, Etherscan
 *
 * Se l'utente non ha wallet:
 * If the user has no wallets:
 * - Mostra un messaggio introduttivo e un bottone "Create Wallet"
 *   Shows an introductory message and a "Create Wallet" button
 *
 * Nota: usa sendSensitiveMessage() per i dati sensibili (saldi) - il messaggio
 * verra' auto-cancellato dopo un certo tempo per proteggere la privacy.
 *
 * Note: uses sendSensitiveMessage() for sensitive data (balances) - the message
 * will be auto-deleted after a certain time to protect privacy.
 */
export async function showWallet(ctx: MyContext, viewWalletId?: string, editMessage?: boolean) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Mostra caricamento solo per nuovi messaggi (non per editMessage)
  // Show loading only for new messages (not for editMessage)
  let loadingMsg: any = null;
  if (!editMessage) {
    loadingMsg = await ctx.reply("🔄 Loading wallet...");
  }

  try {
    const walletManager = getWalletManager();
    const wallets = await walletManager.listWallets(userId);

    if (wallets.length === 0) {
      if (loadingMsg) {
        try { await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id); } catch {}
      }
      const keyboard = new InlineKeyboard()
        .text("✨ Create Wallet", "wallet_create");

      await ctx.reply(
        `👛 *No wallets found*

Create your first wallet to:
• Buy NFTs with one click
• Receive royalties automatically

🔐 The wallet will be encrypted and secure.
🦊 Compatible with MetaMask!`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
      return;
    }

    // Determina quale wallet mostrare
    // Determine which wallet to display
    let selectedWallet = wallets.find(w => w.isActive) || wallets[0];
    if (viewWalletId) {
      const found = wallets.find(w => w.id === viewWalletId);
      if (found) selectedWallet = found;
    }

    // Aggiorna la sessione con il wallet attivo (solo se stiamo guardando l'attivo)
    // Update session with active wallet (only if viewing the active one)
    if (selectedWallet.isActive) {
      const session = sessionStore.getOrCreate(userId, ctx.from?.username, ctx.from?.first_name);
      session.walletAddress = selectedWallet.address;
      sessionStore.save(session);
    }

    // Recupera prezzo ETH e statistiche wallet in parallelo
    // Fetch ETH price and wallet stats in parallel
    const [ethPrice, walletStats] = await Promise.all([
      getEthPriceUSD(),
      getWalletStats(selectedWallet.address),
    ]);

    if (loadingMsg) {
      try { await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id); } catch {}
    }

    const balance = parseFloat(selectedWallet.balanceFormatted);
    const usdValue = ethPrice ? (balance * ethPrice).toFixed(2) : null;

    // Costruisci il messaggio principale
    // Build the main message
    let message = `👛 <b>${selectedWallet.name}</b>`;
    if (selectedWallet.isActive) message += ` <i>(active)</i>`;
    message += `\n\n`;

    // Saldo ETH + valore USD
    // ETH balance + USD value
    message += `💰 <b>${selectedWallet.balanceFormatted} ETH</b>`;
    if (usdValue) message += ` <i>(~$${usdValue})</i>`;
    message += `\n`;

    // Statistiche NFT
    // NFT statistics
    message += `🎴 NFTs Held: <b>${walletStats.nftsHeld}</b>\n`;
    message += `📋 Listed: <b>${walletStats.nftsListed}</b>\n`;
    message += `💵 Sales: <b>${walletStats.totalSalesETH} ETH</b>\n`;
    message += `👑 Royalties: <i>Coming soon</i>\n`;

    // Tastiera con azioni wallet
    // Keyboard with wallet actions
    const keyboard = new InlineKeyboard()
      .text("💰 Deposit", "wallet_deposit")
      .text("📤 Withdraw", "wallet_withdraw")
      .row()
      .text("🔐 Export / Backup", "wallet_export_menu")
      .text("⛽ Get Test ETH", "wallet_faucet_info")
      .row()
      .url("📊 Etherscan", getEtherscanLink("address", selectedWallet.address))
      .row();

    // Se si sta guardando un wallet non attivo, mostra bottone "Set as Active"
    // If viewing a non-active wallet, show "Set as Active" button
    if (!selectedWallet.isActive) {
      keyboard.text("✅ Set as Active", `wallet_select_${selectedWallet.id}`).row();
    }

    // Mostra gli altri wallet come pulsanti cliccabili
    // Show other wallets as clickable buttons
    const otherWallets = wallets.filter(w => w.id !== selectedWallet.id);
    if (otherWallets.length > 0) {
      for (const w of otherWallets) {
        keyboard.text(
          `${w.name} · ${w.balanceFormatted} ETH`,
          `wallet_view_${w.id}`
        );
      }
      keyboard.row();
    }

    keyboard.text("➕ New Wallet", "wallet_create_new")
      .text("🏠 Menu", "main_menu");

    if (editMessage) {
      // Aggiorna il messaggio esistente (switch tra wallet)
      // Update the existing message (switching between wallets)
      await ctx.editMessageText(message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } else {
      await sendSensitiveMessage(
        bot,
        ctx.chat!.id,
        message,
        SENSITIVITY_LEVELS.BALANCE,
        keyboard
      );
    }
  } catch (error) {
    console.error("Error in showWallet:", error);
    if (loadingMsg) {
      try { await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id); } catch {}
    }
    await ctx.reply("❌ Error loading wallets. Please try again later.");
  }
}

// =============================================================================
// SEZIONE 5: INFORMAZIONI CONTRATTI / CONTRACT INFORMATION
// =============================================================================

/**
 * Mostra gli indirizzi degli smart contract deployati sulla rete.
 * Shows the addresses of smart contracts deployed on the network.
 *
 * Per ogni contratto configurato (CustomCards, Marketplace), mostra:
 * For each configured contract (CustomCards, Marketplace), shows:
 * - Il nome del contratto / The contract name
 * - L'indirizzo completo (copiabile) / The full address (copyable)
 * - Un link a Etherscan per la verifica pubblica del codice sorgente
 *   A link to Etherscan for public source code verification
 *
 * Utile per sviluppatori e utenti che vogliono verificare che i contratti
 * siano quelli ufficiali e il codice sia stato verificato (open source).
 *
 * Useful for developers and users who want to verify that the contracts
 * are the official ones and the code has been verified (open source).
 */
export async function showContracts(ctx: MyContext) {
  let message = `📜 *Contracts (${NETWORK.name})*\n\n`;

  // Lista dei contratti da mostrare (facilmente estendibile)
  // List of contracts to display (easily extendable)
  const contracts = [
    { name: "CustomCards", addr: CONTRACTS.CUSTOM_CARDS },
    { name: "Marketplace", addr: CONTRACTS.MARKETPLACE },
  ];

  for (const c of contracts) {
    if (c.addr) {
      message += `*${c.name}:*\n\`${c.addr}\`\n[Etherscan](${getEtherscanLink("address", c.addr)})\n\n`;
    }
  }

  message += `_All verified and open source_`;

  // Disabilita l'anteprima dei link per evitare preview di Etherscan
  // Disable link preview to avoid Etherscan previews
  await ctx.reply(message, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
}
