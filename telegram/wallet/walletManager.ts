import { ethers } from "ethers";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// TYPES
// =============================================================================

interface EncryptedWallet {
  id: string;
  name: string;
  address: string;
  encryptedPrivateKey: string;
  encryptedMnemonic?: string;
  mnemonicIv?: string;
  iv: string;
  salt: string;
  createdAt: number;
  lastUsed: number;
}

interface UserWalletsIndex {
  activeWalletId: string;
  wallets: Array<{
    id: string;
    name: string;
    address: string;
    createdAt: number;
  }>;
}

export interface WalletInfo {
  id: string;
  name: string;
  address: string;
  balance: string;
  balanceFormatted: string;
  isActive: boolean;
}

export interface WalletCreationResult extends WalletInfo {
  mnemonic: string;
}

// =============================================================================
// RATE LIMITER - Prevent brute force on sensitive operations
// =============================================================================

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
}

export class RateLimiter {
  private attempts: Map<string, RateLimitEntry> = new Map();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(maxAttempts = 3, windowMs = 60000, cooldownMs = 300000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    // Clean up stale entries every 10 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 600000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      const expiryTime = Math.max(
        entry.firstAttempt + this.windowMs,
        entry.lastAttempt + this.cooldownMs
      );
      if (now > expiryTime) {
        this.attempts.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  isAllowed(key: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const entry = this.attempts.get(key);

    if (!entry) {
      this.attempts.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
      return { allowed: true };
    }

    // Check if in cooldown
    if (entry.count >= this.maxAttempts) {
      const cooldownEnd = entry.lastAttempt + this.cooldownMs;
      if (now < cooldownEnd) {
        return { allowed: false, retryAfterMs: cooldownEnd - now };
      }
      // Cooldown expired, reset
      this.attempts.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
      return { allowed: true };
    }

    // Check if window expired
    if (now - entry.firstAttempt > this.windowMs) {
      this.attempts.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
      return { allowed: true };
    }

    // Within window, increment
    entry.count++;
    entry.lastAttempt = now;
    return { allowed: true };
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

// Global rate limiters for sensitive operations
export const exportKeyRateLimiter = new RateLimiter(3, 60000, 300000); // 3 attempts per minute, 5 min cooldown
export const withdrawRateLimiter = new RateLimiter(5, 60000, 600000); // 5 attempts per minute, 10 min cooldown
export const marketplaceRateLimiter = new RateLimiter(10, 60000, 180000); // 10 ops per minute, 3 min cooldown

// =============================================================================
// WALLET MANAGER - Multi-wallet support
// =============================================================================

// Atomic file write helper - prevents data corruption on crash
function atomicWriteFileSync(filePath: string, data: string, mode: number = 0o600): void {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, data, { mode });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw error;
  }
}

export class WalletManager {
  private readonly walletsDir: string;
  private readonly masterKey: string;
  private readonly algorithm = "aes-256-gcm";
  private readonly keyLength = 32;
  private readonly ivLength = 16;
  private readonly saltLength = 32;
  private readonly authTagLength = 16;
  private provider: ethers.JsonRpcProvider;

  constructor(walletsDir: string, masterKey: string, rpcUrl: string) {
    this.walletsDir = walletsDir;
    this.masterKey = masterKey;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    if (!fs.existsSync(walletsDir)) {
      fs.mkdirSync(walletsDir, { recursive: true });
    }
  }

  // =============================================================================
  // USER DIRECTORY & INDEX MANAGEMENT
  // =============================================================================

  private getUserDir(userId: number): string {
    const dir = path.join(this.walletsDir, userId.toString());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
  }

  private getIndexPath(userId: number): string {
    return path.join(this.getUserDir(userId), "wallets.json");
  }

  private sanitizeWalletId(walletId: string): string {
    // Only allow alphanumeric and hyphens to prevent path traversal
    return walletId.replace(/[^a-zA-Z0-9-]/g, "");
  }

  private getWalletPath(userId: number, walletId: string): string {
    const sanitizedId = this.sanitizeWalletId(walletId);
    if (sanitizedId !== walletId || sanitizedId.length === 0) {
      throw new Error("Invalid wallet ID");
    }
    return path.join(this.getUserDir(userId), `${sanitizedId}.wallet.enc`);
  }

