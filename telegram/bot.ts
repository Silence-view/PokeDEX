import { Bot, Context, InlineKeyboard, session, GrammyError, HttpError, InputFile } from "grammy";
import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { limit } from "@grammyjs/ratelimiter";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import pinataSDK from "@pinata/sdk";
import { sessionStore, draftStore, cardCacheStore, type UserSession, type CardDraft, type SessionState, type NFTMetadata, type NFTAttribute } from "./storage/index.js";
import {
  WalletManager,
  initializeWalletManager,
  getWalletManager,
  sendSensitiveMessage,
  scheduleMessageDeletion,
  SENSITIVITY_LEVELS,
  exportKeyRateLimiter,
  withdrawRateLimiter,
  marketplaceRateLimiter,
} from "./wallet/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface CardStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  pokemonType: number;
  rarity: number;
  generation: number;
  experience: number;
}

interface BotSession {
  telegramUserId: number;
  walletAddress?: string;
  currentState: SessionState;
  currentDraftId?: string;
}

type MyContext = Context & ConversationFlavor<Context> & { session: BotSession };
type MyConversation = Conversation<MyContext>;

// =============================================================================
// CONSTANTS
// =============================================================================

const POKEMON_TYPES = [
  "Normal", "Fire", "Water", "Electric", "Grass", "Ice",
  "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug",
  "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"
];

const RARITIES = [
  { name: "Common", emoji: "⚪", color: "#9E9E9E" },
  { name: "Uncommon", emoji: "🟢", color: "#4CAF50" },
  { name: "Rare", emoji: "🔵", color: "#2196F3" },
  { name: "Ultra Rare", emoji: "🟣", color: "#9C27B0" },
  { name: "Legendary", emoji: "🟡", color: "#FFD700" }
];

const TYPE_EMOJIS: Record<string, string> = {
  Normal: "⬜", Fire: "🔥", Water: "💧", Electric: "⚡", Grass: "🌿",
  Ice: "❄️", Fighting: "👊", Poison: "☠️", Ground: "🌍", Flying: "🦅",
  Psychic: "🔮", Bug: "🐛", Rock: "🪨", Ghost: "👻", Dragon: "🐉",
  Dark: "🌑", Steel: "⚙️", Fairy: "🧚"
};

const CONTRACTS = {
  POKEDEX_CARD: process.env.POKEDEX_CARD_ADDRESS || "",
  CARD_PACK: process.env.CARD_PACK_ADDRESS || "",
  CARD_PACK_QRNG: process.env.CARD_PACK_QRNG_ADDRESS || "",
  BATTLE_ARENA: process.env.BATTLE_ARENA_ADDRESS || "",
  CUSTOM_CARDS: process.env.CUSTOM_CARDS_ADDRESS || "",
  MARKETPLACE: process.env.MARKETPLACE_ADDRESS || ""
};

const NETWORK = {
  name: "Sepolia",
  chainId: 11155111,
  explorer: "https://sepolia.etherscan.io"
};

const PACK_PRICES = { basic: "0.01", premium: "0.025", legendary: "0.05" };

// Wallets directory for custodial wallets
const WALLETS_DIR = path.resolve(__dirname, "../data/wallets");

// CRITICAL SECURITY: Master key must be set via environment variable
if (!process.env.WALLET_MASTER_KEY) {
  console.error("❌ CRITICAL: WALLET_MASTER_KEY environment variable is not set!");
  console.error("   This key encrypts all user wallet data. Generate a secure random key:");
  console.error("   openssl rand -hex 32");
  process.exit(1);
}
const WALLET_MASTER_KEY = process.env.WALLET_MASTER_KEY;

// =============================================================================
// WALLET ADDRESS HELPER
// =============================================================================

interface WalletAddressInfo {
  address: string;
  balance: string;
  balanceFormatted: string;
}

/**
 * Gets the user's wallet address, prioritizing custodial wallet
 * @param userId Telegram user ID
 * @returns Wallet address or null if none exists
 */
async function getUserWalletAddress(userId: number): Promise<string | null> {
  // Try custodial wallet first
  try {
    const walletManager = getWalletManager();
    if (walletManager.hasWallet(userId)) {
      const walletInfo = await walletManager.getWallet(userId);
      if (walletInfo?.address) {
        return walletInfo.address;
      }
    }
  } catch (error) {
    console.error("Error checking custodial wallet:", error);
  }

  // Fall back to session wallet
  const session = sessionStore.get(userId);
  return session?.walletAddress || null;
}

/**
 * Gets the user's wallet address with balance info, prioritizing custodial wallet
 * @param userId Telegram user ID
 * @returns Wallet info with address and balance, or null if none exists
 */
async function getUserWalletWithBalance(userId: number): Promise<WalletAddressInfo | null> {
  // Try custodial wallet first
  try {
    const walletManager = getWalletManager();
    if (walletManager.hasWallet(userId)) {
      const walletInfo = await walletManager.getWallet(userId);
      if (walletInfo?.address) {
        return {
          address: walletInfo.address,
          balance: walletInfo.balance,
          balanceFormatted: walletInfo.balanceFormatted
        };
      }
    }
  } catch (error) {
    console.error("Error checking custodial wallet:", error);
  }

  // Fall back to session wallet (no balance info available)
  const session = sessionStore.get(userId);
  if (session?.walletAddress) {
    try {
      const balance = await provider.getBalance(session.walletAddress);
      return {
        address: session.walletAddress,
        balance: balance.toString(),
        balanceFormatted: ethers.formatEther(balance)
      };
    } catch {
      return {
        address: session.walletAddress,
        balance: "0",
        balanceFormatted: "0"
      };
    }
  }

  return null;
}

// =============================================================================
// RARITY SYSTEM - Stats generated based on rarity tier
// =============================================================================

interface RarityStatConfig {
  minStat: number;
  maxStat: number;
  totalStatBudget: number;
}

const RARITY_STAT_CONFIGS: Record<number, RarityStatConfig> = {
  0: { minStat: 20, maxStat: 60, totalStatBudget: 160 },   // Common
  1: { minStat: 40, maxStat: 80, totalStatBudget: 240 },   // Uncommon
  2: { minStat: 60, maxStat: 120, totalStatBudget: 360 },  // Rare
  3: { minStat: 80, maxStat: 180, totalStatBudget: 520 },  // Ultra Rare
  4: { minStat: 120, maxStat: 255, totalStatBudget: 760 }, // Legendary
};

// Dynamic rarity formula weights
const RARITY_WEIGHTS = {
  price: 25,      // Market price relative to floor
  holders: 15,    // Fewer holders = rarer
  volume: 20,     // Trading volume
  age: 10,        // Older = more valuable
  creator: 15,    // Creator reputation
  onChain: 15,    // Battle stats, experience
};

function generateStatsForRarity(rarity: number): { hp: number; attack: number; defense: number; speed: number } {
  const config = RARITY_STAT_CONFIGS[rarity] || RARITY_STAT_CONFIGS[0];

  // Generate balanced stats within rarity range
  const stats = { hp: 0, attack: 0, defense: 0, speed: 0 };
  let remaining = config.totalStatBudget;
  const statKeys: (keyof typeof stats)[] = ['hp', 'attack', 'defense', 'speed'];

  for (let i = 0; i < statKeys.length; i++) {
    const key = statKeys[i];
    const isLast = i === statKeys.length - 1;

    if (isLast) {
      stats[key] = Math.min(Math.max(remaining, config.minStat), config.maxStat);
    } else {
      const minForStat = config.minStat;
      const maxForStat = Math.min(
        config.maxStat,
        remaining - (config.minStat * (statKeys.length - i - 1))
      );
      const value = Math.floor(minForStat + Math.random() * (maxForStat - minForStat));
      stats[key] = value;
      remaining -= value;
    }
  }

  // HP must be at least 1
  if (stats.hp < 1) stats.hp = Math.max(1, config.minStat);

  return stats;
}

// Calculate dynamic rarity score (0-100)
function calculateDynamicRarityScore(inputs: {
  currentPriceEth: number;
  floorPriceEth: number;
  totalVolumeEth: number;
  transferCount: number;
  daysSinceMint: number;
  isGenesis: boolean;
  creatorVerified: boolean;
  creatorTotalSalesEth: number;
  creatorCardCount: number;
  experience: number;
  battleWins: number;
  battleTotal: number;
}): number {
  // Price Score (25%)
  const priceRatio = inputs.floorPriceEth > 0 ? inputs.currentPriceEth / inputs.floorPriceEth : 1;
  const priceScore = Math.min(100, priceRatio * 20);

  // Holder/Provenance Score (15%) - more transfers = more history
  const holderScore = Math.min(100, inputs.transferCount * 10);

  // Volume Score (20%) - logarithmic scale
  const volumeScore = Math.min(100, Math.log10(inputs.totalVolumeEth + 1) * 25);

  // Age Score (10%)
  const ageBase = Math.min(50, (inputs.daysSinceMint / 365) * 50);
  const ageScore = ageBase + (inputs.isGenesis ? 25 : 0);

  // Creator Score (15%)
  const creatorScore =
    (inputs.creatorVerified ? 30 : 0) +
    Math.min(40, inputs.creatorTotalSalesEth / 10 * 40) +
    Math.min(30, (inputs.creatorCardCount / 100) * 30);

  // On-Chain Metrics Score (15%)
  const winRate = inputs.battleTotal > 0 ? inputs.battleWins / inputs.battleTotal : 0.5;
  const expScore = Math.min(40, (inputs.experience / 1000000) * 40);
  const provenanceScore = Math.min(30, inputs.transferCount * 6);
  const onChainScore = (winRate * 30) + expScore + provenanceScore;

  // Weighted total
  return Math.round(
    (priceScore * RARITY_WEIGHTS.price / 100) +
    (holderScore * RARITY_WEIGHTS.holders / 100) +
    (volumeScore * RARITY_WEIGHTS.volume / 100) +
    (ageScore * RARITY_WEIGHTS.age / 100) +
    (creatorScore * RARITY_WEIGHTS.creator / 100) +
    (onChainScore * RARITY_WEIGHTS.onChain / 100)
  );
}

function scoreToRarityTier(score: number): number {
  if (score >= 86) return 4; // Legendary
  if (score >= 71) return 3; // Ultra Rare
  if (score >= 51) return 2; // Rare
  if (score >= 31) return 1; // Uncommon
  return 0; // Common
}

// =============================================================================
// SECURITY NOTICES (Best practices from research)
// =============================================================================

const SECURITY_NOTICE = `
🔒 *SECURITY - READ CAREFULLY*

This bot *NEVER* asks for:
• Your private key
• Your seed phrase (12/24 words)
• Access to your wallet

*How transactions work:*
1. The bot provides an Etherscan link
2. Connect YOUR wallet (MetaMask)
3. Sign the transaction from YOUR device

⚠️ *BEWARE OF SCAMMERS:*
• Don't reply to DMs from "support"
• Official support will never DM you first
• Always verify the bot username: @${process.env.BOT_USERNAME || "pokedex_nft_bot"}

🛡️ This bot is open source and verified.
`;

const ANTI_PHISHING_WARNING = `
⚠️ *ANTI-PHISHING WARNING*

Before interacting with any contract:
1. Verify the address on Etherscan
2. Check that it's the verified contract
3. Don't sign suspicious transactions
4. If in doubt, ask in the official group
`;

// =============================================================================
// CONTRACT ABIs
// =============================================================================

const CARD_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getCardStats(uint256 tokenId) view returns (tuple(uint16 hp, uint16 attack, uint16 defense, uint16 speed, uint8 pokemonType, uint8 rarity, uint8 generation, uint32 experience))",
  "function calculateBattlePower(uint256 tokenId) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokensOfOwner(address owner) view returns (uint256[])"
];

const PACK_ABI = [
  "function getPackPrice(uint8 packType) view returns (uint256)",
  // Note: Returns bytes32[] but uint256[] works due to identical ABI encoding
  // Using bytes32[] for correctness with the contract interface
  "function getUserPendingRequests(address user) view returns (bytes32[])",
  "function purchasePack(uint8 packType) payable returns (uint256)"
];

const BATTLE_ABI = [
  "function getPlayerStats(address player) view returns (tuple(uint64 wins, uint64 losses, uint64 totalBattles, uint32 currentStreak, uint32 bestStreak))",
  "function getLeaderboard(uint256 limit) view returns (address[], uint256[])",
  "function getBattle(uint256 battleId) view returns (tuple(address challenger, uint48 createdAt, uint8 status, address opponent, uint48 completedAt, uint48 challengerCardId, address winner, uint48 opponentCardId, uint256 battleId))",
  "function getPlayerPendingChallenges(address player) view returns (uint256[])"
];

