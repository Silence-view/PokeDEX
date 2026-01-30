# PokeDEX - Blockchain Trading Card Game

A decentralized Pokemon-style trading card game built on Ethereum with NFT cards, battle arena, marketplace, and Telegram bot integration.

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

| Contract | Description |
|----------|-------------|
| `PokeDEXCard.sol` | ERC-721 NFT with battle stats, experience system, and trade tracking |
| `BattleArena.sol` | PvP battle system with betting, 5% platform fee |
| `PokeDEXMarketplace.sol` | NFT marketplace with listings, offers, and royalties |
| `CardPack.sol` | Random card pack opening with API3 QRNG |

### Card System

- **18 Pokemon Types**: Fire, Water, Grass, Electric, Ice, Fighting, Poison, Ground, Flying, Psychic, Bug, Rock, Ghost, Dragon, Dark, Steel, Fairy, Normal
- **5 Rarity Levels**: Common (60%), Uncommon (25%), Rare (10%), Ultra Rare (4%), Legendary (1%)
- **Stats**: HP, Attack, Defense, Speed (0-255 range)
- **Experience System**: Cards gain XP from battles

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
├── contracts/              # Solidity smart contracts
│   ├── PokeDEXCard.sol     # NFT card contract
│   ├── BattleArena.sol     # PvP battle system
│   ├── PokeDEXMarketplace.sol # Marketplace
│   ├── CardPack.sol        # Pack opening with QRNG
│   └── interfaces/         # Contract interfaces
├── telegram/               # Telegram bot
│   ├── bot.ts              # Main bot logic
│   ├── storage/            # Session management
│   └── wallet/             # Custodial wallet system
├── test/                   # Contract tests
├── scripts/                # Deployment scripts
├── hardhat.config.cjs      # Hardhat configuration
└── SECURITY_AUDIT_REPORT.md # Security audit results
```

## Contract Roles

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

This project has been audited. See [SECURITY_AUDIT_REPORT.md](./SECURITY_AUDIT_REPORT.md) for full details.

### Security Measures

- AES-256-GCM encryption for wallet storage
- PBKDF2 key derivation (100,000 iterations, SHA-512)
- Rate limiting on sensitive operations
- ReentrancyGuard on all state-changing functions
- Comprehensive input validation
- Auto-delete for sensitive messages

### Known Trade-offs (Documented)

| Risk | Mitigation |
|------|------------|
| Custodial wallets | Users can export keys anytime |
| On-chain randomness | Betting limits enforced |
| Front-running | Challenge system requires specific opponent |

## Testing

```bash
# All tests
pnpm test

# Specific test
pnpm test test/Basic.test.cjs

# With coverage
pnpm run coverage
```

**Test Results**: 15/15 passing

## Deployment

### Testnet (Sepolia)

```bash
pnpm run deploy:sepolia
```

### Contract Verification

```bash
npx hardhat verify --network sepolia --config hardhat.config.cjs DEPLOYED_ADDRESS
```

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Authors

- **Silence-view** - Lead Developer
- **Dvin Hartoonian** - Co-Developer

---

Built with Solidity, TypeScript, and Grammy.js
