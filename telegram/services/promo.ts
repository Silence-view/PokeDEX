// =============================================================================
// SERVIZIO PROMOZIONALE - Messaggi condivisibili e contenuti dinamici
// PROMOTIONAL SERVICE - Shareable messages and dynamic content
// =============================================================================

import { InlineKeyboard } from "grammy";

// =============================================================================
// BOT USERNAME E DEEP LINK
// BOT USERNAME AND DEEP LINKS
// =============================================================================

const BOT_USERNAME = process.env.BOT_USERNAME || "pokedex_nft_bot";

export function createDeepLink(param: string): string {
  return `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(param)}`;
}

function createShareUrl(deepLink: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(text)}`;
}

// =============================================================================
// POKEMON GIF URLs - Sprite animate da Pokemon Showdown
// POKEMON GIF URLs - Animated sprites from Pokemon Showdown
// =============================================================================

const POKEMON_GIFS = [
  "https://play.pokemonshowdown.com/sprites/xyani/pikachu.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/charizard.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/mewtwo.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/gengar.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/dragonite.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/eevee.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/lucario.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/gardevoir.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/gyarados.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/blaziken.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/umbreon.gif",
  "https://play.pokemonshowdown.com/sprites/xyani/snorlax.gif",
];

function getRandomGif(): string {
  return POKEMON_GIFS[Math.floor(Math.random() * POKEMON_GIFS.length)];
}

// =============================================================================
// MESSAGGI PROMOZIONALI ROTANTI
// ROTATING PROMOTIONAL MESSAGES
// =============================================================================

interface PromoMessage {
  caption: string;
  gif: string;
}

const PROMO_MESSAGES: PromoMessage[] = [
  {
    gif: "https://play.pokemonshowdown.com/sprites/xyani/charizard.gif",
    caption:
`🔥🔥🔥 *PokeDEX NFT* 🔥🔥🔥
━━━━━━━━━━━━━━━━━━━━━

⚡ Create \u2022 Collect \u2022 Trade ⚡

🎴 Design your own Pokemon cards
🛒 Trade them on the marketplace
💰 Earn from every resale

✨ *All on Telegram, no apps needed!* ✨

━━━━━━━━━━━━━━━━━━━━━
👇 *Share with your friends!* 👇`
  },
  {
    gif: "https://play.pokemonshowdown.com/sprites/xyani/pikachu.gif",
    caption:
`⚡⚡⚡ *Gotta Mint 'Em All!* ⚡⚡⚡
━━━━━━━━━━━━━━━━━━━━━

🎮 *PokeDEX NFT* is live!

🎨 Create unique Pokemon cards
🏆 From Common to Legendary
💎 Own them forever on Ethereum

🔥 What are you waiting for?

━━━━━━━━━━━━━━━━━━━━━
👇 *Join the adventure!* 👇`
  },
  {
    gif: "https://play.pokemonshowdown.com/sprites/xyani/mewtwo.gif",
    caption:
`✨🟡✨ *LEGENDARY AWAITS* ✨🟡✨
━━━━━━━━━━━━━━━━━━━━━

🐉 *PokeDEX NFT Trading Cards*

Create cards with custom stats:
❤️ HP \u2022 ⚔️ ATK \u2022 🛡️ DEF \u2022 💨 SPD

🛒 Sell on the Marketplace
👛 Built-in wallet, zero setup
🔒 Secured on Sepolia testnet

━━━━━━━━━━━━━━━━━━━━━
👇 *Start your collection now!* 👇`
  },
  {
    gif: "https://play.pokemonshowdown.com/sprites/xyani/gengar.gif",
    caption:
`👻 *Did someone say NFTs?* 👻
━━━━━━━━━━━━━━━━━━━━━

🎴 *PokeDEX* - The NFT Card Game

✅ 100% on Telegram
✅ Free to start
✅ Create cards in minutes
✅ Trade with real ETH

⭐ ★★★★★ Legendary drops daily!

━━━━━━━━━━━━━━━━━━━━━
👇 *Join thousands of trainers!* 👇`
  },
  {
    gif: "https://play.pokemonshowdown.com/sprites/xyani/dragonite.gif",
    caption:
`🐉 *DRAGON POWER!* 🐉
━━━━━━━━━━━━━━━━━━━━━

🎮 *PokeDEX NFT Trading Cards*

🎨 Design your dream Pokemon card
⚔️ Set custom battle stats
💰 List it on the marketplace
🎉 Profit from resales!

18 Types \u2022 5 Rarities \u2022 Infinite Fun

━━━━━━━━━━━━━━━━━━━━━
👇 *Become a card master!* 👇`
  },
  {
    gif: "https://play.pokemonshowdown.com/sprites/xyani/eevee.gif",
    caption:
`🌟 *Choose Your Path!* 🌟
━━━━━━━━━━━━━━━━━━━━━