const CUSTOM_CARDS_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function mintingFee() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getCardStats(uint256 tokenId) view returns (tuple(uint16 hp, uint16 attack, uint16 defense, uint16 speed, uint8 cardType, uint8 rarity, address creator, uint256 createdAt, bool verified))",
  "function getCreatorCards(address creator) view returns (uint256[])",
  "function isBanned(uint256 tokenId) view returns (bool)",
  "function calculateBattlePower(uint256 tokenId) view returns (uint256)",
  "function createCard(string metadataURI, uint16 hp, uint16 attack, uint16 defense, uint16 speed, uint8 cardType, uint8 rarity, uint96 royaltyPercentage) payable returns (uint256)"
];

const MARKETPLACE_ABI = [
  "function marketplaceFee() view returns (uint256)",
  "function getListing(uint256 listingId) view returns (tuple(address seller, address nftContract, uint256 tokenId, uint256 price, bool active, uint256 createdAt, string imageURI))",
  "function getOffer(uint256 offerId) view returns (tuple(address buyer, address nftContract, uint256 tokenId, uint256 amount, uint256 expiresAt, bool active))",
  "function getSellerListings(address seller) view returns (uint256[])",
  "function getBuyerOffers(address buyer) view returns (uint256[])",
  "function totalListings() view returns (uint256)",
  "function listNFT(address nftContract, uint256 tokenId, uint256 price, string imageURI) returns (uint256)",
  "function buyNFT(uint256 listingId) payable",
  "function cancelListing(uint256 listingId)",
  "function makeOffer(address nftContract, uint256 tokenId, uint256 expiresIn) payable returns (uint256)",
  "function acceptOffer(uint256 offerId)",
  "function cancelOffer(uint256 offerId)",
  "event NFTListed(uint256 indexed listingId, address indexed seller, address indexed nftContract, uint256 tokenId, uint256 price)",
  "event NFTSold(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price)"
];

// =============================================================================
// PROVIDER & CONTRACTS
// =============================================================================

const provider = new ethers.JsonRpcProvider(
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com"
);

// Signer for sending transactions (bot wallet)
let signer: ethers.Wallet | null = null;
if (process.env.PRIVATE_KEY) {
  signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`🔑 Bot wallet: ${signer.address}`);
}

let cardContract: ethers.Contract | null = null;
let packContract: ethers.Contract | null = null;
let packQRNGContract: ethers.Contract | null = null;
let battleContract: ethers.Contract | null = null;
let customCardsContract: ethers.Contract | null = null;
let customCardsWritable: ethers.Contract | null = null; // For sending transactions
let marketplaceContract: ethers.Contract | null = null;
let marketplaceWritable: ethers.Contract | null = null; // For marketplace transactions

function initContracts() {
  if (CONTRACTS.POKEDEX_CARD) cardContract = new ethers.Contract(CONTRACTS.POKEDEX_CARD, CARD_ABI, provider);
  if (CONTRACTS.CARD_PACK) packContract = new ethers.Contract(CONTRACTS.CARD_PACK, PACK_ABI, provider);
  if (CONTRACTS.CARD_PACK_QRNG) packQRNGContract = new ethers.Contract(CONTRACTS.CARD_PACK_QRNG, PACK_ABI, provider);
  if (CONTRACTS.BATTLE_ARENA) battleContract = new ethers.Contract(CONTRACTS.BATTLE_ARENA, BATTLE_ABI, provider);
  if (CONTRACTS.CUSTOM_CARDS) {
    customCardsContract = new ethers.Contract(CONTRACTS.CUSTOM_CARDS, CUSTOM_CARDS_ABI, provider);
    if (signer) {
      customCardsWritable = new ethers.Contract(CONTRACTS.CUSTOM_CARDS, CUSTOM_CARDS_ABI, signer);
    }
  }
  if (CONTRACTS.MARKETPLACE) {
    marketplaceContract = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, provider);
    if (signer) {
      marketplaceWritable = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, signer);
    }
  }
}

// Pinata client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pinata: any = null;
if (process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY) {
  pinata = new (pinataSDK as any)(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY);
}

// =============================================================================
// IPFS UPLOAD HELPERS
// =============================================================================

// Security: File validation constants
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB max
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/**
 * Detect image type from buffer magic bytes
 * Returns null if not a recognized image format
 */
function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // Check JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return "image/jpeg";
  }

  // Check PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
    return "image/png";
  }

  // Check GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }

  // Check WebP (RIFF....WEBP)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return "image/webp";
  }

  return null;
}

/**
 * Validate image buffer for security
 * Throws descriptive error if validation fails
 */
function validateImageBuffer(buffer: Buffer, context: string = "image"): void {
  // Check size
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    const maxMB = (MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`${context} is too large (${sizeMB}MB). Maximum size is ${maxMB}MB.`);
  }

  if (buffer.length === 0) {
    throw new Error(`${context} is empty.`);
  }

  // Check type via magic bytes
  const detectedType = detectImageType(buffer);
  if (!detectedType) {
    throw new Error(`${context} is not a valid image format. Allowed: JPEG, PNG, GIF, WebP.`);
  }

  if (!ALLOWED_IMAGE_TYPES.includes(detectedType as typeof ALLOWED_IMAGE_TYPES[number])) {
    throw new Error(`${context} type "${detectedType}" is not allowed. Allowed: JPEG, PNG, GIF, WebP.`);
  }
}

async function downloadPhotoFromTelegram(bot: Bot<MyContext>, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  const filePath = file.file_path;

  if (!filePath) {
    throw new Error("Could not get file path from Telegram");
  }

  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Security: Validate image before returning
  validateImageBuffer(buffer, "Downloaded image");

  return buffer;
}

async function uploadImageToPinata(imageBuffer: Buffer, fileName: string): Promise<string> {
  if (!pinata) throw new Error("Pinata not configured");

  // Security: Defense-in-depth validation before upload
  validateImageBuffer(imageBuffer, "Image for upload");

  const readableStream = Readable.from(imageBuffer);

  const result = await pinata.pinFileToIPFS(readableStream, {
    pinataMetadata: {
      name: fileName,
    },
    pinataOptions: {
      cidVersion: 1
    }
  });

  return result.IpfsHash;
}

// =============================================================================
// INPUT SANITIZATION - Prevent XSS and injection attacks
// =============================================================================

const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Sanitize text for safe use in NFT metadata (prevents HTML/script injection)
 * Removes HTML tags, script content, and dangerous characters
 */
