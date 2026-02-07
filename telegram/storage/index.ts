// =============================================================================
// STORAGE MODULE - File-based JSON storage for PokeDEX bot
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import type {
  UserSession,
  CardDraft,
  CachedCard,
  CardMetadataCache,
  SessionState,
  DraftStatus,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const DRAFTS_DIR = path.join(DATA_DIR, "drafts");
const CARDS_CACHE_FILE = path.join(DATA_DIR, "cards/cache.json");

// =============================================================================
// UTILITIES
// =============================================================================

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content) as T;
    }
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
  }
  return defaultValue;
}

function writeJsonFile<T>(filePath: string, data: T): void {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

// =============================================================================
// SESSION STORE
// =============================================================================

export class SessionStore {
  private sessions: Map<number, UserSession> = new Map();

  constructor() {
    ensureDirectory(SESSIONS_DIR);
    this.loadAllSessions();
  }

  private loadAllSessions(): void {
    try {
      const files = fs.readdirSync(SESSIONS_DIR);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const session = readJsonFile<UserSession | null>(
            path.join(SESSIONS_DIR, file),
            null
          );
          if (session) {
            this.sessions.set(session.telegramUserId, session);
          }
        }
      }
      console.log(`Loaded ${this.sessions.size} sessions from disk`);
    } catch (error) {
      console.error("Error loading sessions:", error);
    }
  }

  private getFilePath(telegramUserId: number): string {
    return path.join(SESSIONS_DIR, `${telegramUserId}.json`);
  }

  get(telegramUserId: number): UserSession | null {
    return this.sessions.get(telegramUserId) || null;
  }

  getOrCreate(
    telegramUserId: number,
    telegramUsername?: string,
    firstName?: string
  ): UserSession {
    let session = this.sessions.get(telegramUserId);
    if (!session) {
      session = {
        telegramUserId,
        telegramUsername,
        firstName,
        currentState: "idle",
        lastActivity: Date.now(),
        createdAt: Date.now(),
        language: "it",
        notificationsEnabled: true,
      };
      this.save(session);
    } else {
      // Update activity
      session.lastActivity = Date.now();
      if (telegramUsername) session.telegramUsername = telegramUsername;
      if (firstName) session.firstName = firstName;
    }
    return session;
  }

  save(session: UserSession): void {
    session.lastActivity = Date.now();
    this.sessions.set(session.telegramUserId, session);
    writeJsonFile(this.getFilePath(session.telegramUserId), session);
  }

  delete(telegramUserId: number): void {
    this.sessions.delete(telegramUserId);
    const filePath = this.getFilePath(telegramUserId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  setState(telegramUserId: number, state: SessionState): void {
    const session = this.get(telegramUserId);
    if (session) {
      session.currentState = state;
      this.save(session);
    }
  }

  setWallet(telegramUserId: number, walletAddress: string): void {
    const session = this.get(telegramUserId);
    if (session) {
      session.walletAddress = walletAddress;
      session.walletConnectedAt = Date.now();
      session.currentState = "idle";
      this.save(session);
    }
  }

  setCurrentDraft(telegramUserId: number, draftId: string | undefined): void {
    const session = this.get(telegramUserId);
    if (session) {
      session.currentDraftId = draftId;
      this.save(session);
    }
  }

  /**
   * Cerca una sessione utente dato un indirizzo wallet Ethereum.
   * Finds a user session by their Ethereum wallet address.
   *
   * Usato dal sistema di notifiche per mappare l'indirizzo del venditore
   * (emesso dall'evento NFTSold on-chain) al suo ID Telegram.
   *
   * Used by the notification system to map a seller's address
   * (emitted by the on-chain NFTSold event) to their Telegram ID.
   *
   * @param address - Indirizzo Ethereum da cercare / Ethereum address to search for
   * @returns La sessione utente corrispondente, o null se non trovata /
   *          The matching user session, or null if not found
   */
  getAll(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  findByWalletAddress(address: string): UserSession | null {
    const lowerAddress = address.toLowerCase();
    for (const session of this.sessions.values()) {
      if (session.walletAddress?.toLowerCase() === lowerAddress) {
        return session;
      }
    }
    return null;
  }
}

// =============================================================================
// DRAFT STORE
// =============================================================================

export class DraftStore {
  constructor() {
    ensureDirectory(DRAFTS_DIR);
  }

  private getFilePath(telegramUserId: number, draftId: string): string {
    const userDir = path.join(DRAFTS_DIR, telegramUserId.toString());
    ensureDirectory(userDir);
    return path.join(userDir, `${draftId}.json`);
  }

  create(
    telegramUserId: number,
    telegramUsername?: string,
    creatorName?: string
  ): CardDraft {
    const draft: CardDraft = {
      draftId: uuidv4(),
      telegramUserId,
      telegramUsername,
      creatorName: creatorName || "Anonymous",
      cardName: "",
      stats: {
        hp: 100,
        attack: 50,
        defense: 50,
        speed: 50,
        pokemonType: 0,
        rarity: 0,
        generation: 1,
      },
      royaltyPercentage: 500, // 5% default
      status: "in_progress",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.save(draft);
    return draft;
  }

  get(telegramUserId: number, draftId: string): CardDraft | null {
    return readJsonFile<CardDraft | null>(
      this.getFilePath(telegramUserId, draftId),
      null
    );
  }

  save(draft: CardDraft): void {
    draft.updatedAt = Date.now();
    writeJsonFile(this.getFilePath(draft.telegramUserId, draft.draftId), draft);
  }

  update(
    telegramUserId: number,
    draftId: string,
    updates: Partial<CardDraft>
  ): CardDraft | null {
    const draft = this.get(telegramUserId, draftId);
    if (draft) {
      Object.assign(draft, updates);
      this.save(draft);
      return draft;
    }
    return null;
  }

  delete(telegramUserId: number, draftId: string): void {
    const filePath = this.getFilePath(telegramUserId, draftId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  listByUser(telegramUserId: number): CardDraft[] {
    const userDir = path.join(DRAFTS_DIR, telegramUserId.toString());
    if (!fs.existsSync(userDir)) return [];

    const drafts: CardDraft[] = [];
    const files = fs.readdirSync(userDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const draft = readJsonFile<CardDraft | null>(
          path.join(userDir, file),
          null
        );
        if (draft) drafts.push(draft);
      }
    }
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getActiveDraft(telegramUserId: number): CardDraft | null {
    const drafts = this.listByUser(telegramUserId);
    return drafts.find((d) => d.status === "in_progress") || null;
  }

  markStatus(
    telegramUserId: number,
    draftId: string,
    status: DraftStatus,
    extra?: Partial<CardDraft>
  ): CardDraft | null {
    return this.update(telegramUserId, draftId, { status, ...extra });
  }
}

// =============================================================================
// CARD CACHE STORE
// =============================================================================

export class CardCacheStore {
  private cache: CardMetadataCache;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  constructor() {
    ensureDirectory(path.dirname(CARDS_CACHE_FILE));
    this.cache = readJsonFile<CardMetadataCache>(CARDS_CACHE_FILE, {
      cards: {},
      lastUpdated: 0,
    });
  }

  private getCacheKey(contractAddress: string, tokenId: number): string {
    return `${contractAddress.toLowerCase()}_${tokenId}`;
  }

  get(contractAddress: string, tokenId: number): CachedCard | null {
    const key = this.getCacheKey(contractAddress, tokenId);
    const card = this.cache.cards[key];
    if (card && Date.now() - card.cachedAt < this.cacheTTL) {
      return card;
    }
    return null;
  }

  set(card: CachedCard): void {
    const key = this.getCacheKey(card.contractAddress, card.tokenId);
    card.cachedAt = Date.now();
    this.cache.cards[key] = card;
    this.cache.lastUpdated = Date.now();
    this.saveCache();
  }

  invalidate(contractAddress: string, tokenId: number): void {
    const key = this.getCacheKey(contractAddress, tokenId);
    delete this.cache.cards[key];
    this.saveCache();
  }

  private saveCache(): void {
    writeJsonFile(CARDS_CACHE_FILE, this.cache);
  }
}

// =============================================================================
// SINGLETON INSTANCES
// =============================================================================

export const sessionStore = new SessionStore();
export const draftStore = new DraftStore();
export const cardCacheStore = new CardCacheStore();

export * from "./types.js";