🎴 *PokeDEX NFT* on Telegram

🎨 Creator? Design unique cards
🛒 Trader? Buy low, sell high
💎 Collector? Catch 'em all!

👛 Wallet included, start in seconds

━━━━━━━━━━━━━━━━━━━━━
👇 *Pick your role!* 👇`
  },
];

export function getRandomPromo(): PromoMessage {
  return PROMO_MESSAGES[Math.floor(Math.random() * PROMO_MESSAGES.length)];
}

export function getTimedPromo(): PromoMessage {
  const index = Math.floor(Date.now() / (3 * 60 * 60 * 1000)) % PROMO_MESSAGES.length;
  return PROMO_MESSAGES[index];
}

// =============================================================================
// SHARE MESSAGE BUILDER
// =============================================================================

export function buildShareMessage(userId: number): {
  caption: string;
  gif: string;
  keyboard: InlineKeyboard;
} {
  const referralLink = createDeepLink(`ref_${userId}`);
  const shareUrl = createShareUrl(
    referralLink,
    "Join PokeDEX NFT! Create and trade Pokemon cards on Telegram! ⚡🎴"
  );

  const promo = getRandomPromo();

  const keyboard = new InlineKeyboard()
    .url("📤 Share with Friends", shareUrl)
    .row()
    .url("🎮 Open PokeDEX", referralLink)
    .row()
    .text("🏠 Menu", "main_menu");

  return {
    caption: promo.caption,
    gif: promo.gif,
    keyboard,
  };
}

// =============================================================================
// BROADCAST MESSAGE BUILDER
// =============================================================================

export function buildBroadcastMessage(): {
  caption: string;
  gif: string;
  keyboard: InlineKeyboard;
} {
  const promo = getTimedPromo();
  const botLink = `https://t.me/${BOT_USERNAME}`;

  const keyboard = new InlineKeyboard()
    .url("📤 Share with Friends", createShareUrl(botLink, "Join PokeDEX NFT! ⚡🎴"))
    .row()
    .text("🎴 My Cards", "action_my_cards")
    .text("🛒 Marketplace", "action_marketplace")
    .row()
    .text("🔕 Disable Notifications", "toggle_notifications");

  return {
    caption: promo.caption,
    gif: promo.gif,
    keyboard,
  };
}

// =============================================================================
// DYNAMIC TEXT EFFECTS
// =============================================================================

const ROTATING_TIPS = [
  "💡 *Tip:* Higher rarity cards earn more when resold!",
  "💡 *Tip:* Dragon 🐉 and Legendary 🟡 cards are the most valuable!",
  "💡 *Tip:* Export your wallet to MetaMask for full control!",
  "💡 *Tip:* Share PokeDEX with friends using the 📤 button!",
  "💡 *Tip:* Your card stats affect total battle power!",
  "💡 *Tip:* Creators earn royalties on every resale!",
  "💡 *Tip:* Need test ETH? Use /wallet and tap the faucet!",
  "💡 *Tip:* Fire 🔥 beats Grass 🌿, Water 💧 beats Fire 🔥!",
  "💡 *Tip:* Cards with balanced stats are great all-rounders!",
  "💡 *Tip:* Browse /market daily for new listings!",
];

export function getRotatingTip(): string {
  const index = new Date().getHours() % ROTATING_TIPS.length;
  return ROTATING_TIPS[index];
}

export function createStatBar(value: number, max: number = 255): string {
  const filled = Math.round((value / max) * 8);
  return "▓".repeat(filled) + "░".repeat(8 - filled);
}

export function getRarityStars(rarity: number): string {
  return "★".repeat(rarity + 1) + "☆".repeat(4 - rarity);
}

export function getTypeBorder(typeName: string): string {
  const borders: Record<string, string> = {
    Fire: "🔥",
    Water: "💧",
    Electric: "⚡",
    Grass: "🌿",
    Dragon: "🐉",
    Psychic: "🔮",
    Ghost: "👻",
    Ice: "❄️",
    Fairy: "🧚",
    Dark: "🌑",
    Fighting: "👊",
    Poison: "☠️",
    Steel: "⚙️",
    Rock: "🪨",
    Ground: "🌍",
    Flying: "🦅",
    Bug: "🐛",
    Normal: "⬜",
  };
  const emoji = borders[typeName] || "✨";
  return `${emoji}━━━━━━━━━━━━━━━━━━━${emoji}`;
}

export function getRarityHeader(rarity: number): string {
  switch (rarity) {
    case 4: return "✨🟡✨ LEGENDARY ✨🟡✨";
    case 3: return "🟣 ULTRA RARE 🟣";
    case 2: return "🔵 RARE 🔵";
    case 1: return "🟢 UNCOMMON 🟢";
    default: return "⚪ COMMON ⚪";
  }
}