function sanitizeForMetadata(text: string, maxLength: number = 500): string {
  if (!text || typeof text !== "string") return "";

  return text
    // Remove HTML tags
    .replace(/<[^>]*>/g, "")
    // Remove script content
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    // Remove event handlers
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    // Remove javascript: URLs
    .replace(/javascript:/gi, "")
    // Remove data: URLs (could contain scripts)
    .replace(/data:/gi, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize text for safe display in Telegram Markdown
 * Escapes characters that have special meaning in Markdown
 */
function sanitizeForMarkdown(text: string): string {
  if (!text || typeof text !== "string") return "";

  return text
    // Escape markdown special characters
    .replace(/[_*\[\]()~`>#+=|{}.!-]/g, "\\$&")
    .trim();
}

/**
 * Validate and sanitize card name
 */
function sanitizeCardName(name: string): string {
  const sanitized = sanitizeForMetadata(name, MAX_NAME_LENGTH);
  if (sanitized.length === 0) {
    throw new Error("Card name cannot be empty after sanitization");
  }
  // Only allow alphanumeric, spaces, and common punctuation
  return sanitized.replace(/[^a-zA-Z0-9\s\-'!?.]/g, "").trim();
}

/**
 * Validate and sanitize card description
 */
function sanitizeCardDescription(description: string): string {
  return sanitizeForMetadata(description, MAX_DESCRIPTION_LENGTH);
}

async function uploadMetadataToPinata(metadata: NFTMetadata, cardName: string): Promise<string> {
  if (!pinata) throw new Error("Pinata not configured");

  const result = await pinata.pinJSONToIPFS(metadata, {
    pinataMetadata: {
      name: `${cardName}-metadata.json`,
    }
  });

  return result.IpfsHash;
}

function buildNFTMetadata(draft: CardDraft, imageIpfsHash: string): NFTMetadata {
  // Sanitize all user-provided content before including in metadata
  const sanitizedName = sanitizeCardName(draft.cardName);
  const sanitizedDescription = sanitizeCardDescription(
    draft.description || `Custom Pokemon card by ${sanitizeForMetadata(draft.creatorName, MAX_NAME_LENGTH)}`
  );

  return {
    name: sanitizedName,
    description: sanitizedDescription,
    image: `ipfs://${imageIpfsHash}`,
    external_url: "https://pokedex.app",
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
// IPFS GATEWAY HELPERS - Convert IPFS URLs to HTTPS for Telegram display
// =============================================================================

const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/"
];

function ipfsToHttps(ipfsUrl: string): string {
  if (!ipfsUrl) return "";

  // Handle ipfs:// protocol
  if (ipfsUrl.startsWith("ipfs://")) {
    const hash = ipfsUrl.replace("ipfs://", "");
    return `${IPFS_GATEWAYS[0]}${hash}`;
  }

  // Handle /ipfs/ path
  if (ipfsUrl.startsWith("/ipfs/")) {
    const hash = ipfsUrl.replace("/ipfs/", "");
    return `${IPFS_GATEWAYS[0]}${hash}`;
  }

  // Handle raw CID
  if (ipfsUrl.match(/^(Qm|bafy)/i)) {
    return `${IPFS_GATEWAYS[0]}${ipfsUrl}`;
  }

  // Already HTTPS
  return ipfsUrl;
}

async function fetchNFTMetadata(tokenURI: string): Promise<{ name?: string; description?: string; image?: string } | null> {
  try {
    const httpUrl = ipfsToHttps(tokenURI);
    const response = await fetch(httpUrl, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) return null;

    const metadata = await response.json() as { name?: string; description?: string; image?: string };
    return {
      name: metadata.name,
      description: metadata.description,
      image: metadata.image ? ipfsToHttps(metadata.image) : undefined
    };
  } catch (error) {
    console.error("Error fetching NFT metadata:", error);
    return null;
  }
}

// =============================================================================
// MARKETPLACE LISTING INTERFACE
// =============================================================================

interface MarketplaceListing {
  listingId: number;
  seller: string;
  nftContract: string;
  tokenId: number;
  price: bigint;
  active: boolean;
  createdAt: number;
  // Enriched data
  name?: string;
  description?: string;
  imageUrl?: string;
  stats?: CardStats;
}

async function getEnrichedListing(listingId: number): Promise<MarketplaceListing | null> {
  if (!marketplaceContract) return null;

  try {
    const listing = await marketplaceContract.getListing(listingId);

    if (!listing.active) return null;

    const enriched: MarketplaceListing = {
      listingId,
      seller: listing.seller,
      nftContract: listing.nftContract,
      tokenId: Number(listing.tokenId),
      price: listing.price,
      active: listing.active,
      createdAt: Number(listing.createdAt)
    };

    // Get card stats based on which contract
    const isCustomCard = listing.nftContract.toLowerCase() === CONTRACTS.CUSTOM_CARDS.toLowerCase();
    const contract = isCustomCard ? customCardsContract : cardContract;

    if (contract) {
      try {
        const stats = await contract.getCardStats(listing.tokenId);
        enriched.stats = {
          hp: Number(stats.hp),
          attack: Number(stats.attack),
          defense: Number(stats.defense),
          speed: Number(stats.speed),
          pokemonType: Number(stats.pokemonType || stats.cardType || 0),
          rarity: Number(stats.rarity),
          generation: Number(stats.generation || 1),
          experience: Number(stats.experience || 0)
        };

        // Try to get token URI for image
        try {
          const tokenURI = await contract.tokenURI(listing.tokenId);
          const metadata = await fetchNFTMetadata(tokenURI);
          if (metadata) {
            enriched.name = metadata.name;
            enriched.description = metadata.description;
            enriched.imageUrl = metadata.image;
          }
        } catch {}
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

async function getActiveListings(offset: number = 0, limit: number = 5): Promise<MarketplaceListing[]> {
  if (!marketplaceContract) return [];

  try {
    // Get total listing count
    let totalListings: number;
    try {
      totalListings = Number(await marketplaceContract.listingCount());
    } catch {
      // Fallback: try to enumerate listings
      totalListings = 100; // Max to check
    }

    const listings: MarketplaceListing[] = [];
    let checked = 0;
    let skipped = 0;

    // Iterate through listings (most recent first)
    for (let i = totalListings; i >= 1 && listings.length < limit; i--) {
      try {
        const listing = await getEnrichedListing(i);
        if (listing && listing.active) {
          if (skipped < offset) {
            skipped++;
            continue;
          }
          listings.push(listing);
        }
      } catch {}

      checked++;
      if (checked > 50) break; // Safety limit
    }

    return listings;
  } catch (error) {
    console.error("Error fetching active listings:", error);
    return [];
  }
}

// =============================================================================
// MARKETPLACE BUY FUNCTION
// =============================================================================

interface BuyResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

async function buyNFTOnChain(listingId: number, price: bigint, userId?: number): Promise<BuyResult> {
  if (!CONTRACTS.MARKETPLACE) {
    return { success: false, error: "Marketplace not configured" };
  }

  // SECURITY: User wallet is REQUIRED for marketplace purchases
  // Bot wallet should NEVER be used for user transactions
  if (!userId) {
    return { success: false, error: "User ID required for purchase" };
  }

  // SECURITY: Rate limiting for marketplace operations
  const rateLimitResult = marketplaceRateLimiter.isAllowed(userId.toString());
  if (!rateLimitResult.allowed) {
    const waitTime = Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000);
    return { success: false, error: `Too many marketplace operations. Please wait ${waitTime} seconds.` };
  }

  try {
    const walletManager = getWalletManager();
    if (!walletManager.hasWallet(userId)) {
      return { success: false, error: "Please create a wallet first to make purchases" };
    }

    const activeSigner = await walletManager.getSigner(userId);
    if (!activeSigner) {
      return { success: false, error: "Failed to access your wallet" };
    }

    // Check wallet balance
    const balance = await provider.getBalance(activeSigner.address);
    if (balance < price) {
      return {
        success: false,
        error: `Insufficient balance. Need ${ethers.formatEther(price)} ETH, have ${ethers.formatEther(balance)} ETH`
      };
    }

    console.log(`Buying listing #${listingId} for ${ethers.formatEther(price)} ETH from ${activeSigner.address}`);

    // Create marketplace contract with user's signer
    const marketplace = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, activeSigner);

    // Execute purchase
    const tx = await marketplace.buyNFT(listingId, { value: price });
    console.log(`Transaction sent: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

    return {
      success: true,
      txHash: tx.hash
    };

  } catch (error: any) {
    console.error("Buy error:", error);
    return {
      success: false,
      error: error.reason || error.message || "Transaction failed"
    };
  }
}

// =============================================================================
// ON-CHAIN DEPLOYMENT
// =============================================================================

interface DeployResult {
  success: boolean;
  tokenId?: number;
  txHash?: string;
  error?: string;
}

async function deployCardOnChain(draft: CardDraft): Promise<DeployResult> {
  if (!customCardsContract) {
    return { success: false, error: "CustomCards contract not configured" };
  }

  if (!draft.metadataUri) {
    return { success: false, error: "No metadata URI - upload to IPFS first" };
  }

  try {
    // Try to use user's custodial wallet first
    let userSigner: ethers.Wallet | null = null;
    const walletManager = getWalletManager();

    if (walletManager.hasWallet(draft.telegramUserId)) {
      userSigner = await walletManager.getSigner(draft.telegramUserId);
      console.log(`Using user's custodial wallet: ${userSigner.address}`);
    } else {
      console.log(`User ${draft.telegramUserId} has no custodial wallet, falling back to bot wallet`);
    }

    // Fall back to bot wallet if user doesn't have custodial wallet
    const activeSigner = userSigner || signer;
    if (!activeSigner) {
      return { success: false, error: "No wallet available" };
    }

    // Get minting fee from contract
    const mintingFee = await customCardsContract.mintingFee();
    console.log(`Minting fee: ${ethers.formatEther(mintingFee)} ETH`);

    // Check wallet balance
    const balance = await provider.getBalance(activeSigner.address);
    if (balance < mintingFee) {
      return {
        success: false,
        error: `Insufficient balance. Need ${ethers.formatEther(mintingFee)} ETH, have ${ethers.formatEther(balance)} ETH`
      };
    }

    console.log(`Deploying card: ${draft.cardName}`);
    console.log(`Stats: HP=${draft.stats.hp}, ATK=${draft.stats.attack}, DEF=${draft.stats.defense}, SPD=${draft.stats.speed}`);
    console.log(`Type=${draft.stats.pokemonType}, Rarity=${draft.stats.rarity}, Royalty=${draft.royaltyPercentage}`);

    // Create contract instance with user's signer
    const customCardsWithSigner = new ethers.Contract(CONTRACTS.CUSTOM_CARDS, CUSTOM_CARDS_ABI, activeSigner);

    // Call createCard on the contract
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

    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

    // Get token ID from event logs
    let tokenId: number | undefined;
    for (const log of receipt.logs) {
      try {
        const parsed = customCardsWithSigner.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });
        if (parsed?.name === "Transfer" && parsed.args[0] === ethers.ZeroAddress) {
          tokenId = Number(parsed.args[2]);
          break;
        }
      } catch {}
    }

    return {
      success: true,
      tokenId,
      txHash: tx.hash
    };

  } catch (error: any) {
    console.error("Deploy error:", error);
    return {
      success: false,
      error: error.reason || error.message || "Transaction failed"
    };
  }
}

// =============================================================================
// BOT INITIALIZATION
// =============================================================================

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error("❌ TELEGRAM_BOT_TOKEN not set in .env");
  process.exit(1);
}

const bot = new Bot<MyContext>(botToken);

// Session middleware with file persistence
bot.use(session({
  initial: (): BotSession => ({
    telegramUserId: 0,
    currentState: "idle"
  }),
  getSessionKey: (ctx) => ctx.from?.id.toString()
}));

// Conversations middleware
bot.use(conversations());

// Rate limiting
bot.use(limit({
  timeFrame: 2000,
  limit: 3,
  onLimitExceeded: async (ctx) => {
    await ctx.reply("⚠️ Too many messages. Please wait a few seconds.");
  }
}));

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatCard(tokenId: number, stats: CardStats): string {
  const type = POKEMON_TYPES[stats.pokemonType] || "Unknown";
  const rarity = RARITIES[stats.rarity] || RARITIES[0];
  const typeEmoji = TYPE_EMOJIS[type] || "❓";

  return `
🎴 *Card #${tokenId}*

${rarity.emoji} *Rarity:* ${rarity.name}
${typeEmoji} *Type:* ${type}
📊 *Generation:* ${stats.generation}

*Stats:*
❤️ HP: ${stats.hp}
⚔️ Attack: ${stats.attack}
🛡️ Defense: ${stats.defense}
💨 Speed: ${stats.speed}

⭐ Experience: ${stats.experience?.toLocaleString() || 0}
`;
}

function getEtherscanLink(type: "address" | "tx", value: string): string {
  return `${NETWORK.explorer}/${type}/${value}`;
}

function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

function formatDraftPreview(draft: CardDraft): string {
  const type = POKEMON_TYPES[draft.stats.pokemonType] || "Normal";
  const rarity = RARITIES[draft.stats.rarity] || RARITIES[0];
  const typeEmoji = TYPE_EMOJIS[type] || "⬜";

  return `
🎨 *CARD PREVIEW*
━━━━━━━━━━━━━━━━━━

📛 *Name:* ${draft.cardName || "Not set"}
${typeEmoji} *Type:* ${type}
${rarity.emoji} *Rarity:* ${rarity.name}

*Stats:*
❤️ HP: ${draft.stats.hp}
⚔️ Attack: ${draft.stats.attack}
🛡️ Defense: ${draft.stats.defense}
💨 Speed: ${draft.stats.speed}

📝 *Description:* ${draft.description || "None"}

👤 *Creator:* ${draft.creatorName}
📱 *Telegram:* @${draft.telegramUsername || "N/A"}
💰 *Royalty:* ${draft.royaltyPercentage / 100}%

━━━━━━━━━━━━━━━━━━
`;
}

// =============================================================================
// MAIN MENU
// =============================================================================

function getMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎴 My Cards", "action_my_cards")
    .text("📦 Buy Packs", "action_buy_packs")
    .row()
    .text("🎨 Create Card", "action_create_card")
    .text("🛒 Marketplace", "action_marketplace")
    .row()
    .text("⚔️ Battle Arena", "action_battle")
    .text("🏆 Leaderboard", "action_leaderboard")
    .row()
    .text("👛 Wallet", "action_wallet")
    .text("📜 Contracts", "action_contracts")
    .row()
    .text("🔒 Security", "action_security")
    .text("ℹ️ Help", "action_help")
    .row()
    .text("🧹 Clear Chat", "action_clear");
}

// =============================================================================
// CARD CREATION CONVERSATION (Simplified: 5 steps instead of 12+)
// =============================================================================

async function cardCreationConversation(conversation: MyConversation, ctx: MyContext) {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;

  if (!userId) {
    await ctx.reply("❌ Error: unable to identify user.");
    return;
  }

  // Get or create session
  const userSession = sessionStore.getOrCreate(userId, username, firstName);

  // Create new draft
  const draft = draftStore.create(userId, username, firstName || username || "Creator");
  sessionStore.setCurrentDraft(userId, draft.draftId);

  // ========== STEP 1: Send to CardMaker and wait for image ==========
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

  // Wait for image
  const imageCtx = await conversation.wait();

  if (imageCtx.callbackQuery?.data === "cancel_creation") {
    await imageCtx.answerCallbackQuery();
    draftStore.delete(userId, draft.draftId);
    await ctx.reply("❌ Creation cancelled.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  if (!imageCtx.message?.photo) {
    await ctx.reply("❌ Please send an image of your card. Use /createcard to try again.");
    draftStore.delete(userId, draft.draftId);
    return;
  }

  // Get largest photo version
  const photo = imageCtx.message.photo[imageCtx.message.photo.length - 1];

  // Security: Early file size check before downloading
  if (photo.file_size && photo.file_size > MAX_IMAGE_SIZE_BYTES) {
    const sizeMB = (photo.file_size / (1024 * 1024)).toFixed(2);
    const maxMB = (MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    await ctx.reply(`❌ Image is too large (${sizeMB}MB). Maximum size is ${maxMB}MB. Please compress the image and try again.`);
    draftStore.delete(userId, draft.draftId);
    return;
  }

  // Save image reference
  draft.imageTelegramFileId = photo.file_id;
  draft.imageSource = "telegram";
  draftStore.save(draft);

  await ctx.reply("✅ Image received! Processing...");

  // ========== STEP 2: Card name ==========
  await ctx.reply("📛 What's your Pokemon's name?");
  const nameCtx = await conversation.wait();

  if (!nameCtx.message?.text) {
    await ctx.reply("❌ No name provided. Draft saved, use /drafts to continue later.");
    return;
  }

  // Validate and sanitize card name
  const rawName = nameCtx.message.text.trim();
  if (rawName.length > MAX_NAME_LENGTH) {
    await ctx.reply(`❌ Name too long (max ${MAX_NAME_LENGTH} characters). Please try again.`);
    return;
  }

  try {
    draft.cardName = sanitizeCardName(rawName);
  } catch {
    await ctx.reply("❌ Invalid name. Please use letters, numbers, and basic punctuation only.");
    return;
  }

  draft.creatorName = sanitizeForMetadata(firstName || username || "Creator", MAX_NAME_LENGTH);
  draftStore.save(draft);

  // ========== STEP 3: Choose rarity (auto-generates stats) ==========
  const rarityKeyboard = new InlineKeyboard()
    .text("⚪ Common", "rarity_0")
    .text("🟢 Uncommon", "rarity_1")
    .row()
    .text("🔵 Rare", "rarity_2")
    .text("🟣 Ultra Rare", "rarity_3")
    .row()
    .text("🟡 Legendary", "rarity_4");

  // Use sanitized name in Markdown (escape special chars)
  await ctx.reply(`✨ Choose rarity for *${sanitizeForMarkdown(draft.cardName)}*

Stats will be auto-generated based on rarity!
Higher rarity = stronger stats.`, {
    parse_mode: "Markdown",
    reply_markup: rarityKeyboard
  });

  const rarityCtx = await conversation.waitForCallbackQuery(/^rarity_\d$/);
  await rarityCtx.answerCallbackQuery();

  const rarity = parseInt(rarityCtx.callbackQuery.data.split("_")[1]);
  draft.stats.rarity = rarity;

  // Auto-generate stats based on rarity
  const generatedStats = generateStatsForRarity(rarity);
  draft.stats.hp = generatedStats.hp;
  draft.stats.attack = generatedStats.attack;
  draft.stats.defense = generatedStats.defense;
  draft.stats.speed = generatedStats.speed;

  // Random type
  draft.stats.pokemonType = Math.floor(Math.random() * 18);

  draftStore.save(draft);

  const type = POKEMON_TYPES[draft.stats.pokemonType];
  const typeEmoji = TYPE_EMOJIS[type] || "❓";
  const rarityInfo = RARITIES[rarity];

  await rarityCtx.editMessageText(`✅ *${draft.cardName}* - ${rarityInfo.emoji} ${rarityInfo.name}

${typeEmoji} Type: ${type} (random)
❤️ HP: ${draft.stats.hp} | ⚔️ ATK: ${draft.stats.attack}
🛡️ DEF: ${draft.stats.defense} | 💨 SPD: ${draft.stats.speed}`, { parse_mode: "Markdown" });

  // Set default royalty (price is set later when listing on marketplace)
  draft.royaltyPercentage = 500; // Default 5% royalty
  draftStore.save(draft);

  // ========== STEP 4: Upload to IPFS and deploy on-chain ==========
  const statusMsg = await ctx.reply("📤 *Step 1/3:* Uploading image to IPFS...", { parse_mode: "Markdown" });

  try {
    // Download from Telegram
    const imageBuffer = await downloadPhotoFromTelegram(bot, draft.imageTelegramFileId!);

    // Upload image to Pinata
    const fileName = `${draft.cardName.replace(/[^a-zA-Z0-9]/g, "_")}-${draft.draftId.slice(0, 8)}.png`;
    const imageHash = await uploadImageToPinata(imageBuffer, fileName);
    draft.ipfsImageHash = imageHash;
    draft.ipfsImageUrl = `ipfs://${imageHash}`;

    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
      "✅ *Step 1/3:* Image uploaded!\n📤 *Step 2/3:* Creating metadata...", { parse_mode: "Markdown" });

    // Build and upload metadata
    const metadata = buildNFTMetadata(draft, imageHash);
    const metadataHash = await uploadMetadataToPinata(metadata, draft.cardName);
    draft.metadataUri = `ipfs://${metadataHash}`;
    draft.status = "uploading";
    draftStore.save(draft);

    // Deploy on-chain
    draft.status = "minting";
    draftStore.save(draft);

    // Show pending status with refresh button
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

    const deployResult = await deployCardOnChain(draft);

    if (deployResult.success) {
      draft.status = "minted";
      draft.mintTxHash = deployResult.txHash;
      draft.mintedTokenId = deployResult.tokenId;
      draft.mintedAt = Date.now();
      draftStore.save(draft);

      const type = POKEMON_TYPES[draft.stats.pokemonType];
      const typeEmoji = TYPE_EMOJIS[type] || "❓";
      const rarityInfo = RARITIES[draft.stats.rarity];

      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
        `✅ *CARD DEPLOYED!*`, { parse_mode: "Markdown" });

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

// =============================================================================
// LISTING CONVERSATION - List a card for sale
// =============================================================================

async function listCardConversation(conversation: MyConversation, ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("❌ Error: unable to identify user.");
    return;
  }

  // SECURITY: Rate limiting for marketplace operations
  const rateLimitResult = marketplaceRateLimiter.isAllowed(userId.toString());
  if (!rateLimitResult.allowed) {
    const waitTime = Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000);
    await ctx.reply(`⏳ Too many marketplace operations. Please wait ${waitTime} seconds.`, {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  // Check if marketplace is configured
  if (!marketplaceWritable || !customCardsWritable) {
    await ctx.reply("❌ Marketplace or contracts not properly configured.", {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  // Get user's minted cards from drafts
  const drafts = draftStore.listByUser(userId);
  const mintedDrafts = drafts.filter(d => d.status === "minted" && d.mintedTokenId !== undefined);

  if (mintedDrafts.length === 0) {
    await ctx.reply("📭 You haven't created any cards yet!\n\nCreate a card first to list it for sale.", {
      reply_markup: new InlineKeyboard()
        .text("🎨 Create Card", "action_create_card")
        .row()
        .text("🏠 Menu", "main_menu")
    });
    return;
  }

  // Show available cards
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

  // Wait for selection
  const selectCtx = await conversation.waitForCallbackQuery(/^(list_select_|cancel_listing)/);
  await selectCtx.answerCallbackQuery();

  if (selectCtx.callbackQuery.data === "cancel_listing") {
    await ctx.reply("❌ Listing cancelled.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  const draftId = selectCtx.callbackQuery.data.replace("list_select_", "");
  const selectedDraft = draftStore.get(userId, draftId);

  if (!selectedDraft || !selectedDraft.mintedTokenId) {
    await ctx.reply("❌ Card not found.", { reply_markup: getMainMenuKeyboard() });
    return;
  }

  // Ask for price
  await ctx.reply(`💰 Set price for *${selectedDraft.cardName}*\n\nEnter price in ETH (e.g.: 0.01, 0.05, 0.1):`, {
    parse_mode: "Markdown"
  });

  let priceInEth: string = "";
  let validPrice = false;

  while (!validPrice) {
    const priceCtx = await conversation.wait();
    const priceText = priceCtx.message?.text || "";
    const price = parseFloat(priceText);

    if (!isNaN(price) && price > 0 && price < 1000) {
      priceInEth = priceText;
      validPrice = true;
    } else {
      await ctx.reply("❌ Invalid price. Enter a number like: 0.01, 0.05, 0.1");
    }
  }

  const priceWei = ethers.parseEther(priceInEth);

  // Confirm listing
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

  // Process listing
  await confirmCtx.editMessageText("🔄 *Processing listing...*\n\nStep 1/2: Approving marketplace...", { parse_mode: "Markdown" });

  try {
    // Get user's signer (custodial wallet)
    let userSigner: ethers.Wallet | null = null;
    const walletManager = getWalletManager();
    if (walletManager.hasWallet(userId)) {
      userSigner = await walletManager.getSigner(userId);
    }
    const activeSigner = userSigner || signer;
    if (!activeSigner) {
      await ctx.reply("❌ No wallet available for signing transactions.", { reply_markup: getMainMenuKeyboard() });
      return;
    }

    // First, approve marketplace if not already approved
    const nftContract = CONTRACTS.CUSTOM_CARDS;

    // Check if already approved
    const approvalABI = ["function isApprovedForAll(address owner, address operator) view returns (bool)"];
    const nftForCheck = new ethers.Contract(nftContract, approvalABI, provider);
    const isApproved = await nftForCheck.isApprovedForAll(activeSigner.address, CONTRACTS.MARKETPLACE);

    if (!isApproved) {
      const approveABI = ["function setApprovalForAll(address operator, bool approved)"];
      const nftForApprove = new ethers.Contract(nftContract, approveABI, activeSigner);

      const approveTx = await nftForApprove.setApprovalForAll(CONTRACTS.MARKETPLACE, true);
      await approveTx.wait();
      console.log("Marketplace approved for user:", activeSigner.address);
    }

    await confirmCtx.editMessageText("🔄 *Processing listing...*\n\n✅ Step 1/2: Marketplace approved!\n🔄 Step 2/2: Creating listing...", { parse_mode: "Markdown" });

    // Create listing with user's signer
    const marketplaceWithSigner = new ethers.Contract(CONTRACTS.MARKETPLACE, MARKETPLACE_ABI, activeSigner);

    // Get image URL from draft metadata
    const imageURI = selectedDraft.ipfsImageUrl || selectedDraft.metadataUri || "";

    const listTx = await marketplaceWithSigner.listNFT(nftContract, selectedDraft.mintedTokenId, priceWei, imageURI);
    const receipt = await listTx.wait();

    // Parse listing ID from event
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
    console.error("Listing error:", error);
    await ctx.reply(`❌ *Listing Failed*\n\n${error.reason || error.message || "Transaction failed"}`, {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard()
    });
  }
}

// Register conversations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.use(createConversation(cardCreationConversation as any));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.use(createConversation(listCardConversation as any));

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

bot.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;

  if (userId) {
    sessionStore.getOrCreate(userId, username, firstName);
  }

  await ctx.reply(
    `🎮 *Welcome to PokeDEX NFT!*

Collect Pokemon cards as NFTs, create your own custom cards and sell them on the marketplace!

*Features:*
• 📦 Open packs with verifiable randomness
• 🎨 Create custom cards with royalties
• 🛒 Buy/sell cards on the marketplace
• ⚔️ Battle other players
• 🏆 Climb the leaderboard

*Network:* ${NETWORK.name} Testnet
*Contracts:* Verified on Etherscan

🔒 *Security:* We never ask for private keys!`,
    { parse_mode: "Markdown", reply_markup: getMainMenuKeyboard() }
  );
});

bot.command("help", async (ctx) => {
  await showHelp(ctx);
});

bot.command("clear", async (ctx) => {
  // Send empty lines to push old messages out of view
  const clearScreen = "\n".repeat(50);
  await ctx.reply(clearScreen + "🧹 *Chat cleared!*\n\nWhat would you like to do?", {
    parse_mode: "Markdown",
    reply_markup: getMainMenuKeyboard()
  });
});

bot.command("cards", async (ctx) => {
  await showMyCards(ctx);
});

bot.command("card", async (ctx) => {
  const cardId = parseInt(ctx.match || "0");
  if (!cardId) {
    await ctx.reply("❌ Usage: `/card <ID>`\nExample: `/card 1`", { parse_mode: "Markdown" });
    return;
  }
  await showCardDetails(ctx, cardId);
});

bot.command("packs", async (ctx) => {
  await showPacks(ctx);
});

bot.command("createcard", async (ctx) => {
  await ctx.conversation.enter("cardCreationConversation");
});

bot.command("create", async (ctx) => {
  await ctx.conversation.enter("cardCreationConversation");
});

bot.command("mycreations", async (ctx) => {
  await showMyCreations(ctx);
});

bot.command("drafts", async (ctx) => {
  await showMyDrafts(ctx);
});

bot.command("market", async (ctx) => {
  await showMarketplace(ctx);
});

bot.command("listings", async (ctx) => {
  await showMyListings(ctx);
});

bot.command("sell", async (ctx) => {
  await ctx.conversation.enter("listCardConversation");
});

bot.command("list", async (ctx) => {
  await ctx.conversation.enter("listCardConversation");
});

bot.command("browse", async (ctx) => {
  await showMarketplaceBrowser(ctx, 0);
});

bot.command("battle", async (ctx) => {
  await showBattleMenu(ctx);
});

bot.command("leaderboard", async (ctx) => {
  await showLeaderboard(ctx);
});

bot.command("stats", async (ctx) => {
  await showPlayerStats(ctx);
});

bot.command("wallet", async (ctx) => {
  await showWallet(ctx);
});

bot.command("security", async (ctx) => {
  await ctx.reply(SECURITY_NOTICE + "\n" + ANTI_PHISHING_WARNING, { parse_mode: "Markdown" });
});

bot.command("contracts", async (ctx) => {
  await showContracts(ctx);
});

// =============================================================================
// ACTION FUNCTIONS (reusable between commands and callbacks)
// =============================================================================

async function showHelp(ctx: MyContext) {
  await ctx.reply(
    `📚 *PokeDEX Guide*

*Collection & Packs:*
/cards - Your cards
/card <id> - Card details
/packs - Buy packs

*Custom Cards:*
/createcard - Create a new card
/mycreations - Your creations
/drafts - Saved drafts

*Marketplace:*
/market - NFT Marketplace
/browse - Browse NFTs with images
/listings - Your listings
/sell - List a card for sale

*Battle:*
/battle - Battle Arena
/leaderboard - Leaderboard
/stats - Your statistics

*Account:*
/wallet - Manage wallet
/security - Security info
/contracts - Contract addresses

*Rarity:* ⚪Common | 🟢Uncommon | 🔵Rare | 🟣Ultra | 🟡Legendary

*Packs:*
📦 Basic (3 cards) - 0.01 ETH
📦 Premium (5 cards) - 0.025 ETH
📦 Legendary (10 cards) - 0.05 ETH`,
    { parse_mode: "Markdown", reply_markup: getMainMenuKeyboard() }
  );
}

async function showMyCards(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create or connect your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  try {
    // Fetch cards from BOTH contracts in parallel
    const [packCardIds, customCardIds] = await Promise.all([
      cardContract ? cardContract.tokensOfOwner(walletAddress).catch(() => []) : Promise.resolve([]),
      customCardsContract ? customCardsContract.getCreatorCards(walletAddress).catch(() => []) : Promise.resolve([])
    ]);

    const totalCards = packCardIds.length + customCardIds.length;

    if (totalCards === 0) {
      await ctx.reply("📭 You don't have any cards yet!\n\nCreate your first card or buy packs.", {
        reply_markup: new InlineKeyboard()
          .text("🎨 Create Card", "action_create_card")
          .text("📦 Buy Packs", "action_buy_packs")
      });
      return;
    }

    let message = `🎴 <b>Your Collection</b>\n\n`;
    message += `You have <b>${totalCards}</b> card(s):\n\n`;

    const keyboard = new InlineKeyboard();
    let cardsShown = 0;
    const maxCards = 10;

    // Show custom cards first (user creations)
    if (customCardIds.length > 0 && customCardsContract) {
      message += `<b>🎨 Your Creations:</b>\n`;
      for (const tokenId of customCardIds.slice(0, maxCards)) {
        if (cardsShown >= maxCards) break;
        try {
          const stats = await customCardsContract.getCardStats(tokenId);
          const verified = stats.verified ? "✅" : "⏳";
          const rarityNames = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary"];
          const rarity = rarityNames[stats.rarity] || "Unknown";
          message += `• Card #${tokenId} - ${rarity} ${verified}\n`;
          keyboard.text(`🎨 #${tokenId}`, `view_custom_card_${tokenId}`).row();
        } catch {
          message += `• Card #${tokenId}\n`;
          keyboard.text(`🎨 #${tokenId}`, `view_custom_card_${tokenId}`).row();
        }
        cardsShown++;
      }
      message += `\n`;
    }

    // Show pack cards
    if (packCardIds.length > 0 && cardContract && cardsShown < maxCards) {
      message += `<b>📦 From Packs:</b>\n`;
      for (const tokenId of packCardIds.slice(0, maxCards - cardsShown)) {
        if (cardsShown >= maxCards) break;
        try {
          const stats = await cardContract.getCardStats(tokenId);
          const rarityNames = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary"];
          const rarity = rarityNames[stats.rarity] || "Unknown";
          message += `• Card #${tokenId} - ${rarity}\n`;
          keyboard.text(`📦 #${tokenId}`, `view_card_${tokenId}`).row();
        } catch {
          message += `• Card #${tokenId}\n`;
          keyboard.text(`📦 #${tokenId}`, `view_card_${tokenId}`).row();
        }
        cardsShown++;
      }
    }

    if (totalCards > maxCards) {
      message += `\n... and ${totalCards - maxCards} more`;
    }

    await ctx.reply(message, {
      parse_mode: "HTML",
      reply_markup: keyboard
    });
  } catch (error) {
    console.error("Error fetching cards:", error);
    await ctx.reply("❌ Error loading your cards. Please try again.");
  }
}

async function showCardDetails(ctx: MyContext, cardId: number) {
  if (!cardContract) {
    await ctx.reply("❌ Cards contract not configured.");
    return;
  }

  try {
    const stats = await cardContract.getCardStats(cardId);
    const owner = await cardContract.ownerOf(cardId);
    const power = await cardContract.calculateBattlePower(cardId);

    const userId = ctx.from?.id;
    const walletAddress = userId ? await getUserWalletAddress(userId) : null;
    const isOwner = walletAddress?.toLowerCase() === owner.toLowerCase();

    const keyboard = isOwner && CONTRACTS.MARKETPLACE
      ? new InlineKeyboard().text("🛒 Sell", `sell_card_${cardId}`)
      : undefined;

    const caption = `${formatCard(cardId, stats)}\n💪 *Battle Power:* ${power}\n👤 *Owner:* ${isOwner ? "You! ✓" : formatAddress(owner)}`;

    // Try to fetch and display image
    let imageUrl: string | undefined;
    try {
      const tokenURI = await cardContract.tokenURI(cardId);
      const metadata = await fetchNFTMetadata(tokenURI);
      imageUrl = metadata?.image;
    } catch {}

    if (imageUrl) {
      try {
        await ctx.replyWithPhoto(imageUrl, {
          caption,
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
        return;
      } catch {
        // Image fetch failed, fallback to text
      }
    }

    // Fallback: text only
    await ctx.reply(caption + (imageUrl ? "" : "\n\n📷 _(No image available)_"), {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  } catch (error) {
    await ctx.reply("❌ Card not found.");
  }
}

async function showCustomCardDetails(ctx: MyContext, cardId: number) {
  if (!customCardsContract) {
    await ctx.reply("❌ CustomCards contract not configured.");
    return;
  }

  try {
    const stats = await customCardsContract.getCardStats(cardId);
    const power = await customCardsContract.calculateBattlePower(cardId);
    const isBanned = await customCardsContract.isBanned(cardId);

    const rarityNames = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary"];
    const typeNames = ["Normal", "Fire", "Water", "Grass", "Electric", "Psychic", "Fighting", "Dark", "Dragon"];
    const rarity = rarityNames[stats.rarity] || "Unknown";
    const cardType = typeNames[stats.cardType] || "Unknown";

    const userId = ctx.from?.id;
    const walletAddress = userId ? await getUserWalletAddress(userId) : null;
    const isCreator = walletAddress?.toLowerCase() === stats.creator.toLowerCase();

    let caption = `🎨 *Custom Card #${cardId}*\n\n`;
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

    const keyboard = isCreator && CONTRACTS.MARKETPLACE && !isBanned
      ? new InlineKeyboard().text("🛒 Sell", `sell_custom_card_${cardId}`)
      : undefined;

    // Try to fetch and display image
    let imageUrl: string | undefined;
    try {
      const tokenURI = await customCardsContract.tokenURI(cardId);
      const metadata = await fetchNFTMetadata(tokenURI);
      imageUrl = metadata?.image;
    } catch {}

    if (imageUrl) {
      try {
        await ctx.replyWithPhoto(imageUrl, {
          caption,
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
        return;
      } catch {
        // Image fetch failed, fallback to text
      }
    }

    // Fallback: text only
    await ctx.reply(caption + (imageUrl ? "" : "\n\n📷 _(No image available)_"), {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  } catch (error) {
    console.error("Error showing custom card:", error);
    await ctx.reply("❌ Card not found.");
  }
}

async function showPacks(ctx: MyContext) {
  const activeContract = CONTRACTS.CARD_PACK || CONTRACTS.CARD_PACK_QRNG;

  if (!activeContract) {
    await ctx.reply("❌ No pack contract configured.\n\nPacks will be available after VRF/QRNG configuration.");
    return;
  }

  const isQRNG = !CONTRACTS.CARD_PACK && CONTRACTS.CARD_PACK_QRNG;

  const keyboard = new InlineKeyboard()
    .text("📦 Basic (0.01 ETH)", "pack_basic")
    .row()
    .text("📦 Premium (0.025 ETH)", "pack_premium")
    .row()
    .text("📦 Legendary (0.05 ETH)", "pack_legendary");

  await ctx.reply(
    `📦 *Card Packs*

Choose a pack:

*Basic Pack* - 0.01 ETH
• 3 random cards

*Premium Pack* - 0.025 ETH
• 5 random cards
• Better odds

*Legendary Pack* - 0.05 ETH
• 10 random cards
• Rare+ guaranteed

🎲 *Randomness:* ${isQRNG ? "API3 QRNG (Free!)" : "Chainlink VRF"}
🔗 *Network:* ${NETWORK.name}`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

async function showMyCreations(ctx: MyContext) {
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

  try {
    const cardIds = await customCardsContract.getCreatorCards(walletAddress);

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
        const verified = stats.verified ? "✅" : "⏳";
        message += `• Card #${cardId} ${verified}\n`;
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
    await ctx.reply("❌ Error fetching creations.");
  }
}

async function showMyDrafts(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const drafts = draftStore.listByUser(userId);

  if (drafts.length === 0) {
    await ctx.reply("📭 You don't have any saved drafts.\n\nCreate a new card!", {
      reply_markup: new InlineKeyboard().text("🎨 Create Card", "action_create_card")
    });
    return;
  }

  let message = `📋 *Your Drafts*\n\n`;

  for (const draft of drafts.slice(0, 10)) {
    const status = draft.status === "ready_to_mint" ? "✅ Ready" :
                   draft.status === "minted" ? "🎉 Minted" : "📝 In progress";
    message += `• *${draft.cardName || "Unnamed"}* - ${status}\n`;
  }

  await ctx.reply(message, { parse_mode: "Markdown" });
}

async function showMarketplace(ctx: MyContext) {
  if (!CONTRACTS.MARKETPLACE) {
    await ctx.reply("❌ Marketplace not deployed yet.");
    return;
  }

  let feePercent = "2.5";
  if (marketplaceContract) {
    try {
      const fee = await marketplaceContract.marketplaceFee();
      feePercent = (Number(fee) / 100).toFixed(2);
    } catch {}
  }

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

async function showMarketplaceBrowser(ctx: MyContext, page: number = 0) {
  const loadingMsg = await ctx.reply("🔄 Loading marketplace...");

  try {
    const itemsPerPage = 3;
    const listings = await getActiveListings(page * itemsPerPage, itemsPerPage);

    // Delete loading message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}

    if (listings.length === 0) {
      if (page === 0) {
        await ctx.reply("📭 No active listings yet!\n\nBe the first to list a card!", {
          reply_markup: new InlineKeyboard()
            .text("💰 Sell Card", "action_sell")
            .row()
            .text("🏠 Menu", "main_menu")
        });
      } else {
        await ctx.reply("📭 No more listings on this page.", {
          reply_markup: new InlineKeyboard()
            .text("« Previous", `browse_market_${page - 1}`)
            .row()
            .text("🏠 Menu", "main_menu")
        });
      }
      return;
    }

    // Display each listing with image
    for (const listing of listings) {
      const type = listing.stats ? (POKEMON_TYPES[listing.stats.pokemonType] || "Unknown") : "Unknown";
      const typeEmoji = TYPE_EMOJIS[type] || "❓";
      const rarity = listing.stats ? (RARITIES[listing.stats.rarity] || RARITIES[0]) : RARITIES[0];
      const priceEth = ethers.formatEther(listing.price);

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

      const buyKeyboard = new InlineKeyboard()
        .text(`🛒 Buy for ${priceEth} ETH`, `buy_listing_${listing.listingId}`)
        .row()
        .url("🔍 View on Etherscan", `${NETWORK.explorer}/address/${listing.nftContract}?a=${listing.tokenId}`);

      // Try to send with image
      if (listing.imageUrl) {
        try {
          await ctx.replyWithPhoto(listing.imageUrl, {
            caption,
            parse_mode: "Markdown",
            reply_markup: buyKeyboard
          });
        } catch (imgError) {
          // Image failed, send text only
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

    // Pagination
    const navKeyboard = new InlineKeyboard();
    if (page > 0) {
      navKeyboard.text("« Previous", `browse_market_${page - 1}`);
    }
    navKeyboard.text("Next »", `browse_market_${page + 1}`);
    navKeyboard.row().text("🏠 Menu", "main_menu");

    await ctx.reply(`📄 Page ${page + 1}`, { reply_markup: navKeyboard });

  } catch (error) {
    console.error("Marketplace browser error:", error);
    await ctx.reply("❌ Error loading marketplace. Try again later.", {
      reply_markup: getMainMenuKeyboard()
    });
  }
}

async function showMyListings(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!marketplaceContract) {
    await ctx.reply("❌ Marketplace contract not configured.");
    return;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create or connect your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  try {
    const listingIds = await marketplaceContract.getSellerListings(walletAddress);

    if (listingIds.length === 0) {
      await ctx.reply("📭 You don't have any active listings!", {
        reply_markup: new InlineKeyboard().text("💰 Sell a Card", "action_sell")
      });
      return;
    }

    let message = `📋 *Your Listings*\n\n`;

    for (const listingId of listingIds.slice(0, 10)) {
      try {
        const listing = await marketplaceContract.getListing(listingId);
        if (listing.active) {
          const priceEth = ethers.formatEther(listing.price);
          message += `#${listingId}: Card #${listing.tokenId} - ${priceEth} ETH ✅\n`;
        }
      } catch {}
    }

    await ctx.reply(message, { parse_mode: "Markdown" });
  } catch (error) {
    await ctx.reply("❌ Error fetching listings.");
  }
}


async function showBattleMenu(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create or connect your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("📋 Received Challenges", "action_my_challenges")
    .text("📊 My Stats", "action_my_stats")
    .row()
    .text("🏆 Leaderboard", "action_leaderboard")
    .row()
    .url("⚔️ Create Challenge", `${NETWORK.explorer}/address/${CONTRACTS.BATTLE_ARENA}#writeContract`);

  await ctx.reply(
    `⚔️ *Battle Arena*

Challenge other trainers!

*How it Works:*
1. Select a card
2. Challenge an opponent
3. Type advantages + stats = winner
4. Winning card earns EXP!

*Type Advantages:*
🔥 Fire > 🌿 Grass > 💧 Water > 🔥 Fire
⚡ Electric > 💧 Water
...and more combinations!`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

async function showLeaderboard(ctx: MyContext) {
  if (!battleContract) {
    await ctx.reply("❌ Arena not deployed!");
    return;
  }

  try {
    const [addresses, wins] = await battleContract.getLeaderboard(10);

    if (addresses.length === 0) {
      await ctx.reply("🏆 No battles yet! Be the first!");
      return;
    }

    const userId = ctx.from?.id;
    const walletAddress = userId ? await getUserWalletAddress(userId) : null;

    let text = "🏆 *Top 10 Trainers*\n\n";

    for (let i = 0; i < addresses.length; i++) {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      const isYou = walletAddress?.toLowerCase() === addresses[i].toLowerCase();
      text += `${medal} \`${formatAddress(addresses[i])}\` - ${wins[i]} wins${isYou ? " *(You)*" : ""}\n`;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error:", error);
    await ctx.reply("❌ Error fetching leaderboard.");
  }
}

async function showPlayerStats(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!battleContract) {
    await ctx.reply("❌ Arena not deployed!");
    return;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create or connect your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  try {
    const stats = await battleContract.getPlayerStats(walletAddress);
    const winRate = stats.totalBattles > 0
      ? ((Number(stats.wins) / Number(stats.totalBattles)) * 100).toFixed(1)
      : "0";

    await ctx.reply(
      `📊 *Your Statistics*

🎮 Total Battles: ${stats.totalBattles}
✅ Wins: ${stats.wins}
❌ Losses: ${stats.losses}
📈 Win Rate: ${winRate}%

🔥 Current Streak: ${stats.currentStreak}
⭐ Best Streak: ${stats.bestStreak}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    await ctx.reply("❌ Error fetching statistics.");
  }
}

async function showWallet(ctx: MyContext) {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const walletManager = getWalletManager();
    const wallets = await walletManager.listWallets(userId);

    if (wallets.length > 0) {
      const activeWallet = wallets.find(w => w.isActive) || wallets[0];

      // Update session with active wallet address
      const session = sessionStore.getOrCreate(userId, ctx.from?.username, ctx.from?.first_name);
      session.walletAddress = activeWallet.address;
      sessionStore.save(session);

      // Build wallet list
      let walletList = "";
      for (const w of wallets) {
        const activeIcon = w.isActive ? "✅ " : "   ";
        walletList += `${activeIcon}<b>${w.name}</b>\n   <code>${w.address.slice(0,10)}...${w.address.slice(-6)}</code>\n   💰 ${w.balanceFormatted} ETH\n\n`;
      }

      const keyboard = new InlineKeyboard()
        .text("💰 Deposit", "wallet_deposit")
        .text("📤 Withdraw", "wallet_withdraw")
        .row()
        .text("🔑 Private Key", "wallet_export_key")
        .text("🌱 Seed Phrase", "wallet_export_mnemonic")
        .row()
        .text("➕ New Wallet", "wallet_create_new")
        .text("🔄 Switch Wallet", "wallet_switch")
        .row()
        .url("📊 Etherscan", getEtherscanLink("address", activeWallet.address));

      await sendSensitiveMessage(
        bot,
        ctx.chat!.id,
        `👛 <b>Your Wallets</b> (${wallets.length})

${walletList}🦊 <b>MetaMask Compatible</b> - Export seed phrase to import

<i>Active wallet is used for all transactions.</i>`,
        SENSITIVITY_LEVELS.BALANCE,
        keyboard
      );
    } else {
      const keyboard = new InlineKeyboard()
        .text("✨ Create Wallet", "wallet_create");

      await ctx.reply(
        `👛 *No wallets found*

Create your first wallet to:
• Buy NFTs with one click
• Participate in battles with bets
• Receive royalties automatically

🔐 The wallet will be encrypted and secure.
🦊 Compatible with MetaMask!`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
    }
  } catch (error) {
    console.error("Error in showWallet:", error);
    await ctx.reply("❌ Error loading wallets. Please try again later.");
  }
}

async function showContracts(ctx: MyContext) {
  let message = `📜 *Contracts (${NETWORK.name})*\n\n`;

  const contracts = [
    { name: "PokeDEXCard", addr: CONTRACTS.POKEDEX_CARD },
    { name: "CardPack (VRF)", addr: CONTRACTS.CARD_PACK },
    { name: "CardPack (QRNG)", addr: CONTRACTS.CARD_PACK_QRNG },
    { name: "BattleArena", addr: CONTRACTS.BATTLE_ARENA },
    { name: "CustomCards", addr: CONTRACTS.CUSTOM_CARDS },
    { name: "Marketplace", addr: CONTRACTS.MARKETPLACE },
  ];

  for (const c of contracts) {
    if (c.addr) {
      message += `*${c.name}:*\n\`${c.addr}\`\n[Etherscan](${getEtherscanLink("address", c.addr)})\n\n`;
    }
  }

  message += `_All verified and open source_`;

  await ctx.reply(message, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
}

// =============================================================================
// CALLBACK QUERY HANDLERS (Direct execution, not redirects)
// =============================================================================

// Main menu actions
bot.callbackQuery("action_my_cards", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMyCards(ctx);
});

bot.callbackQuery("action_buy_packs", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPacks(ctx);
});

bot.callbackQuery("action_create_card", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("cardCreationConversation");
});

// Refresh minting status handler
bot.callbackQuery(/^refresh_mint_(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.answerCallbackQuery("Error: User not found");
    return;
  }

  const match = ctx.callbackQuery.data.match(/^refresh_mint_(.+)$/);
  if (!match) {
    await ctx.answerCallbackQuery("Invalid request");
    return;
  }

  const draftId = match[1];
  const draft = draftStore.get(userId, draftId);

  if (!draft) {
    await ctx.answerCallbackQuery("Draft not found");
    return;
  }

  // Check current status
  if (draft.status === "minted") {
    await ctx.answerCallbackQuery("✅ Card already minted!");

    const type = POKEMON_TYPES[draft.stats.pokemonType];
    const typeEmoji = TYPE_EMOJIS[type] || "❓";
    const rarityInfo = RARITIES[draft.stats.rarity];

    const successKeyboard = new InlineKeyboard()
      .url("🔍 View on Etherscan", `${NETWORK.explorer}/tx/${draft.mintTxHash}`)
      .row()
      .text("🎴 My Cards", "action_my_cards")
      .text("🏠 Menu", "main_menu");

    await ctx.editMessageText(`🎉 *${sanitizeForMarkdown(draft.cardName)}* is now an NFT!

${rarityInfo.emoji} *Rarity:* ${rarityInfo.name}
${typeEmoji} *Type:* ${type}
❤️ HP: ${draft.stats.hp} | ⚔️ ATK: ${draft.stats.attack}
🛡️ DEF: ${draft.stats.defense} | 💨 SPD: ${draft.stats.speed}

🆔 *Token ID:* #${draft.mintedTokenId || "pending"}
📜 *TX:* \`${draft.mintTxHash?.slice(0, 20)}...\`

🛒 Ready to sell? Use the Marketplace!`, {
      parse_mode: "Markdown",
      reply_markup: successKeyboard
    });
    return;
  }

  if (draft.status === "failed") {
    await ctx.answerCallbackQuery("❌ Minting failed");
    await ctx.editMessageText(`❌ *Minting Failed*\n\n${draft.errorMessage || "Unknown error"}\n\nTry again with /drafts`, {
      parse_mode: "Markdown",
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  if (draft.status === "minting" && draft.mintTxHash) {
    // Check transaction on blockchain
    try {
      const receipt = await provider.getTransactionReceipt(draft.mintTxHash);
      if (receipt) {
        if (receipt.status === 1) {
          // Success! Parse token ID
          let tokenId: number | undefined;
          for (const log of receipt.logs) {
            try {
              const parsed = customCardsContract?.interface.parseLog({
                topics: log.topics as string[],
                data: log.data
              });
              if (parsed?.name === "Transfer" && parsed.args[0] === ethers.ZeroAddress) {
                tokenId = Number(parsed.args[2]);
                break;
              }
            } catch {}
          }

          draft.status = "minted";
          draft.mintedTokenId = tokenId;
          draft.mintedAt = Date.now();
          draftStore.save(draft);

          await ctx.answerCallbackQuery("✅ Card minted!");

          const type = POKEMON_TYPES[draft.stats.pokemonType];
          const typeEmoji = TYPE_EMOJIS[type] || "❓";
          const rarityInfo = RARITIES[draft.stats.rarity];

          const successKeyboard = new InlineKeyboard()
            .url("🔍 View on Etherscan", `${NETWORK.explorer}/tx/${draft.mintTxHash}`)
            .row()
            .text("🎴 My Cards", "action_my_cards")
            .text("🏠 Menu", "main_menu");

          await ctx.editMessageText(`🎉 *${sanitizeForMarkdown(draft.cardName)}* is now an NFT!

${rarityInfo.emoji} *Rarity:* ${rarityInfo.name}
${typeEmoji} *Type:* ${type}
❤️ HP: ${draft.stats.hp} | ⚔️ ATK: ${draft.stats.attack}
🛡️ DEF: ${draft.stats.defense} | 💨 SPD: ${draft.stats.speed}

🆔 *Token ID:* #${tokenId || "pending"}
📜 *TX:* \`${draft.mintTxHash?.slice(0, 20)}...\`

🛒 Ready to sell? Use the Marketplace!`, {
            parse_mode: "Markdown",
            reply_markup: successKeyboard
          });
        } else {
          draft.status = "failed";
          draft.errorMessage = "Transaction reverted";
          draftStore.save(draft);
          await ctx.answerCallbackQuery("❌ Transaction failed");
        }
      } else {
        await ctx.answerCallbackQuery("⏳ Still pending... try again in a moment");
      }
    } catch (error) {
      await ctx.answerCallbackQuery("⏳ Still confirming...");
    }
    return;
  }

  await ctx.answerCallbackQuery(`Status: ${draft.status}`);
});

bot.callbackQuery("action_marketplace", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMarketplace(ctx);
});

bot.callbackQuery("action_battle", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showBattleMenu(ctx);
});

bot.callbackQuery("action_leaderboard", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showLeaderboard(ctx);
});

bot.callbackQuery("action_wallet", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showWallet(ctx);
});

bot.callbackQuery("action_contracts", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showContracts(ctx);
});

bot.callbackQuery("action_security", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(SECURITY_NOTICE + "\n" + ANTI_PHISHING_WARNING, { parse_mode: "Markdown" });
});

bot.callbackQuery("action_help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showHelp(ctx);
});

bot.callbackQuery("action_clear", async (ctx) => {
  await ctx.answerCallbackQuery();
  const clearScreen = "\n".repeat(50);
  await ctx.reply(clearScreen + "🧹 *Chat cleared!*\n\nWhat would you like to do?", {
    parse_mode: "Markdown",
    reply_markup: getMainMenuKeyboard()
  });
});

bot.callbackQuery("action_my_listings", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMyListings(ctx);
});

bot.callbackQuery("action_my_offers", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  if (!marketplaceContract) {
    await ctx.reply("❌ Marketplace contract not configured.");
    return;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create or connect your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  try {
    const offerIds = await marketplaceContract.getBuyerOffers(walletAddress);

    if (offerIds.length === 0) {
      await ctx.reply("📭 You don't have any active offers!");
      return;
    }

    let message = `📥 *Your Offers*\n\n`;

    for (const offerId of offerIds.slice(0, 10)) {
      try {
        const offer = await marketplaceContract.getOffer(offerId);
        if (offer.active) {
          const amountEth = ethers.formatEther(offer.amount);
          message += `#${offerId}: ${amountEth} ETH\n`;
        }
      } catch {}
    }

    await ctx.reply(message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error showing offers:", error);
    await ctx.reply("❌ Error loading offers. Please try again.");
  }
});

bot.callbackQuery("action_sell", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("listCardConversation");
});

bot.callbackQuery("action_my_challenges", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  if (!battleContract) {
    await ctx.reply("❌ Battle arena not configured.");
    return;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    await ctx.reply("❌ Create or connect your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Wallet", "action_wallet")
    });
    return;
  }

  try {
    const pending = await battleContract.getPlayerPendingChallenges(walletAddress);

    if (pending.length === 0) {
      await ctx.reply("📋 You don't have any pending challenges!");
      return;
    }

    let text = "📋 *Pending Challenges*\n\n";
    for (const battleId of pending) {
      try {
        const battle = await battleContract.getBattle(battleId);
        text += `⚔️ #${battleId} from \`${formatAddress(battle.challenger)}\`\n`;
      } catch {
        text += `⚔️ #${battleId}\n`;
      }
    }

    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .url("Accept Challenge", `${NETWORK.explorer}/address/${CONTRACTS.BATTLE_ARENA}#writeContract`)
    });
  } catch (error) {
    console.error("Error showing pending challenges:", error);
    await ctx.reply("❌ Error loading challenges. Please try again.");
  }
});

bot.callbackQuery("action_my_stats", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPlayerStats(ctx);
});

bot.callbackQuery("main_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("🏠 Main Menu:", { reply_markup: getMainMenuKeyboard() });
});

bot.callbackQuery("my_drafts", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMyDrafts(ctx);
});

// View card from My Cards list
bot.callbackQuery(/^view_card_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const match = ctx.callbackQuery.data.match(/^view_card_(\d+)$/);
  if (!match) return;
  const cardId = parseInt(match[1]);
  await showCardDetails(ctx, cardId);
});

// View custom card from My Cards list
bot.callbackQuery(/^view_custom_card_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const match = ctx.callbackQuery.data.match(/^view_custom_card_(\d+)$/);
  if (!match) return;
  const cardId = parseInt(match[1]);
  await showCustomCardDetails(ctx, cardId);
});

// Pack purchase
bot.callbackQuery(/^pack_/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const activeContract = CONTRACTS.CARD_PACK || CONTRACTS.CARD_PACK_QRNG;
  if (!activeContract) {
    await ctx.reply("❌ Packs not available.");
    return;
  }

  const packType = ctx.callbackQuery.data.replace("pack_", "");
  let price = PACK_PRICES.basic;
  let packIndex = 0;
  let packName = "Basic";
  let cardCount = 3;

  if (packType === "premium") {
    price = PACK_PRICES.premium;
    packIndex = 1;
    packName = "Premium";
    cardCount = 5;
  } else if (packType === "legendary") {
    price = PACK_PRICES.legendary;
    packIndex = 2;
    packName = "Legendary";
    cardCount = 10;
  }

  const keyboard = new InlineKeyboard()
    .url("🛒 Purchase", `${NETWORK.explorer}/address/${activeContract}#writeContract`)
    .row()
    .text("« Back", "action_buy_packs");

  await ctx.reply(
    `📦 *${packName} Pack*

💰 Price: ${price} ETH
🎴 Cards: ${cardCount}

*How to purchase:*
1. Click "Purchase"
2. Connect MetaMask
3. Function: \`purchasePack\`
4. packType: ${packIndex}
5. Value: ${price} ETH

⚠️ Make sure you're on ${NETWORK.name}!`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// Wallet - Create first wallet
bot.callbackQuery("wallet_create", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const walletManager = getWalletManager();

    if (walletManager.hasWallet(userId)) {
      await showWallet(ctx);
      return;
    }

    await createNewWallet(ctx, userId, "Wallet 1");
  } catch (error) {
    console.error("Error creating wallet:", error);
    await ctx.reply("❌ Error creating wallet. Please try again.");
  }
});

// Wallet - Create additional wallet
bot.callbackQuery("wallet_create_new", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const walletManager = getWalletManager();
    const count = walletManager.getWalletCount(userId);

    if (count >= 5) {
      await ctx.reply("⚠️ Maximum 5 wallets allowed per user.");
      return;
    }

    await createNewWallet(ctx, userId, `Wallet ${count + 1}`);
  } catch (error) {
    console.error("Error creating wallet:", error);
    await ctx.reply("❌ Error creating wallet. Please try again.");
  }
});

// Wallet - Switch between wallets
bot.callbackQuery("wallet_switch", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const walletManager = getWalletManager();
    const wallets = await walletManager.listWallets(userId);

    if (wallets.length <= 1) {
      await ctx.reply("ℹ️ You only have one wallet. Create more to switch between them!", {
        reply_markup: new InlineKeyboard().text("➕ New Wallet", "wallet_create_new")
      });
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const w of wallets) {
      const activeIcon = w.isActive ? "✅ " : "";
      keyboard.text(`${activeIcon}${w.name}`, `wallet_select_${w.id}`).row();
    }
    keyboard.text("🔙 Back", "action_wallet");

    await ctx.reply(
      `🔄 <b>Switch Wallet</b>

Select wallet to use:`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (error) {
    console.error("Error listing wallets:", error);
    await ctx.reply("❌ Error. Please try again.");
  }
});

// Wallet - Select specific wallet
bot.callbackQuery(/^wallet_select_/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const walletId = ctx.callbackQuery.data.replace("wallet_select_", "");

  try {
    const walletManager = getWalletManager();
    const success = walletManager.setActiveWallet(userId, walletId);

    if (success) {
      const walletInfo = await walletManager.getWallet(userId);
      if (walletInfo) {
        const session = sessionStore.getOrCreate(userId, ctx.from?.username, ctx.from?.first_name);
        session.walletAddress = walletInfo.address;
        sessionStore.save(session);
      }
      await ctx.reply(`✅ Switched to <b>${walletInfo?.name || "wallet"}</b>`, { parse_mode: "HTML" });
      await showWallet(ctx);
    } else {
      await ctx.reply("❌ Wallet not found.");
    }
  } catch (error) {
    console.error("Error switching wallet:", error);
    await ctx.reply("❌ Error switching wallet.");
  }
});

// Helper function to create new wallet
async function createNewWallet(ctx: MyContext, userId: number, name: string) {
  const walletManager = getWalletManager();

  await ctx.reply("⏳ Creating wallet...");

  const walletInfo = await walletManager.createWallet(userId, name);

  // Update session with new wallet
  const session = sessionStore.getOrCreate(userId, ctx.from?.username, ctx.from?.first_name);
  session.walletAddress = walletInfo.address;
  sessionStore.save(session);

  // Show wallet address
  await ctx.reply(
    `✅ <b>${walletInfo.name} Created!</b>

📍 <b>Address:</b>
<code>${walletInfo.address}</code>

🦊 <b>MetaMask Compatible!</b>
You can import this wallet into MetaMask using the seed phrase below.`,
    { parse_mode: "HTML" }
  );

  // Show seed phrase with auto-delete for security
  await sendSensitiveMessage(
    bot,
    ctx.chat!.id,
    `🌱 <b>SEED PHRASE (12 words)</b>

<tg-spoiler><code>${walletInfo.mnemonic}</code></tg-spoiler>

⚠️ <b>EXTREMELY IMPORTANT!</b>
• Write these 12 words on paper
• DO NOT take screenshots
• DO NOT share with ANYONE
• Anyone with these words can steal your funds

🦊 <b>How to import into MetaMask:</b>
1. Open MetaMask → Import Wallet
2. Enter the 12 words in exact order
3. Create a password

🗑️ <i>Message auto-deletes in 60 seconds</i>`,
    { deleteAfterSeconds: 60, protectContent: true },
    new InlineKeyboard()
      .text("🗑️ Delete Now", "delete_this_message")
  );

  await ctx.reply(
    `💡 <b>Next steps:</b>
1. Save the seed phrase in a secure location
2. Deposit Sepolia ETH to create cards
3. Start creating your NFT cards!`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("📥 Deposit ETH", "wallet_deposit")
        .text("🎨 Create Card", "action_create_card")
        .row()
        .text("👛 Go to Wallet", "action_wallet")
    }
  );
}

// Wallet - Show deposit address
bot.callbackQuery("wallet_deposit", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const walletManager = getWalletManager();
    const walletInfo = await walletManager.getWallet(userId);

    if (!walletInfo) {
      await ctx.reply("❌ Wallet not found. Create one first!");
      return;
    }

    await sendSensitiveMessage(
      bot,
      ctx.chat!.id,
      `💰 <b>Deposit ETH</b>

Send ETH to this address (Sepolia Testnet):

<code>${walletInfo.address}</code>

💡 <b>Current balance:</b> ${walletInfo.balanceFormatted} ETH

⚠️ Make sure to send ONLY on Sepolia network!`,
      SENSITIVITY_LEVELS.DEPOSIT_ADDRESS
    );
  } catch (error) {
    console.error("Error showing deposit:", error);
    await ctx.reply("❌ Error. Please try again.");
  }
});

// Wallet - Withdraw
bot.callbackQuery("wallet_withdraw", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const walletManager = getWalletManager();
    const walletInfo = await walletManager.getWallet(userId);

    if (!walletInfo) {
      await ctx.reply("❌ Wallet not found!");
      return;
    }

    if (parseFloat(walletInfo.balanceFormatted) <= 0) {
      await ctx.reply("❌ Insufficient balance for withdrawal.");
      return;
    }

    sessionStore.setState(userId, "awaiting_withdraw_address");

    await ctx.reply(
      `📤 <b>Withdraw ETH</b>

💰 Available balance: <b>${walletInfo.balanceFormatted} ETH</b>

Send the destination address:`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    console.error("Error initiating withdraw:", error);
    await ctx.reply("❌ Error. Please try again.");
  }
});

// Wallet - Export private key (SENSITIVE!)
bot.callbackQuery("wallet_export_key", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  // Rate limit check
  const rateLimitResult = exportKeyRateLimiter.isAllowed(`export_key_${userId}`);
  if (!rateLimitResult.allowed) {
    const minutes = Math.ceil((rateLimitResult.retryAfterMs || 0) / 60000);
    await ctx.reply(`⏳ Too many export attempts. Please wait ${minutes} minute(s) before trying again.`);
    return;
  }

  try {
    const walletManager = getWalletManager();

    if (!walletManager.hasWallet(userId)) {
      await ctx.reply("❌ No wallet found!");
      return;
    }

    const privateKey = await walletManager.exportPrivateKey(userId);

    // Send with shortest auto-delete time and content protection
    await sendSensitiveMessage(
      bot,
      ctx.chat!.id,
      `🔑 <b>PRIVATE KEY</b>

<tg-spoiler><code>${privateKey}</code></tg-spoiler>

⚠️ <b>WARNING!</b>
• NEVER share this key
• Save it in a secure offline location
• This message will be automatically deleted

🗑️ <i>Auto-delete in 30 seconds</i>`,
      SENSITIVITY_LEVELS.PRIVATE_KEY
    );
  } catch (error) {
    console.error("Error exporting key:", error);
    await ctx.reply("❌ Error exporting key.");
  }
});

