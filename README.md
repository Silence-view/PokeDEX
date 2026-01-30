# PokeDEX - Blockchain Trading Card Game

A decentralized Pokemon-style trading card game built on Ethereum with NFT cards, battle arena, marketplace, and Telegram bot integration.

[![Security Audit](https://img.shields.io/badge/Security-Audited-green.svg)](./SECURITY_AUDIT_REPORT.md)
[![Tests](https://img.shields.io/badge/Tests-15%2F15%20Passing-brightgreen.svg)](#testing)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-blue.svg)](https://soliditylang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Features

- **NFT Trading Cards** - ERC-721 cards with on-chain stats (HP, Attack, Defense, Speed)
- **Battle Arena** - PvP battles with betting system (0.001-10 ETH) and experience rewards
- **Marketplace** - List, buy, and sell cards with royalties and fee system
- **Card Packs** - Random card generation using API3 QRNG for provable fairness
- **Telegram Bot** - Full-featured bot with custodial wallets for seamless onboarding

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Telegram Bot   │────▶│   Smart         │────▶│   Blockchain    │
│  (Grammy.js)    │     │   Contracts     │     │   (Sepolia)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Custodial      │     │   IPFS/Pinata   │
│  Wallets        │     │   (Metadata)    │
└─────────────────┘     └─────────────────┘
```

## Smart Contracts

| Contract | Description | Security Features |
|----------|-------------|-------------------|
| `PokeDEXCard.sol` | ERC-721 NFT with battle stats, experience, trade tracking | Overflow protection, input validation, two-step admin |
| `BattleArena.sol` | PvP battle system with betting, 5% platform fee | ReentrancyGuard, CEI pattern, pagination |
| `PokeDEXMarketplace.sol` | NFT marketplace with listings, offers, royalties | Min listing duration, ERC721 validation |
| `CardPack.sol` | Random card pack opening with API3 QRNG | Timeout refunds, request tracking |

### Card System

- **18 Pokemon Types**: Fire, Water, Grass, Electric, Ice, Fighting, Poison, Ground, Flying, Psychic, Bug, Rock, Ghost, Dragon, Dark, Steel, Fairy, Normal
- **5 Rarity Levels**: Common (60%), Uncommon (25%), Rare (10%), Ultra Rare (4%), Legendary (1%)
- **Stats**: HP, Attack, Defense, Speed (0-255 range, validated)
- **Experience System**: Cards gain XP from battles
- **Trade Tracking**: Overflow-protected counter up to 4.2B trades

### Battle Power Formula

```
BattlePower = (HP + Attack + Defense + Speed) × RarityMultiplier
            + TradeCount × 10
            + LastSalePrice / 0.01 ETH
            + RandomFactor
```

### Pack Types

| Pack | Cards | Price | Description |
|------|-------|-------|-------------|
| Basic | 3 | 0.01 ETH | Standard rates |
| Premium | 5 | 0.025 ETH | Better odds |
| Legendary | 10 | 0.05 ETH | Best value |

**Note**: Max 50 cards per pack. QRNG requests have 1-hour timeout with automatic refund capability.

## Tech Stack

- **Blockchain**: Solidity 0.8.28, Hardhat, OpenZeppelin 5.x
- **Backend**: TypeScript, Node.js 18+
- **Bot Framework**: Grammy.js (Telegram)
- **Storage**: IPFS via Pinata
- **Randomness**: API3 QRNG (Airnode)
- **Encryption**: AES-256-GCM, PBKDF2

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/Silence-view/PokeDEX.git
cd PokeDEX

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
```

### Environment Configuration

```env
# Blockchain
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
SEPOLIA_PRIVATE_KEY=your_deployer_private_key

# Telegram Bot
BOT_TOKEN=your_telegram_bot_token

# Pinata (IPFS)
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_KEY=your_pinata_secret_key

# Wallet Encryption
WALLET_MASTER_KEY=your_secure_random_key_32_chars
```

### Development

```bash
# Compile contracts
pnpm run compile

# Run tests (15 tests)
pnpm test

# Run with gas reporting
REPORT_GAS=true pnpm test

# Deploy to Sepolia
pnpm run deploy:sepolia

# Start Telegram bot
pnpm run bot
```

## Project Structure

```
PokeDEX/
├── contracts/                    # Solidity smart contracts
│   ├── PokeDEXCard.sol          # NFT card contract
│   ├── BattleArena.sol          # PvP battle system
│   ├── PokeDEXMarketplace.sol   # Marketplace
│   ├── CardPack.sol             # Pack opening with QRNG
│   └── interfaces/              # Contract interfaces
│       ├── IPokeDEXCard.sol
│       ├── IBattleArena.sol
│       ├── ICardPack.sol
│       └── IPokeDEXMarketplace.sol
├── telegram/                     # Telegram bot
│   ├── bot.ts                   # Main bot logic
│   ├── storage/                 # Session management
│   └── wallet/                  # Custodial wallet system
├── test/                        # Contract tests
├── scripts/                     # Deployment scripts
├── hardhat.config.cjs           # Hardhat configuration
├── SECURITY_AUDIT_REPORT.md     # Security audit results
└── LICENSE                      # MIT License
```

## Contract Roles & Admin Transfer

All contracts implement a **two-step admin transfer** pattern to prevent accidental loss of admin access:

```solidity
// Step 1: Current admin initiates transfer
initiateAdminTransfer(newAdmin)

// Step 2: New admin accepts (or current admin cancels)
acceptAdminTransfer()  // Called by new admin
cancelAdminTransfer()  // Called by current admin to cancel
```

| Role | Contract | Permissions |
|------|----------|-------------|
| `DEFAULT_ADMIN_ROLE` | All | Pause, manage roles, emergency functions |
| `MINTER_ROLE` | PokeDEXCard | Mint new cards |
| `STATS_UPDATER_ROLE` | PokeDEXCard | Update card experience |
| `MARKETPLACE_ROLE` | PokeDEXCard | Update trade metrics |
| `CONFIG_ROLE` | CardPack | Set prices, URIs |
| `FEE_MANAGER_ROLE` | Marketplace | Adjust fees |

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot and create wallet |
| `/wallet` | View balance, deposit, withdraw |
| `/create` | Start card creation wizard |
| `/mycards` | View your NFT collection |
| `/market` | Browse and buy cards |
| `/battle` | Challenge other players |
| `/help` | Show all commands |

## Security

This project has undergone a **comprehensive security audit** with all fixable vulnerabilities addressed. See [SECURITY_AUDIT_REPORT.md](./SECURITY_AUDIT_REPORT.md) for full details.

### Smart Contract Security

| Feature | Implementation |
|---------|----------------|
| **Reentrancy Protection** | `ReentrancyGuard` on all ETH-transferring functions |
| **CEI Pattern** | Checks-Effects-Interactions strictly enforced |
| **Overflow Protection** | SafeMath via Solidity 0.8+, explicit bounds checks |
| **Input Validation** | Zero address checks, price validation, bounds checking |
| **Access Control** | Role-based with OpenZeppelin AccessControl |
| **Two-Step Admin** | Prevents accidental admin transfer |
| **Pausable** | Emergency stop functionality |
| **Event Logging** | Comprehensive events for off-chain tracking |

### Contract-Specific Security

#### PokeDEXCard.sol
- Trade count overflow protection (`MAX_TRADE_COUNT = 4,294,967,294`)
- Stats validation (0-255 range enforced)
- Zero address minting prevention

#### BattleArena.sol
- `nonReentrant` on: `createChallenge`, `acceptChallenge`, `cancelChallenge`, `withdrawFees`
- Self-challenge prevention
- Card ownership verification
- Pagination for `getActiveBattles()` (prevents DoS)

#### PokeDEXMarketplace.sol
- Minimum listing duration: 1 hour (prevents manipulation)
- ERC721 interface validation
- Fee recipient cannot be zero address
- Price must be > 0

#### CardPack.sol
- **QRNG Timeout**: 1-hour timeout with automatic refund
- `refundTimedOutRequest()` for stuck requests
- `isRequestTimedOut()` helper for frontend
- Max 50 cards per pack

### Telegram Bot Security

| Feature | Implementation |
|---------|----------------|
| **Encryption** | AES-256-GCM with authentication tags |
| **Key Derivation** | PBKDF2 (100,000 iterations, SHA-512) |
| **Unique Keys** | Salt per wallet, IV per operation |
| **Rate Limiting** | 3 attempts/min for key export, 5 min cooldown |
| **File Permissions** | 0o600 for wallet files, 0o700 for directories |
| **Path Traversal** | Wallet ID sanitization (alphanumeric only) |
| **Auto-Delete** | Sensitive messages deleted after 30-60 seconds |

### Known Trade-offs (Documented)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Custodial wallets | Critical | Users can export keys anytime for self-custody |
| On-chain randomness | Critical | Betting limits (0.001-10 ETH) make manipulation unprofitable |
| Front-running | High | Challenge requires specific opponent address |
| Centralization | High | Two-step admin transfer, consider multisig |

## Testing

```bash
# All tests
pnpm test

# Specific test
pnpm test test/Basic.test.cjs

# With gas reporting
REPORT_GAS=true pnpm test

# With coverage
pnpm run coverage
```

### Test Coverage

| Contract | Tests | Status |
|----------|-------|--------|
| PokeDEXCard | 4 | Passing |
| BattleArena | 6 | Passing |
| PokeDEXMarketplace | 5 | Passing |
| **Total** | **15** | **All Passing** |

### Gas Usage

| Contract | Deployment Cost | Block Limit % |
|----------|-----------------|---------------|
| BattleArena | ~5.96M gas | 9.9% |
| PokeDEXCard | ~2.96M gas | 4.9% |
| PokeDEXMarketplace | ~3.0M gas | 5.0% |

## Deployment

### Testnet (Sepolia)

```bash
pnpm run deploy:sepolia
```

### Contract Verification

```bash
npx hardhat verify --network sepolia --config hardhat.config.cjs DEPLOYED_ADDRESS
```

### Post-Deployment Checklist

1. Grant `MINTER_ROLE` to CardPack contract
2. Grant `STATS_UPDATER_ROLE` to BattleArena contract
3. Grant `MARKETPLACE_ROLE` to PokeDEXMarketplace contract
4. Configure QRNG parameters in CardPack
5. Set fee recipients
6. Consider setting up multisig for admin role

## Events Reference

### PokeDEXCard Events
- `CardMinted(uint256 indexed tokenId, address indexed to, CardStats stats)`
- `ExperienceAdded(uint256 indexed tokenId, uint32 amount, uint32 newTotal)`

### BattleArena Events
- `ChallengeCreated(uint256 indexed battleId, address indexed challenger, address indexed opponent)`
- `ChallengeAccepted(uint256 indexed battleId, address indexed opponent)`
- `BattleResult(uint256 indexed battleId, address indexed winner, uint256 winnerPower, uint256 loserPower)`
- `BetPlaced(uint256 indexed battleId, address indexed player, uint256 amount)`
- `WinningsDistributed(uint256 indexed battleId, address indexed winner, uint256 amount)`

### PokeDEXMarketplace Events
- `NFTListed(uint256 indexed listingId, address indexed seller, address indexed nftContract, uint256 tokenId, uint256 price)`
- `NFTSold(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price)`
- `ListingCancelled(uint256 indexed listingId, address indexed seller)`
- `PriceUpdated(uint256 indexed listingId, uint256 oldPrice, uint256 newPrice)`

### CardPack Events
- `PackPurchased(address indexed buyer, PackType indexed packType, bytes32 requestId)`
- `PackOpened(address indexed buyer, uint256[] cardIds)`
- `RequestRefunded(bytes32 indexed requestId, address indexed user, uint256 amount)`

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

### Code Standards

- Follow Solidity style guide
- Add Natspec documentation to all public functions
- Ensure all tests pass before PR
- Add events for state-changing operations
- Follow CEI pattern for external calls

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Authors

- **Silence-view** - Lead Developer
- **Dvin Hartoonian** - Co-Developer

## Acknowledgments

- OpenZeppelin for secure contract libraries
- API3 for QRNG implementation
- Grammy.js for Telegram bot framework
- Hardhat for development environment

---

Built with Solidity, TypeScript, and Grammy.js

**Security Audit Status**: All fixable vulnerabilities addressed. See [SECURITY_AUDIT_REPORT.md](./SECURITY_AUDIT_REPORT.md)