  private loadIndex(userId: number): UserWalletsIndex {
    const indexPath = this.getIndexPath(userId);
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, "utf8"));
    }
    return { activeWalletId: "", wallets: [] };
  }

  private saveIndex(userId: number, index: UserWalletsIndex): void {
    atomicWriteFileSync(this.getIndexPath(userId), JSON.stringify(index, null, 2), 0o600);
  }

  // Migration: check for old single-wallet format
  private migrateOldWallet(userId: number): void {
    const oldPath = path.join(this.walletsDir, `${userId}.wallet.enc`);
    if (fs.existsSync(oldPath)) {
      const oldData = JSON.parse(fs.readFileSync(oldPath, "utf8")) as any;
      const walletId = crypto.randomUUID().slice(0, 8);

      const newWallet: EncryptedWallet = {
        ...oldData,
        id: walletId,
        name: "Wallet 1",
      };

      const userDir = this.getUserDir(userId);
      atomicWriteFileSync(path.join(userDir, `${walletId}.wallet.enc`), JSON.stringify(newWallet, null, 2), 0o600);

      const index: UserWalletsIndex = {
        activeWalletId: walletId,
        wallets: [{
          id: walletId,
          name: "Wallet 1",
          address: oldData.address,
          createdAt: oldData.createdAt || Date.now(),
        }]
      };
      this.saveIndex(userId, index);

      // Remove old file
      fs.unlinkSync(oldPath);
      console.log(`Migrated wallet for user ${userId}`);
    }
  }

  // =============================================================================
  // WALLET CREATION
  // =============================================================================

  async createWallet(userId: number, name?: string): Promise<WalletCreationResult> {
    // Migrate old wallet if exists
    this.migrateOldWallet(userId);

    const index = this.loadIndex(userId);
    const walletNumber = index.wallets.length + 1;
    const walletName = name || `Wallet ${walletNumber}`;
    const walletId = crypto.randomUUID().slice(0, 8);

    // Generate new wallet with mnemonic
    const wallet = ethers.Wallet.createRandom();
    const privateKey = wallet.privateKey;
    const mnemonic = wallet.mnemonic?.phrase || "";

    // Encrypt private key
    const salt = crypto.randomBytes(this.saltLength);
    const iv = crypto.randomBytes(this.ivLength);
    const derivedKey = this.deriveKey(userId, walletId, salt);

    const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv);
    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    // Encrypt mnemonic
    const mnemonicIv = crypto.randomBytes(this.ivLength);
    const mnemonicCipher = crypto.createCipheriv(this.algorithm, derivedKey, mnemonicIv);
    let encryptedMnemonic = mnemonicCipher.update(mnemonic, "utf8", "hex");
    encryptedMnemonic += mnemonicCipher.final("hex");
    const mnemonicAuthTag = mnemonicCipher.getAuthTag();

    const encryptedWallet: EncryptedWallet = {
      id: walletId,
      name: walletName,
      address: wallet.address,
      encryptedPrivateKey: encrypted + authTag.toString("hex"),
      encryptedMnemonic: encryptedMnemonic + mnemonicAuthTag.toString("hex"),
      mnemonicIv: mnemonicIv.toString("hex"),
      iv: iv.toString("hex"),
      salt: salt.toString("hex"),
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    // Save encrypted wallet with restricted permissions (atomic write)
    atomicWriteFileSync(this.getWalletPath(userId, walletId), JSON.stringify(encryptedWallet, null, 2), 0o600);

    // Update index
    index.wallets.push({
      id: walletId,
      name: walletName,
      address: wallet.address,
      createdAt: Date.now(),
    });

    // Set as active if first wallet
    if (!index.activeWalletId) {
      index.activeWalletId = walletId;
    }
    this.saveIndex(userId, index);

    const balance = await this.provider.getBalance(wallet.address);

    return {
      id: walletId,
      name: walletName,
      address: wallet.address,
      balance: balance.toString(),
      balanceFormatted: ethers.formatEther(balance),
      mnemonic: mnemonic,
      isActive: index.activeWalletId === walletId,
    };
  }

  // =============================================================================
  // WALLET LISTING & SELECTION
  // =============================================================================

  async listWallets(userId: number): Promise<WalletInfo[]> {
    this.migrateOldWallet(userId);
    const index = this.loadIndex(userId);

    const wallets: WalletInfo[] = [];
    for (const w of index.wallets) {
      try {
        const balance = await this.provider.getBalance(w.address);
        wallets.push({
          id: w.id,
          name: w.name,
          address: w.address,
          balance: balance.toString(),
          balanceFormatted: ethers.formatEther(balance),
          isActive: w.id === index.activeWalletId,
        });
      } catch {
        wallets.push({
          id: w.id,
          name: w.name,
          address: w.address,
          balance: "0",
          balanceFormatted: "0.0",
          isActive: w.id === index.activeWalletId,
        });
      }
    }
    return wallets;
  }

  setActiveWallet(userId: number, walletId: string): boolean {
    const index = this.loadIndex(userId);
    const wallet = index.wallets.find(w => w.id === walletId);
    if (!wallet) return false;

    index.activeWalletId = walletId;
    this.saveIndex(userId, index);
    return true;
  }

  getWalletCount(userId: number): number {
    this.migrateOldWallet(userId);
    const index = this.loadIndex(userId);
    return index.wallets.length;
  }

  // =============================================================================
  // ACTIVE WALLET OPERATIONS
  // =============================================================================

  async getWallet(userId: number): Promise<WalletInfo | null> {
    this.migrateOldWallet(userId);
    const index = this.loadIndex(userId);

    if (!index.activeWalletId || index.wallets.length === 0) {
      return null;
    }

    const activeWallet = index.wallets.find(w => w.id === index.activeWalletId);
    if (!activeWallet) return null;

    try {
      const balance = await this.provider.getBalance(activeWallet.address);
      return {
        id: activeWallet.id,
        name: activeWallet.name,
        address: activeWallet.address,
        balance: balance.toString(),
        balanceFormatted: ethers.formatEther(balance),
        isActive: true,
      };
    } catch {
      return null;
    }
  }

  async getSigner(userId: number, walletId?: string): Promise<ethers.Wallet> {
    this.migrateOldWallet(userId);
    const index = this.loadIndex(userId);

    const targetId = walletId || index.activeWalletId;
    if (!targetId) {
      throw new Error("No wallet found for this user");
    }

    const filePath = this.getWalletPath(userId, targetId);
    if (!fs.existsSync(filePath)) {
      throw new Error("Wallet file not found");
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as EncryptedWallet;
    const salt = Buffer.from(data.salt, "hex");
    const iv = Buffer.from(data.iv, "hex");
    const derivedKey = this.deriveKey(userId, targetId, salt);

    const encryptedData = data.encryptedPrivateKey.slice(0, -this.authTagLength * 2);
    const authTag = Buffer.from(data.encryptedPrivateKey.slice(-this.authTagLength * 2), "hex");

    const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    // Update last used (atomic write)
    data.lastUsed = Date.now();
    atomicWriteFileSync(filePath, JSON.stringify(data, null, 2), 0o600);

    return new ethers.Wallet(decrypted, this.provider);
  }

  async exportPrivateKey(userId: number, walletId?: string): Promise<string> {
    const signer = await this.getSigner(userId, walletId);
    return signer.privateKey;
  }

  async exportMnemonic(userId: number, walletId?: string): Promise<string | null> {
    this.migrateOldWallet(userId);
    const index = this.loadIndex(userId);

    const targetId = walletId || index.activeWalletId;
    if (!targetId) return null;

    const filePath = this.getWalletPath(userId, targetId);
    if (!fs.existsSync(filePath)) return null;

    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as EncryptedWallet;

    if (!data.encryptedMnemonic || !data.mnemonicIv) {
      return null;
    }

    const salt = Buffer.from(data.salt, "hex");
    const mnemonicIv = Buffer.from(data.mnemonicIv, "hex");
    const derivedKey = this.deriveKey(userId, targetId, salt);

    const encryptedData = data.encryptedMnemonic.slice(0, -this.authTagLength * 2);
    const authTag = Buffer.from(data.encryptedMnemonic.slice(-this.authTagLength * 2), "hex");

    const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, mnemonicIv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  async withdraw(userId: number, to: string, amount: string): Promise<ethers.TransactionResponse> {
    const signer = await this.getSigner(userId);
    const value = ethers.parseEther(amount);

    const balance = await this.provider.getBalance(signer.address);
    const gasPrice = (await this.provider.getFeeData()).gasPrice || 0n;
    const estimatedGas = 21000n;
    const totalCost = value + gasPrice * estimatedGas;

    if (balance < totalCost) {
      throw new Error(
        `Insufficient balance. Have: ${ethers.formatEther(balance)} ETH, Need: ${ethers.formatEther(totalCost)} ETH`
      );
    }

    return signer.sendTransaction({ to, value });
  }

  hasWallet(userId: number): boolean {
    this.migrateOldWallet(userId);
    const index = this.loadIndex(userId);
    return index.wallets.length > 0;
  }

  renameWallet(userId: number, walletId: string, newName: string): boolean {
    const index = this.loadIndex(userId);
    const wallet = index.wallets.find(w => w.id === walletId);
    if (!wallet) return false;

    wallet.name = newName;
    this.saveIndex(userId, index);

    // Also update the encrypted wallet file
    const filePath = this.getWalletPath(userId, walletId);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as EncryptedWallet;
      data.name = newName;
      atomicWriteFileSync(filePath, JSON.stringify(data, null, 2), 0o600);
    }

    return true;
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private deriveKey(userId: number, walletId: string, salt: Buffer): Buffer {
    const keyMaterial = `${this.masterKey}:${userId}:${walletId}`;
    return crypto.pbkdf2Sync(keyMaterial, salt, 100000, this.keyLength, "sha512");
  }
}

// =============================================================================
// MESSAGE AUTO-DELETE HELPER
// =============================================================================

export interface AutoDeleteOptions {
  deleteAfterSeconds: number;
  protectContent?: boolean;
}

export const SENSITIVITY_LEVELS = {
  PRIVATE_KEY: { deleteAfterSeconds: 30, protectContent: true },
  BALANCE: { deleteAfterSeconds: 60, protectContent: true },
  DEPOSIT_ADDRESS: { deleteAfterSeconds: 120, protectContent: false },
  TRANSACTION: { deleteAfterSeconds: 300, protectContent: false },
} as const;

export function scheduleMessageDeletion(
  bot: any,
  chatId: number,
  messageId: number,
  options: AutoDeleteOptions
): NodeJS.Timeout {
  return setTimeout(async () => {
    try {
      await bot.api.deleteMessage(chatId, messageId);
    } catch (error) {
      console.log(`Could not delete message ${messageId}: ${error}`);
    }
  }, options.deleteAfterSeconds * 1000);
}

export async function sendSensitiveMessage(
  bot: any,
  chatId: number,
  text: string,
  options: AutoDeleteOptions,
  replyMarkup?: any
): Promise<{ messageId: number; deleteTimer: NodeJS.Timeout }> {
  const message = await bot.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    protect_content: options.protectContent,
    reply_markup: replyMarkup || {
      inline_keyboard: [[{ text: "🗑️ Delete Now", callback_data: "delete_this_message" }]],
    },
  });

  const deleteTimer = scheduleMessageDeletion(bot, chatId, message.message_id, options);

  return {
    messageId: message.message_id,
    deleteTimer,
  };
}

// =============================================================================
// SINGLETON FACTORY
// =============================================================================

let walletManagerInstance: WalletManager | null = null;

export function initializeWalletManager(
  walletsDir: string,
  masterKey: string,
  rpcUrl: string
): WalletManager {
  if (!walletManagerInstance) {
    walletManagerInstance = new WalletManager(walletsDir, masterKey, rpcUrl);
  }
  return walletManagerInstance;
}

export function getWalletManager(): WalletManager {
  if (!walletManagerInstance) {
    throw new Error("WalletManager not initialized. Call initializeWalletManager first.");
  }
  return walletManagerInstance;
}