// Wallet - Export mnemonic/seed phrase
bot.callbackQuery("wallet_export_mnemonic", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  // Rate limit check (uses same limiter as private key export)
  const rateLimitResult = exportKeyRateLimiter.isAllowed(`export_mnemonic_${userId}`);
  if (!rateLimitResult.allowed) {
    const minutes = Math.ceil((rateLimitResult.retryAfterMs || 0) / 60000);
    await ctx.reply(`⏳ Too many export attempts. Please wait ${minutes} minute(s) before trying again.`);
    return;
  }

  try {
    const walletManager = getWalletManager();

    if (!walletManager.hasWallet(userId)) {
      await ctx.reply("❌ No wallet found!");
      return;
    }

    const mnemonic = await walletManager.exportMnemonic(userId);

    if (!mnemonic) {
      await ctx.reply(
        `⚠️ <b>Seed phrase not available</b>

Your wallet was created before the update.
You can still use the private key to import into MetaMask.`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔑 Export Private Key", "wallet_export_key")
        }
      );
      return;
    }

    // Send with auto-delete and content protection
    await sendSensitiveMessage(
      bot,
      ctx.chat!.id,
      `🌱 <b>SEED PHRASE (12 words)</b>

<tg-spoiler><code>${mnemonic}</code></tg-spoiler>

🦊 <b>How to import into MetaMask:</b>
1. Open MetaMask → Menu → Import Account
2. Choose "Seed Phrase"
3. Enter the 12 words in exact order
4. Create a password

⚠️ <b>WARNING!</b>
• NEVER share these words
• Write them on paper, NOT digitally
• Anyone with them can steal your funds

🗑️ <i>Auto-delete in 60 seconds</i>`,
      { deleteAfterSeconds: 60, protectContent: true }
    );
  } catch (error) {
    console.error("Error exporting mnemonic:", error);
    await ctx.reply("❌ Error exporting seed phrase.");
  }
});

