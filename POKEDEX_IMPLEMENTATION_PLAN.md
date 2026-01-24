# PokeDEX Implementation Plan

> **Version:** 1.0.0
> **Date:** 24 Gennaio 2026
> **Status:** Ready for Development
> **Principio Guida:** Keep it Simple

---

## Executive Summary

PokeDEX è un launchpad per token Pokemon su Solana con meccanismo di bonding curve stile Pump.fun. L'applicazione opera esclusivamente tramite Telegram bot, eliminando la necessità di una web interface.

**Caratteristiche chiave:**
- Bonding curve AMM con virtual liquidity
- Token SPL con metadata Pokemon (tipo, stats, rarità)
- Interfaccia Telegram per tutte le operazioni
- Graduation automatica verso Raydium/Meteora
- Smart contract minimale e sicuro

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technical Stack](#2-technical-stack)
3. [Smart Contract Design](#3-smart-contract-design)
4. [Bonding Curve Specification](#4-bonding-curve-specification)
5. [Token Economics](#5-token-economics)
6. [Telegram Bot Architecture](#6-telegram-bot-architecture)
7. [SDK Integration Layer](#7-sdk-integration-layer)
8. [Security Framework](#8-security-framework)
9. [Development Phases](#9-development-phases)
10. [Testing Strategy](#10-testing-strategy)
11. [Deployment Checklist](#11-deployment-checklist)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           POKEDEX ARCHITECTURE                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐   │
│   │  TELEGRAM BOT   │────▶│   SDK LAYER     │────▶│   SOLANA BLOCKCHAIN     │   │
│   │  (TypeScript)   │     │ (@pokedex/sdk)  │     │   (Anchor Program)      │   │
│   └─────────────────┘     └─────────────────┘     └─────────────────────────┘   │
│          │                        │                          │                   │
│          ▼                        ▼                          ▼                   │
│   ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐   │
│   │ Command Handlers│     │ TX Builder      │     │ PokeDEX Program         │   │
│   │ Wallet Manager  │     │ RPC Pool        │     │ ├── initialize          │   │
│   │ Session State   │     │ Retry Engine    │     │ ├── create_token        │   │
│   │ Rate Limiter    │     │ Event Listener  │     │ ├── buy                 │   │
│   └─────────────────┘     └─────────────────┘     │ ├── sell                │   │
│          │                        │               │ ├── withdraw_fees       │   │
│          ▼                        ▼               │ └── graduate            │   │
│   ┌─────────────────┐     ┌─────────────────┐     └─────────────────────────┘   │
│   │     REDIS       │     │   CACHE LAYER   │                │                   │
│   │  User Sessions  │     │  Account Cache  │                ▼                   │
│   │  TX State       │     │  Price Cache    │     ┌─────────────────────────┐   │
│   └─────────────────┘     └─────────────────┘     │   EXTERNAL PROTOCOLS    │   │
│                                                    │   Raydium, Meteora      │   │
│                                                    │   Jupiter, Metaplex     │   │
│                                                    └─────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technical Stack

### Smart Contract Layer

| Component | Version | Notes |
|-----------|---------|-------|
| **Rust** | 1.75.0+ | Stable toolchain |
| **Solana CLI** | 1.18.x | Latest stable |
| **Anchor** | 0.30.1 | Token-2022 support |
| **anchor-lang** | 0.30.1 | Core framework |
| **anchor-spl** | 0.30.1 | SPL token integration |

### Application Layer

| Component | Version | Notes |
|-----------|---------|-------|
| **Node.js** | 20.x LTS | Long-term support |
| **TypeScript** | 5.3.x | Latest stable |
| **pnpm** | 8.x | Package manager |
| **Turborepo** | 1.11.x | Monorepo build |

### Telegram Bot Stack

| Library | Version | Purpose |
|---------|---------|---------|
| **telegraf** | ^4.15.0 | Telegram bot framework |
| **@solana/web3.js** | ^1.89.0 | Solana SDK |
| **@coral-xyz/anchor** | ^0.30.1 | Anchor client |
| **ioredis** | ^5.3.0 | Redis for sessions |
| **bs58** | ^5.0.0 | Base58 encoding |

### Dev Tools

| Tool | Purpose |
|------|---------|
| **Trident** | Fuzz testing |
| **Bankrun** | Fast program tests |
| **ts-mocha** | TS test runner |
| **cargo-audit** | Dependency scanning |

---

## 3. Smart Contract Design

### 3.1 Program Structure (Monolitico)

```
programs/pokedex/src/
├── lib.rs                 # Entry point con declare_id! e #[program]
├── constants.rs           # Costanti del protocollo
├── errors.rs              # Custom error codes
├── events.rs              # Event definitions
├── state/
│   ├── mod.rs
│   ├── global_config.rs   # Configurazione globale protocollo
│   └── bonding_curve.rs   # Stato bonding curve per token
└── instructions/
    ├── mod.rs
    ├── initialize.rs      # Setup protocollo (admin only)
    ├── create_token.rs    # Crea nuovo token Pokemon
    ├── buy.rs             # Acquista token dalla curva
    ├── sell.rs            # Vendi token alla curva
    ├── withdraw_fees.rs   # Ritira fee (admin only)
    └── graduate.rs        # Migra a DEX (permissionless)
```

### 3.2 Account Structures

#### GlobalConfig PDA

```rust
/// PDA: seeds = ["global_config"]
#[account]
pub struct GlobalConfig {
    pub version: u8,                     // Migration version
    pub admin: Pubkey,                   // Protocol admin (multisig)
    pub fee_recipient: Pubkey,           // Fee collection address
    pub creation_fee_lamports: u64,      // Token creation fee (0.02 SOL)
    pub trading_fee_bps: u16,            // Trading fee (100 = 1%)
    pub graduation_threshold: u64,       // SOL threshold (85 SOL)
    pub total_tokens_created: u64,       // Counter
    pub total_volume_sol: u64,           // Total trading volume
    pub paused: bool,                    // Emergency pause
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl GlobalConfig {
    pub const SIZE: usize = 8 + 1 + 32 + 32 + 8 + 2 + 8 + 8 + 8 + 1 + 1 + 64;
    pub const SEED: &'static [u8] = b"global_config";
}
```

#### BondingCurve PDA

```rust
/// PDA: seeds = ["bonding_curve", mint.key()]
#[account]
pub struct BondingCurve {
    pub version: u8,
    pub mint: Pubkey,                    // Token mint address
    pub creator: Pubkey,                 // Token creator
    pub virtual_token_reserves: u64,     // Virtual (1,073,000,000,000,000)
    pub virtual_sol_reserves: u64,       // Virtual (30 SOL in lamports)
    pub real_token_reserves: u64,        // Actual tokens in curve
    pub real_sol_reserves: u64,          // Actual SOL collected
    pub token_total_supply: u64,         // Always 1B with 6 decimals
    pub complete: bool,                  // Graduated flag
    pub created_at: i64,                 // Creation timestamp
    pub graduated_at: i64,               // Graduation timestamp (0 if not)
    pub pokedex_number: u16,             // Pokemon ID (1-1025+)
    pub pokemon_type: u8,                // Primary type enum
    pub rarity: u8,                      // Rarity tier
    pub bump: u8,
    pub _reserved: [u8; 32],
}

impl BondingCurve {
    pub const SIZE: usize = 8 + 1 + 32 + 32 + 8*5 + 1 + 8*2 + 2 + 1 + 1 + 1 + 32;
    pub const SEED_PREFIX: &'static [u8] = b"bonding_curve";
}
```

### 3.3 Instructions Overview

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize` | Admin | One-time protocol setup |
| `create_token` | User | Create Pokemon token with metadata |
| `buy` | User | Buy tokens with SOL |
| `sell` | User | Sell tokens for SOL |
| `withdraw_fees` | Admin | Withdraw accumulated fees |
| `graduate` | Anyone | Migrate to DEX (permissionless) |

### 3.4 PDA Derivations

```rust
// Global Config
let (global_config, bump) = Pubkey::find_program_address(
    &[b"global_config"],
    &program_id
);

// Bonding Curve
let (bonding_curve, bump) = Pubkey::find_program_address(
    &[b"bonding_curve", mint.key().as_ref()],
    &program_id
);

// Token Vault (holds tokens for sale)
let (token_vault, bump) = Pubkey::find_program_address(
    &[b"token_vault", mint.key().as_ref()],
    &program_id
);

// SOL Vault (holds collected SOL)
let (sol_vault, bump) = Pubkey::find_program_address(
    &[b"sol_vault", mint.key().as_ref()],
    &program_id
);
```

---

## 4. Bonding Curve Specification

### 4.1 Core Formula: Constant Product AMM

```
x * y = k (invariante)

Dove:
x = virtual_sol_reserves
y = virtual_token_reserves
k = costante
```

### 4.2 Initial Parameters (Pump.fun Compatible)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Virtual SOL Reserves | 30,000,000,000 lamports | 30 SOL |
| Virtual Token Reserves | 1,073,000,000,000,000 | ~1.073T base units |
| Real Token Reserves | 793,100,000,000,000 | ~793.1B tradable |
| Initial k | 32,190,000,000,000,000,000,000,000 | 30 SOL * 1.073T |
| Token Decimals | 6 | Standard memecoin |
| Initial Price | ~0.0000000279 SOL/token | |

### 4.3 Buy Formula

```rust
pub fn calculate_buy_tokens(
    virtual_sol_reserves: u64,
    virtual_token_reserves: u64,
    sol_amount: u64,
    fee_bps: u16,
) -> Result<u64> {
    // Apply fee
    let sol_after_fee = (sol_amount as u128)
        .checked_mul((10_000 - fee_bps) as u128)?
        .checked_div(10_000)?;

    // k = x * y
    let k = (virtual_sol_reserves as u128)
        .checked_mul(virtual_token_reserves as u128)?;

    // new_sol_reserves = current + input
    let new_virtual_sol = (virtual_sol_reserves as u128)
        .checked_add(sol_after_fee)?;

    // new_token_reserves = k / new_sol_reserves
    let new_virtual_tokens = k.checked_div(new_virtual_sol)?;

    // tokens_out = old_tokens - new_tokens
    let tokens_out = (virtual_token_reserves as u128)
        .checked_sub(new_virtual_tokens)? as u64;

    Ok(tokens_out)
}
```

### 4.4 Sell Formula

```rust
pub fn calculate_sell_sol(
    virtual_sol_reserves: u64,
    virtual_token_reserves: u64,
    token_amount: u64,
    fee_bps: u16,
) -> Result<u64> {
    // k = x * y
    let k = (virtual_sol_reserves as u128)
        .checked_mul(virtual_token_reserves as u128)?;

    // new_token_reserves = current + input
    let new_virtual_tokens = (virtual_token_reserves as u128)
        .checked_add(token_amount as u128)?;

    // new_sol_reserves = k / new_token_reserves
    let new_virtual_sol = k.checked_div(new_virtual_tokens)?;

    // sol_out_before_fee = old_sol - new_sol
    let sol_out_before_fee = (virtual_sol_reserves as u128)
        .checked_sub(new_virtual_sol)?;

    // Apply fee
    let sol_out = sol_out_before_fee
        .checked_mul((10_000 - fee_bps) as u128)?
        .checked_div(10_000)? as u64;

    Ok(sol_out)
}
```

### 4.5 Graduation Trigger

```rust
// Graduation occurs when real_token_reserves reaches 0
pub fn check_graduation(curve: &BondingCurve) -> bool {
    curve.real_token_reserves == 0 &&
    curve.real_sol_reserves >= GRADUATION_THRESHOLD
}

// Threshold: ~85 SOL raised
pub const GRADUATION_THRESHOLD: u64 = 85_000_000_000; // lamports
```

---

## 5. Token Economics

### 5.1 Supply Model

```
Total Supply: 1,000,000,000 tokens (6 decimals)
├── Bonding Curve: 793,100,000 tokens (79.31%)
│   └── Available for purchase
├── DEX Liquidity: 206,900,000 tokens (20.69%)
│   └── Reserved for graduation pool
└── Dev/Team: 0 tokens (0%)
    └── Fair launch - no pre-mine
```

### 5.2 Fee Structure

| Fee Type | Amount | Recipient |
|----------|--------|-----------|
| Creation Fee | 0.02 SOL | Protocol Treasury |
| Trading Fee (Buy) | 1% | Protocol Treasury |
| Trading Fee (Sell) | 1% | Protocol Treasury |
| Migration Fee | 6 SOL | Protocol Treasury |

### 5.3 Pokemon Rarity Tiers

| Rarity | Creation Fee | Examples |
|--------|--------------|----------|
| Common | 0.02 SOL | Pidgey, Rattata |
| Uncommon | 0.03 SOL | Pikachu, Eevee |
| Rare | 0.04 SOL | Gyarados, Dragonite |
| Legendary | 0.10 SOL | Mewtwo, Rayquaza |
| Mythical | 0.20 SOL | Mew, Arceus |

### 5.4 Metadata Schema (Off-chain JSON)

```json
{
  "name": "Pikachu Token",
  "symbol": "PIKA",
  "description": "Electric-type Pokemon, Generation 1",
  "image": "ipfs://QmX.../pikachu.png",
  "attributes": [
    { "trait_type": "Pokemon Type", "value": "Electric" },
    { "trait_type": "Generation", "value": 1 },
    { "trait_type": "Rarity", "value": "Uncommon" },
    { "trait_type": "Pokedex Number", "value": 25 }
  ],
  "pokemon_stats": {
    "hp": 35, "attack": 55, "defense": 40,
    "special_attack": 50, "special_defense": 50, "speed": 90
  }
}
```

---

## 6. Telegram Bot Architecture

### 6.1 Command Structure

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Welcome + wallet setup | `/start` |
| `/wallet` | Show wallet info | `/wallet` |
| `/deposit` | Get deposit address | `/deposit` |
| `/create` | Create Pokemon token | `/create Pikachu PIKA` |
| `/buy` | Buy tokens | `/buy PIKA 1` (1 SOL) |
| `/sell` | Sell tokens | `/sell PIKA 50%` |
| `/portfolio` | View holdings | `/portfolio` |
| `/trending` | Trending tokens | `/trending` |
| `/help` | Help menu | `/help` |

### 6.2 Bot Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TELEGRAM BOT FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Message ──► Telegraf Middleware ──► Rate Limiter          │
│                          │                                       │
│                          ▼                                       │
│                   Command Router                                 │
│                          │                                       │
│         ┌────────────────┼────────────────┐                     │
│         ▼                ▼                ▼                     │
│    /start           /buy, /sell      /create                    │
│    /wallet          /portfolio       /trending                  │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│   Wallet Service    Trading Service   Token Service             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                       │
│                    SDK Client                                    │
│                          │                                       │
│                          ▼                                       │
│                   Solana Blockchain                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Wallet Management (Semi-Custodial)

```typescript
// Wallet generation per user
interface UserWallet {
  telegramId: number;
  publicKey: string;
  encryptedPrivateKey: string;  // AES-256 encrypted
  createdAt: Date;
}

// Encryption with user-specific key
const encryptionKey = deriveKey(process.env.MASTER_KEY, telegramId);
const encryptedKey = encrypt(privateKeyBytes, encryptionKey);
```

### 6.4 Database Schema (Redis)

```
# User Session
user:{telegramId} -> {
  wallet: string,
  settings: { slippage: number, priority: string },
  lastActivity: timestamp
}

# Pending Transaction
tx:{txId} -> {
  userId: number,
  type: "buy" | "sell" | "create",
  status: "pending" | "confirmed" | "failed",
  signature: string,
  createdAt: timestamp
}

# Token Cache
token:{mint} -> {
  name: string,
  symbol: string,
  price: number,
  volume24h: number,
  updatedAt: timestamp
}
```

---

## 7. SDK Integration Layer

### 7.1 Package Structure

```
@pokedex/sdk/
├── src/
│   ├── index.ts              # Public exports
│   ├── client.ts             # PokeDEXClient main class
│   ├── instructions/
│   │   ├── createToken.ts
│   │   ├── buy.ts
│   │   ├── sell.ts
│   │   └── graduate.ts
│   ├── accounts/
│   │   ├── globalConfig.ts
│   │   └── bondingCurve.ts
│   ├── utils/
│   │   ├── pda.ts            # PDA derivations
│   │   └── math.ts           # Curve calculations
│   └── constants.ts          # Program ID, seeds
└── package.json
```

### 7.2 Client Interface

```typescript
interface PokeDEXClient {
  // Read operations
  getGlobalConfig(): Promise<GlobalConfig>;
  getBondingCurve(mint: PublicKey): Promise<BondingCurve>;
  getTokenPrice(mint: PublicKey): Promise<number>;

  // Write operations
  createToken(params: CreateTokenParams): Promise<TransactionResult>;
  buy(params: BuyParams): Promise<TransactionResult>;
  sell(params: SellParams): Promise<TransactionResult>;

  // Utility
  calculateBuyAmount(solAmount: number, curve: BondingCurve): number;
  calculateSellAmount(tokenAmount: number, curve: BondingCurve): number;
}
```

### 7.3 RPC Strategy

| Provider | Use Case | Priority |
|----------|----------|----------|
| Helius | Primary | 1 |
| Triton | Secondary | 2 |
| QuickNode | Tertiary | 3 |
| Public RPC | Emergency | 4 |

### 7.4 Error Handling

```typescript
// Custom error codes mapping
const ERROR_CODES = {
  6000: { code: 'PAUSED', message: 'Protocol is paused', retryable: false },
  6001: { code: 'SLIPPAGE', message: 'Slippage exceeded', retryable: true },
  6002: { code: 'INSUFFICIENT_SOL', message: 'Not enough SOL', retryable: false },
  6003: { code: 'ALREADY_GRADUATED', message: 'Token already graduated', retryable: false },
  6004: { code: 'OVERFLOW', message: 'Arithmetic overflow', retryable: false },
};
```

---

## 8. Security Framework

### 8.1 Sealevel Attack Mitigations

| Attack Vector | Mitigation | Implementation |
|---------------|------------|----------------|
| #0 Signer Authorization | `Signer<'info>` | All privileged ops |
| #1 Account Data Matching | `has_one` constraint | Relationship validation |
| #2 Owner Checks | `Account<'info, T>` | Automatic via Anchor |
| #3 Type Cosplay | Discriminator | 8-byte automatic |
| #4 Initialization | `init` constraint | Prevent re-init |
| #5 Arbitrary CPI | `Program<'info, T>` | Hardcoded program IDs |
| #6 Duplicate Mutable | `key() != key()` | Explicit constraint |
| #7 Bump Seed | Store in account | Use saved bump |
| #8 PDA Sharing | Domain-specific seeds | Unique per context |
| #9 Closing Accounts | `close` constraint | Proper cleanup |

### 8.2 Arithmetic Safety

```rust
// ALWAYS use checked operations
let result = a.checked_add(b).ok_or(ErrorCode::Overflow)?;
let result = a.checked_sub(b).ok_or(ErrorCode::Underflow)?;
let result = a.checked_mul(b).ok_or(ErrorCode::Overflow)?;
let result = a.checked_div(b).ok_or(ErrorCode::DivisionByZero)?;

// Use u128 for intermediate calculations
let product = (a as u128).checked_mul(b as u128)?;
```

### 8.3 Access Control

```rust
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        has_one = admin @ ErrorCode::Unauthorized,
        constraint = !global_config.paused @ ErrorCode::ProtocolPaused,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,
}
```

### 8.4 Emergency Mechanisms

```rust
// Granular pause control
pub struct GlobalConfig {
    pub paused: bool,           // Global pause
    pub create_paused: bool,    // Pause creation only
    pub trade_paused: bool,     // Pause trading only
}

// Emergency pause (admin only)
pub fn emergency_pause(ctx: Context<AdminOnly>) -> Result<()> {
    ctx.accounts.global_config.paused = true;
    emit!(ProtocolPaused { timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}
```

### 8.5 Pre-Audit Checklist

- [ ] All `checked_*` arithmetic operations
- [ ] Account owner checks via Anchor
- [ ] PDA seeds properly validated
- [ ] No hardcoded sensitive addresses
- [ ] Slippage protection enforced
- [ ] Reentrancy protection (CEI pattern)
- [ ] CPI account reload after calls
- [ ] Emergency pause functionality
- [ ] Event emission for all state changes
- [ ] Multi-sig for admin operations

---

## 9. Development Phases

### Phase 1: Core Smart Contract (2 weeks)

**Deliverables:**
- GlobalConfig account and initialization
- BondingCurve account structure
- Create token instruction
- Buy/Sell instructions with curve math
- Progress tracking
- Unit tests (>90% coverage)

**Acceptance Criteria:**
- [ ] Protocol initializes correctly
- [ ] Token creation mints correct supply
- [ ] Buy increases token balance
- [ ] Sell decreases token balance
- [ ] Slippage protection works
- [ ] All tests pass

### Phase 2: Graduation & DEX Integration (2 weeks)

**Deliverables:**
- Graduation trigger logic
- Raydium pool creation CPI
- LP token burn mechanism
- Authority revocation
- Fee withdrawal instruction

**Acceptance Criteria:**
- [ ] Graduation triggers at 85 SOL
- [ ] Pool created on Raydium
- [ ] LP tokens burned
- [ ] Mint authority revoked
- [ ] Fees withdrawable

### Phase 3: Telegram Bot MVP (2 weeks)

**Deliverables:**
- Bot framework setup (Telegraf)
- Wallet generation and encryption
- Core commands (/start, /wallet, /buy, /sell)
- Transaction confirmation flow
- Redis session management

**Acceptance Criteria:**
- [ ] Bot responds to all commands
- [ ] Wallet creation works
- [ ] Buy/Sell executes correctly
- [ ] Transaction status shown
- [ ] Rate limiting active

### Phase 4: Integration & Testing (2 weeks)

**Deliverables:**
- End-to-end integration tests
- Fuzz testing with Trident (1M+ iterations)
- Security test suite
- Devnet deployment
- Beta testing program

**Acceptance Criteria:**
- [ ] All integration tests pass
- [ ] Fuzz tests: 0 crashes
- [ ] Security tests pass
- [ ] Devnet deployment successful
- [ ] Beta feedback incorporated

### Phase 5: Security & Hardening (2-3 weeks)

**Deliverables:**
- Internal security audit
- External audit (OtterSec/Neodyme)
- Bug bounty program
- Monitoring setup
- Mainnet preparation

**Acceptance Criteria:**
- [ ] All critical/high findings fixed
- [ ] Bug bounty active
- [ ] Monitoring operational
- [ ] Multi-sig configured
- [ ] Incident response documented

### Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1 | 2 weeks | Week 2 |
| Phase 2 | 2 weeks | Week 4 |
| Phase 3 | 2 weeks | Week 6 |
| Phase 4 | 2 weeks | Week 8 |
| Phase 5 | 2-3 weeks | Week 10-11 |
| **Total** | **10-11 weeks** | |

---

## 10. Testing Strategy

### 10.1 Test Categories

| Category | Framework | Coverage Target |
|----------|-----------|-----------------|
| Unit Tests | Cargo test | >90% |
| Integration | ts-mocha | >85% |
| Security | Custom | 100% of vulnerabilities |
| Fuzz | Trident | 1M+ iterations |
| E2E Bot | Mock Telegram | All user flows |

### 10.2 Critical Invariants

```rust
// INV-001: k = x * y (constant product)
// INV-002: real_sol_reserves <= accumulated_sol - withdrawn_fees
// INV-003: real_token_reserves <= initial_real_reserves
// INV-004: total_supply never changes after creation
// INV-005: complete flag never reverts to false
// INV-006: price always increases on consecutive buys
```

### 10.3 Security Test Scenarios

```rust
#[test]
fn test_prevent_reentrancy() { ... }

#[test]
fn test_overflow_protection() { ... }

#[test]
fn test_unauthorized_admin_access() { ... }

#[test]
fn test_slippage_protection() { ... }

#[test]
fn test_double_graduation() { ... }

#[test]
fn test_drain_attack() { ... }
```

### 10.4 Fuzz Test Structure

```rust
#[derive(Arbitrary, Debug)]
pub struct FuzzInput {
    pub sol_amount: u64,
    pub token_amount: u64,
    pub action: Action,
}

#[derive(Arbitrary, Debug)]
pub enum Action {
    Buy,
    Sell,
    CreateToken,
}
```

---

## 11. Deployment Checklist

### Pre-Deployment

- [ ] All phases completed
- [ ] External audit completed
- [ ] All critical/high findings fixed
- [ ] Bug bounty program active ($50K+ pool)
- [ ] Multi-sig configured (3/5 threshold)
- [ ] Upgrade authority = multi-sig
- [ ] Emergency contacts established
- [ ] Incident response plan documented

### Devnet Deployment

```bash
# Build
anchor build --verifiable

# Deploy to devnet
solana config set --url devnet
anchor deploy --provider.cluster devnet

# Verify
solana program show <PROGRAM_ID>
```

### Mainnet Deployment

```bash
# Deploy to mainnet
solana config set --url mainnet-beta
anchor deploy --provider.cluster mainnet

# Transfer upgrade authority to multi-sig
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <MULTISIG_ADDRESS>

# Initialize protocol
anchor run initialize -- --admin <MULTISIG>
```

### Post-Deployment

- [ ] Verify program on-chain
- [ ] Initialize GlobalConfig
- [ ] Test with small amounts
- [ ] Enable monitoring alerts
- [ ] Announce launch
- [ ] Begin phased rollout

---

## Appendix A: Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | ProtocolPaused | Protocol is paused |
| 6001 | Unauthorized | Not authorized for this action |
| 6002 | SlippageExceeded | Slippage tolerance exceeded |
| 6003 | InsufficientBalance | Insufficient token/SOL balance |
| 6004 | AlreadyGraduated | Token already graduated |
| 6005 | NotReadyForGraduation | Threshold not reached |
| 6006 | ArithmeticOverflow | Math overflow |
| 6007 | ArithmeticUnderflow | Math underflow |
| 6008 | DivisionByZero | Division by zero |
| 6009 | InvalidPokemonType | Unknown Pokemon type |
| 6010 | InvalidRarity | Unknown rarity tier |

---

## Appendix B: Constants

```rust
pub mod constants {
    // Supply
    pub const TOKEN_TOTAL_SUPPLY: u64 = 1_000_000_000_000_000; // 1B with 6 decimals
    pub const TOKEN_DECIMALS: u8 = 6;

    // Bonding Curve Initial Values
    pub const INITIAL_VIRTUAL_TOKEN_RESERVES: u64 = 1_073_000_000_000_000;
    pub const INITIAL_VIRTUAL_SOL_RESERVES: u64 = 30_000_000_000; // 30 SOL
    pub const INITIAL_REAL_TOKEN_RESERVES: u64 = 793_100_000_000_000;

    // Fees
    pub const CREATION_FEE_LAMPORTS: u64 = 20_000_000; // 0.02 SOL
    pub const TRADING_FEE_BPS: u16 = 100; // 1%
    pub const MIGRATION_FEE_LAMPORTS: u64 = 6_000_000_000; // 6 SOL

    // Thresholds
    pub const GRADUATION_THRESHOLD_LAMPORTS: u64 = 85_000_000_000; // 85 SOL

    // Basis Points
    pub const BPS_DENOMINATOR: u64 = 10_000;
}
```

---

## Appendix C: References

### Documentation Sources

- [Pump.fun Bonding Curve Analysis](https://medium.com/@buildwithbhavya/the-math-behind-pump-fun-b58fdb30ed77)
- [Anchor Framework Documentation](https://www.anchor-lang.com/docs)
- [Solana Program Security Guide](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)
- [Token Metadata Standard](https://developers.metaplex.com/token-metadata)
- [Raydium SDK Documentation](https://docs.raydium.io/)

### Security References

- [Sealevel Attacks](https://github.com/coral-xyz/sealevel-attacks)
- [Solana Security Best Practices](https://github.com/slowmist/solana-smart-contract-security-best-practices)
- [OtterSec Audit Checklist](https://osec.io/)

### Code References (from DeFi-101)

- `/1.DeFi-101/Mashroom_Implementation/` - Anchor patterns
- `/1.DeFi-101/Treasury_Claim_Implementation/` - Fee handling
- `/1.DeFi-101/Deep_Research/04_best_practices/` - Security patterns

---

*Document generated by 25-agent deep analysis system*
*Last updated: 24 Gennaio 2026*
