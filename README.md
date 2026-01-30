# PokeDEX

A decentralized Pokemon trading card game built on Ethereum with NFT cards, gacha pack openings, and PvP battles.

## Overview

PokeDEX is a blockchain-based collectible card game featuring:

- **ERC-721 NFT Cards** - Unique Pokemon cards with stats, types, and rarity levels
- **Gacha Pack System** - Open card packs with verifiable randomness via Chainlink VRF
- **PvP Battle Arena** - Challenge other players with type advantages and stat calculations
- **Experience System** - Cards gain XP from battles, increasing their battle power

## Smart Contracts

| Contract | Description |
|----------|-------------|
| `PokeDEXCard` | ERC-721 NFT contract for Pokemon cards with stats (HP, Attack, Defense, Speed) |
| `CardPack` | Pack purchase and opening with Chainlink VRF v2.5 for provably fair randomness |
| `BattleArena` | PvP battle system with type effectiveness chart and leaderboards |

## Features

### Card System
- 18 Pokemon types (Fire, Water, Grass, Electric, etc.)
- 5 rarity levels: Common, Uncommon, Rare, Ultra Rare, Legendary
- Stats: HP, Attack, Defense, Speed (0-255)
- Experience system with battle power calculations
- Generations 1-9 supported

### Pack Types
| Pack | Cards | Price | Rarity Boost |
|------|-------|-------|--------------|
| Basic | 3 | 0.01 ETH | Standard rates |
| Premium | 5 | 0.025 ETH | Standard rates |
| Legendary | 10 | 0.05 ETH | Standard rates |

### Rarity Distribution
- Common: 60%
- Uncommon: 25%
- Rare: 10%
- Ultra Rare: 4%
- Legendary: 1%

### Battle System
- Turn-based PvP battles
- Full Pokemon type effectiveness chart
- Battle power = weighted stats + rarity multiplier + experience bonus
- Winner earns 100 XP, loser earns 25 XP
- Global leaderboard (top 100 players)

## Tech Stack

- **Solidity** ^0.8.20
- **Hardhat** v3.x with Viem
- **OpenZeppelin** Contracts v5
- **Chainlink VRF** v2.5

## Prerequisites

- Node.js v18+
- pnpm (recommended) or npm

## Installation

1. Clone the repository:
```bash
git clone https://github.com/DvinHartoonian/PokeDex.git
cd PokeDex
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

## Usage

### Compile Contracts
```bash
npx hardhat compile
```

### Run Tests
```bash
# Run all tests
npx hardhat test

# Run with gas reporting
REPORT_GAS=true npx hardhat test
```

### Local Development
```bash
# Start local node
npx hardhat node

# Deploy to local network
npx hardhat ignition deploy ignition/modules/PokeDEX.ts --network localhost
```

### Deploy to Testnet (Sepolia)

1. Set your private key:
```bash
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

2. Set RPC URL:
```bash
npx hardhat keystore set SEPOLIA_RPC_URL
```

3. Deploy:
```bash
npx hardhat ignition deploy ignition/modules/PokeDEX.ts --network sepolia
```

## Project Structure

```
PokeDEX/
├── contracts/
│   ├── PokeDEXCard.sol      # NFT card contract
│   ├── CardPack.sol         # Pack opening with VRF
│   ├── BattleArena.sol      # PvP battle system
│   ├── interfaces/          # Contract interfaces
│   └── test/                # Mock contracts for testing
├── scripts/
│   ├── deploy.ts            # Deployment script
│   └── verify.ts            # Contract verification
├── test/
│   ├── PokeDEXCard.test.ts
│   ├── CardPack.test.ts
│   └── BattleArena.test.ts
└── hardhat.config.ts
```

## Contract Roles

### PokeDEXCard
- `DEFAULT_ADMIN_ROLE` - Pause/unpause, manage roles
- `MINTER_ROLE` - Mint new cards (granted to CardPack)
- `STATS_UPDATER_ROLE` - Update card experience (granted to BattleArena)

### CardPack
- `DEFAULT_ADMIN_ROLE` - Pause/unpause, withdraw funds
- `CONFIG_ROLE` - Set pack prices, URIs, VRF settings

### BattleArena
- `DEFAULT_ADMIN_ROLE` - Pause/unpause, set timeout
- `REWARDS_ROLE` - Configure experience rewards

## Security

- ReentrancyGuard on all state-changing functions
- Pausable for emergency stops
- Access control with OpenZeppelin roles
- CEI (Checks-Effects-Interactions) pattern
- Input validation on all parameters

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