// Handle delete_this_message callback for manual deletion
bot.callbackQuery("delete_this_message", async (ctx) => {
  await ctx.answerCallbackQuery("Message deleted");
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Message may already be deleted
  }
});

// Legacy wallet change (now redirects to show wallet)
bot.callbackQuery("change_wallet", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("ℹ️ The system now uses custodial wallets. Your existing wallet remains valid.");
  await showWallet(ctx);
});

// Browse marketplace with pagination
bot.callbackQuery(/^browse_market_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const match = ctx.callbackQuery.data.match(/^browse_market_(\d+)$/);
  if (!match) return;

  const page = parseInt(match[1]);
  await showMarketplaceBrowser(ctx, page);
});

// Buy listing
bot.callbackQuery(/^buy_listing_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  const walletInfo = await getUserWalletWithBalance(userId);
  if (!walletInfo) {
    await ctx.reply("❌ Create your wallet first!", {
      reply_markup: new InlineKeyboard().text("👛 Create Wallet", "wallet_create")
    });
    return;
  }

  const { address: walletAddress, balanceFormatted: userBalance } = walletInfo;

  const match = ctx.callbackQuery.data.match(/^buy_listing_(\d+)$/);
  if (!match) return;

  const listingId = parseInt(match[1]);

  // Get listing details
  const listing = await getEnrichedListing(listingId);
  if (!listing || !listing.active) {
    await ctx.reply("❌ Listing no longer available.");
    return;
  }

  // Check if user is the seller
  if (listing.seller.toLowerCase() === walletAddress.toLowerCase()) {
    await ctx.reply("❌ You cannot buy your own listing!");
    return;
  }

  const priceEth = ethers.formatEther(listing.price);
  const hasEnoughBalance = parseFloat(userBalance) >= parseFloat(priceEth);

  // Confirm purchase
  const confirmKeyboard = new InlineKeyboard()
    .text(`✅ Confirm Purchase`, `confirm_buy_${listingId}`)
    .row()
    .text("❌ Cancel", "cancel_buy");

  await ctx.reply(
    `🛒 *Confirm Purchase*

🎴 *Card:* ${listing.name || `#${listing.tokenId}`}
💰 *Price:* ${priceEth} ETH
👤 *Seller:* \`${formatAddress(listing.seller)}\`

👛 *Your wallet:* \`${formatAddress(walletAddress)}\`
💰 *Balance:* ${userBalance} ETH ${hasEnoughBalance ? "✅" : "⚠️ Insufficient"}

${hasEnoughBalance ? "The NFT will be transferred directly to your wallet!" : "⚠️ Deposit more ETH to your wallet before proceeding."}`,
    { parse_mode: "Markdown", reply_markup: confirmKeyboard }
  );
});

