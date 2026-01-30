// =============================================================================
// STORAGE TYPES - Off-chain data structures for PokeDEX bot
// =============================================================================

export type SessionState =
  | "idle"
  | "awaiting_wallet"
  | "awaiting_withdraw_address"
  | "awaiting_withdraw_amount"
  | "creating_card"
  | "collecting_name"
  | "collecting_card_name"
  | "collecting_type"
  | "collecting_hp"
  | "collecting_attack"
  | "collecting_defense"
  | "collecting_speed"
  | "collecting_rarity"
  | "collecting_image"
  | "collecting_description"
  | "preview_card"
  | "collecting_price"
  | "collecting_royalty"
  | "confirm_deploy";

export type DraftStatus =
  | "in_progress"
  | "ready_to_mint"
  | "uploading"
  | "minting"
  | "minted"
  | "failed"
  | "abandoned";

export interface UserSession {
  telegramUserId: number;
  telegramUsername?: string;
  firstName?: string;
  lastName?: string;
  walletAddress?: string;
  walletConnectedAt?: number;
  currentState: SessionState;
  currentDraftId?: string;
  lastActivity: number;
  createdAt: number;
  language: "en" | "it";
  notificationsEnabled: boolean;
  // Legacy compatibility
  pendingAction?: string;
  // Withdraw flow
  pendingWithdrawAddress?: string;
}

export interface CardDraft {
  draftId: string;
  telegramUserId: number;
  telegramUsername?: string;
  creatorName: string;

  // Card metadata
  cardName: string;
  description?: string;

  // Stats (matches on-chain structure)
  stats: {
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    pokemonType: number;
    rarity: number;
    generation: number;
  };

  // Image handling
  imageSource?: "telegram" | "url" | "cardmaker";
  imageTelegramFileId?: string;
  imageUrl?: string;
  cardMakerUrl?: string;
  ipfsImageHash?: string;
  ipfsImageUrl?: string;

  // NFT metadata
  metadataUri?: string;
  royaltyPercentage: number;
  priceInEth?: string;

  // Lifecycle
  status: DraftStatus;
  createdAt: number;
  updatedAt: number;
  mintedAt?: number;
  mintTxHash?: string;
  mintedTokenId?: number;
  errorMessage?: string;
}

export interface CachedCard {
  tokenId: number;
  contractAddress: string;
  isCustom: boolean;

  // On-chain data
  stats: {
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    pokemonType: number;
    rarity: number;
    generation: number;
    experience: number;
  };

  // Metadata
  name?: string;
  description?: string;
  imageUrl?: string;

  // Custom card specific
  creator?: string;
  verified?: boolean;
  banned?: boolean;

  // Cache metadata
  owner?: string;
  battlePower?: number;
  cachedAt: number;
}

export interface CardMetadataCache {
  cards: Record<string, CachedCard>;
  lastUpdated: number;
}

// NFT Metadata JSON structure (for IPFS)
export interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  attributes: NFTAttribute[];
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
  display_type?: string;
  max_value?: number;
}