// Confirm buy
bot.callbackQuery(/^confirm_buy_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery("Processing purchase...");

  const userId = ctx.from?.id;
  const match = ctx.callbackQuery.data.match(/^confirm_buy_(\d+)$/);
  if (!match) return;

  const listingId = parseInt(match[1]);

  // Get listing details again to verify
  const listing = await getEnrichedListing(listingId);
  if (!listing || !listing.active) {
    await ctx.editMessageText("❌ Listing no longer available.");
    return;
  }

  await ctx.editMessageText("🔄 *Purchase in progress...*\n\nPlease wait while the transaction is being processed.", { parse_mode: "Markdown" });

  // Use user's custodial wallet if available
  const result = await buyNFTOnChain(listingId, listing.price, userId);

  if (result.success) {
    const successKeyboard = new InlineKeyboard()
      .url("🔍 View Transaction", `${NETWORK.explorer}/tx/${result.txHash}`)
      .row()
      .text("🛍️ Continue Shopping", "browse_market_0")
      .text("🏠 Menu", "main_menu");

    await ctx.editMessageText(
      `✅ *Purchase Complete!*

🎴 *Card:* ${listing.name || `#${listing.tokenId}`}
💰 *Price:* ${ethers.formatEther(listing.price)} ETH
📜 *TX:* \`${result.txHash?.slice(0, 20)}...\`

The NFT is now in your wallet!`,
      { parse_mode: "Markdown", reply_markup: successKeyboard }
    );
  } else {
    await ctx.editMessageText(
      `❌ *Purchase Failed*

${result.error}

Try again or contact support.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🔄 Retry", `buy_listing_${listingId}`)
          .text("🏠 Menu", "main_menu")
      }
    );
  }
});

// Cancel buy
bot.callbackQuery("cancel_buy", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("❌ Purchase cancelled.", {
    reply_markup: new InlineKeyboard()
      .text("🛍️ Continue Browsing", "browse_market_0")
      .text("🏠 Menu", "main_menu")
  });
});

// Sell specific card (from PokeDEXCard contract)
bot.callbackQuery(/^sell_card_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const match = ctx.callbackQuery.data.match(/^sell_card_(\d+)$/);
  if (!match) return;

  const tokenId = match[1];
  const nftContract = CONTRACTS.POKEDEX_CARD;

  if (!nftContract) {
    await ctx.reply("❌ Card contract not configured.");
    return;
  }

  const keyboard = new InlineKeyboard()
    .url("1️⃣ Approve", `${NETWORK.explorer}/address/${nftContract}#writeContract`)
    .row()
    .url("2️⃣ List", `${NETWORK.explorer}/address/${CONTRACTS.MARKETPLACE}#writeContract`);

  await ctx.reply(
    `💰 *Sell Card #${tokenId}*

*Step 1:* \`setApprovalForAll\`
Operator: \`${CONTRACTS.MARKETPLACE}\`

*Step 2:* \`listNFT\`
nftContract: \`${nftContract}\`
tokenId: ${tokenId}
price: (in wei)`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// Sell custom card (from PokeDEXCustomCards contract)
bot.callbackQuery(/^sell_custom_card_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const match = ctx.callbackQuery.data.match(/^sell_custom_card_(\d+)$/);
  if (!match) return;

  const tokenId = match[1];
  const nftContract = CONTRACTS.CUSTOM_CARDS;

  if (!nftContract) {
    await ctx.reply("❌ CustomCards contract not configured.");
    return;
  }

  const keyboard = new InlineKeyboard()
    .url("1️⃣ Approve", `${NETWORK.explorer}/address/${nftContract}#writeContract`)
    .row()
    .url("2️⃣ List", `${NETWORK.explorer}/address/${CONTRACTS.MARKETPLACE}#writeContract`);

  await ctx.reply(
    `💰 *Sell Custom Card #${tokenId}*

*Step 1:* \`setApprovalForAll\`
Operator: \`${CONTRACTS.MARKETPLACE}\`

*Step 2:* \`listNFT\`
nftContract: \`${nftContract}\`
tokenId: ${tokenId}
price: (in wei)`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from?.id;

  if (!userId) return;

  const session = sessionStore.get(userId);

  // Handle wallet input (legacy - now using custodial)
  if (session?.currentState === "awaiting_wallet") {
    if (isValidAddress(text)) {
      sessionStore.setWallet(userId, text);

      await ctx.reply(
        `✅ *Wallet Connected!*

\`${text}\`

Now you can:
• View your cards
• Create custom cards
• Participate in battles`,
        { parse_mode: "Markdown", reply_markup: getMainMenuKeyboard() }
      );
    } else {
      await ctx.reply("❌ Invalid address.\n\nMust start with 0x and be 42 characters long.");
    }
    return;
  }

  // Handle withdraw address input
  if (session?.currentState === "awaiting_withdraw_address") {
    if (isValidAddress(text)) {
      // Save the withdraw address and ask for amount
      session.pendingWithdrawAddress = text;
      session.currentState = "awaiting_withdraw_amount";
      sessionStore.save(session);

      try {
        const walletManager = getWalletManager();
        const walletInfo = await walletManager.getWallet(userId);
        const maxAmount = walletInfo?.balanceFormatted || "0";

        await ctx.reply(
          `📤 <b>Withdraw to:</b>
<code>${text}</code>

💰 Available balance: <b>${maxAmount} ETH</b>

Enter the amount to withdraw (in ETH):
<i>E.g.: 0.01 or "max" for all</i>`,
          { parse_mode: "HTML" }
        );
      } catch {
        await ctx.reply("❌ Error. Please try again.");
        sessionStore.setState(userId, "idle");
      }
    } else {
      await ctx.reply("❌ Invalid address.\n\nMust start with 0x and be 42 characters.");
    }
    return;
  }

  // Handle withdraw amount input
  if (session?.currentState === "awaiting_withdraw_amount") {
    // Rate limit check for withdrawals
    const rateLimitResult = withdrawRateLimiter.isAllowed(`withdraw_${userId}`);
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil((rateLimitResult.retryAfterMs || 0) / 60000);
      sessionStore.setState(userId, "idle");
      await ctx.reply(`⏳ Too many withdrawal attempts. Please wait ${minutes} minute(s) before trying again.`);
      return;
    }

    const toAddress = session.pendingWithdrawAddress;
    if (!toAddress) {
      sessionStore.setState(userId, "idle");
      await ctx.reply("❌ Session expired. Please try again from /wallet");
      return;
    }

    try {
      const walletManager = getWalletManager();
      const walletInfo = await walletManager.getWallet(userId);

      if (!walletInfo) {
        sessionStore.setState(userId, "idle");
        await ctx.reply("❌ Wallet not found.");
        return;
      }

      let amount: string;
      if (text.toLowerCase() === "max" || text.toLowerCase() === "all") {
        // Calculate max minus gas estimate
        const balance = parseFloat(walletInfo.balanceFormatted);
        const gasEstimate = 0.0005; // Conservative gas estimate
        amount = Math.max(0, balance - gasEstimate).toFixed(6);
      } else {
        amount = text.replace(",", ".");
        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          await ctx.reply("❌ Invalid amount. Enter a positive number.");
          return;
        }
      }

      // Reset state before transaction
      session.pendingWithdrawAddress = undefined;
      session.currentState = "idle";
      sessionStore.save(session);

      await ctx.reply("⏳ Sending transaction...");

      const tx = await walletManager.withdraw(userId, toAddress, amount);

      await sendSensitiveMessage(
        bot,
        ctx.chat!.id,
        `✅ <b>Withdrawal Sent!</b>

💰 <b>Amount:</b> ${amount} ETH
📤 <b>To:</b> <code>${toAddress}</code>
📜 <b>TX:</b> <code>${tx.hash}</code>

<a href="${NETWORK.explorer}/tx/${tx.hash}">View on Etherscan</a>`,
        SENSITIVITY_LEVELS.TRANSACTION
      );
    } catch (error: any) {
      sessionStore.setState(userId, "idle");
      console.error("Withdrawal error:", error);
      // Sanitize error message - only show expected errors to user
      const safeErrors = ["Insufficient balance", "invalid address", "gas"];
      const isSafeError = safeErrors.some(e => error.message?.toLowerCase().includes(e.toLowerCase()));
      await ctx.reply(isSafeError ? `❌ ${error.message}` : "❌ Withdrawal failed. Please try again later.");
    }
    return;
  }

  // Unknown message
  if (!text.startsWith("/")) {
    await ctx.reply("🤔 I didn't understand. Use the menu or /help for commands.", {
      reply_markup: getMainMenuKeyboard()
    });
  }
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error for update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error("Grammy error:", e.description);
  } else if (e instanceof HttpError) {
    console.error("HTTP error:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

// =============================================================================
// REGISTER BOT COMMANDS (Shows in "/" menu)
// =============================================================================

async function registerCommands() {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Main menu" },
      { command: "help", description: "Commands guide" },
      { command: "clear", description: "Clear chat" },
      { command: "cards", description: "Your cards" },
      { command: "card", description: "Card details (e.g.: /card 1)" },
      { command: "packs", description: "Buy packs" },
      { command: "createcard", description: "Create custom card" },
      { command: "mycreations", description: "Your created cards" },
      { command: "drafts", description: "Saved drafts" },
      { command: "market", description: "NFT Marketplace" },
      { command: "browse", description: "Browse marketplace NFTs" },
      { command: "listings", description: "Your listings" },
      { command: "sell", description: "List a card for sale" },
      { command: "list", description: "List a card for sale" },
      { command: "battle", description: "Battle arena" },
      { command: "leaderboard", description: "Leaderboard" },
      { command: "stats", description: "Your statistics" },
      { command: "wallet", description: "Manage wallet" },
      { command: "security", description: "Security info" },
      { command: "contracts", description: "Contract addresses" },
    ]);
    console.log("✅ Bot commands registered");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}

// =============================================================================
// START BOT
// =============================================================================

async function start() {
  console.log("🤖 Starting PokeDEX Telegram Bot...");
  console.log("━".repeat(60));

  initContracts();

  // Initialize Custodial Wallet Manager
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";
  initializeWalletManager(WALLETS_DIR, WALLET_MASTER_KEY, rpcUrl);
  console.log("✅ Custodial Wallet Manager initialized");
  console.log(`   Wallets dir: ${WALLETS_DIR}`);

  console.log("✅ Bot token configured");
  console.log(`📡 Network: ${NETWORK.name} (Chain ID: ${NETWORK.chainId})`);
  console.log("━".repeat(60));
  console.log("📜 Contracts:");
  console.log(`   PokeDEXCard:    ${CONTRACTS.POKEDEX_CARD || "Not deployed"}`);
  console.log(`   CardPack (VRF): ${CONTRACTS.CARD_PACK || "Not deployed"}`);
  console.log(`   CardPack QRNG:  ${CONTRACTS.CARD_PACK_QRNG || "Not deployed"}`);
  console.log(`   BattleArena:    ${CONTRACTS.BATTLE_ARENA || "Not deployed"}`);
  console.log(`   CustomCards:    ${CONTRACTS.CUSTOM_CARDS || "Not deployed"}`);
  console.log(`   Marketplace:    ${CONTRACTS.MARKETPLACE || "Not deployed"}`);
  console.log("━".repeat(60));

  // Verify contracts
  if (cardContract) {
    try {
      const supply = await cardContract.totalSupply();
      console.log(`✅ PokeDEXCard verified - Supply: ${supply}`);
    } catch { console.log("⚠️  PokeDEXCard not accessible"); }
  }

  if (battleContract) {
    try {
      await battleContract.getLeaderboard(1);
      console.log("✅ BattleArena verified");
    } catch { console.log("⚠️  BattleArena not accessible"); }
  }

  if (customCardsContract) {
    try {
      const supply = await customCardsContract.totalSupply();
      console.log(`✅ CustomCards verified - Supply: ${supply}`);
    } catch { console.log("⚠️  CustomCards not accessible"); }
  }

  if (marketplaceContract) {
    try {
      const fee = await marketplaceContract.marketplaceFee();
      console.log(`✅ Marketplace verified - Fee: ${Number(fee) / 100}%`);
    } catch { console.log("⚠️  Marketplace not accessible"); }
  }

  console.log("━".repeat(60));

  // Register commands menu
  await registerCommands();

  console.log("━".repeat(60));
  console.log("🚀 Bot is running!");
  console.log("━".repeat(60));

  bot.start();
}

start();
