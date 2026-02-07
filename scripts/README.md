# Scripts

Script di deployment e utility per gli smart contract PokeDEX, eseguiti tramite Hardhat o come script standalone.
Deployment and utility scripts for PokeDEX smart contracts, run via Hardhat or as standalone scripts.

## Panoramica / Overview

Questa directory contiene tutti gli script necessari per deployare i contratti sulla rete Sepolia, verificarli su Etherscan, generare metadati NFT e controllare la connessione alla blockchain. Gli script si dividono in due generazioni: il deploy originale (PokeDEXCard + CardPack + BattleArena con Chainlink VRF) e il deploy esteso (PokeDEXCustomCards + PokeDEXMarketplace + CardPackQRNG con API3 QRNG).

This directory contains all the scripts needed to deploy contracts on the Sepolia network, verify them on Etherscan, generate NFT metadata, and check the blockchain connection. Scripts are split into two generations: the original deploy (PokeDEXCard + CardPack + BattleArena with Chainlink VRF) and the extended deploy (PokeDEXCustomCards + PokeDEXMarketplace + CardPackQRNG with API3 QRNG).

## Ordine di Deployment / Deployment Order

```
Fase 1: Contratti base (legacy)
Step 1: Base contracts (legacy)
=================================================================
npx hardhat run scripts/deploy.ts --network sepolia

  Deploy: PokeDEXCard -> CardPack -> BattleArena
  Ruoli / Roles:
    MINTER_ROLE        --> CardPack
    STATS_UPDATER_ROLE --> BattleArena


Fase 2: Contratti estesi (piattaforma attuale)
Step 2: Extended contracts (current platform)
=================================================================
npx hardhat run scripts/deploy-new.ts --network sepolia

  Requisiti / Requires: POKEDEX_CARD_ADDRESS in .env
  Deploy: PokeDEXCustomCards -> PokeDEXMarketplace -> CardPackQRNG
  Ruoli / Roles:
    MINTER_ROLE       --> CardPackQRNG
    MARKETPLACE_ROLE  --> Marketplace
  Post-deploy: configurare parametri API3 QRNG su CardPackQRNG


Fase 3 (opzionale): Redeploy standalone di CustomCards
Step 3 (optional): Standalone CustomCards redeploy
=================================================================
npx tsx scripts/deploy-custom-cards-v2.ts

  Non usa Hardhat runtime, carica l'artifact compilato direttamente.
  Does not use Hardhat runtime, loads the compiled artifact directly.


Fase 4: Verifica su Etherscan
Step 4: Etherscan verification
=================================================================
npx hardhat run scripts/verify.ts --network sepolia

  Inserire gli indirizzi dei contratti nel file prima di eseguire.
  Edit contract addresses in the file before running.
```

## File / Files

### `deploy.ts`

Script di deployment Hardhat per i tre contratti base: **PokeDEXCard** (ERC-721), **CardPack** (pacchetti con Chainlink VRF) e **BattleArena** (battaglie PvP). Usa `ethers.getSigners()` per ottenere il deployer, deploya in sequenza, assegna MINTER_ROLE a CardPack e STATS_UPDATER_ROLE a BattleArena, e stampa un riepilogo JSON con indirizzi, configurazione VRF e timestamp. Legge la configurazione VRF (coordinator, key hash, subscription ID) da variabili d'ambiente con fallback ai valori Sepolia di default.

Hardhat deployment script for the three base contracts: **PokeDEXCard** (ERC-721), **CardPack** (packs with Chainlink VRF), and **BattleArena** (PvP battles). Uses `ethers.getSigners()` to get the deployer, deploys sequentially, grants MINTER_ROLE to CardPack and STATS_UPDATER_ROLE to BattleArena, and prints a JSON summary with addresses, VRF configuration, and timestamp. Reads VRF configuration (coordinator, key hash, subscription ID) from environment variables with Sepolia defaults as fallback.

### `deploy-new.ts`

Script di deployment Hardhat per la piattaforma estesa: **PokeDEXCustomCards** (mint di carte create dagli utenti), **PokeDEXMarketplace** (compravendita con immagini IPFS) e **CardPackQRNG** (pacchetti con randomness gratuita API3 QRNG). Richiede `POKEDEX_CARD_ADDRESS` in `.env` (i contratti base devono essere gia deployati). Assegna MINTER_ROLE a CardPackQRNG e MARKETPLACE_ROLE al Marketplace sul contratto PokeDEXCard esistente. Gestisce errori di permesso con try/catch nel caso il deployer non sia admin. Alla fine stampa gli indirizzi pronti per il copia-incolla in `.env` e le istruzioni per configurare i parametri QRNG.

Hardhat deployment script for the extended platform: **PokeDEXCustomCards** (user-created card minting), **PokeDEXMarketplace** (buy/sell with IPFS images), and **CardPackQRNG** (packs with free API3 QRNG randomness). Requires `POKEDEX_CARD_ADDRESS` in `.env` (base contracts must already be deployed). Grants MINTER_ROLE to CardPackQRNG and MARKETPLACE_ROLE to the Marketplace on the existing PokeDEXCard contract. Handles permission errors with try/catch in case the deployer is not admin. Prints addresses ready for copy-paste into `.env` and instructions for configuring QRNG parameters.

### `deploy-custom-cards-v2.ts`

Script standalone (senza runtime Hardhat) per il re-deploy di **PokeDEXCustomCards** con supporto `tokensOfOwner`. Carica il `.env` direttamente con dotenv, legge l'artifact compilato da `artifacts/contracts/PokeDEXCustomCards.sol/PokeDEXCustomCards.json`, e crea il contratto usando `ethers.ContractFactory`. Utile per aggiornare solo CustomCards senza toccare Marketplace o QRNG. Stampa il nuovo indirizzo e quello vecchio per confronto.

Standalone script (no Hardhat runtime) for re-deploying **PokeDEXCustomCards** with `tokensOfOwner` support. Loads `.env` directly with dotenv, reads the compiled artifact from `artifacts/contracts/PokeDEXCustomCards.sol/PokeDEXCustomCards.json`, and creates the contract using `ethers.ContractFactory`. Useful for upgrading only CustomCards without touching Marketplace or QRNG. Prints both the new and old addresses for comparison.

### `verify.ts`

Verifica i contratti su Etherscan tramite il task `verify:verify` di Hardhat. Copre PokeDEXCard, CardPack e BattleArena con i rispettivi argomenti del costruttore. Gestisce il caso "Already Verified" senza errore. Richiede di inserire manualmente gli indirizzi e i parametri VRF nelle costanti in cima al file prima dell'esecuzione.

Verifies contracts on Etherscan using Hardhat's `verify:verify` task. Covers PokeDEXCard, CardPack, and BattleArena with their respective constructor arguments. Gracefully handles the "Already Verified" case. Requires manually editing addresses and VRF parameters in the constants at the top of the file before running.

### `generate-metadata.ts`

Genera 50 file JSON di metadati ERC-721 nella directory `metadata/generated/`. Itera su 10 Pokemon di esempio (Pikachu, Charizard, Blastoise, Venusaur, Mewtwo, Gengar, Dragonite, Lucario, Garchomp, Greninja) ciascuno con 5 livelli di rarita (Common, Uncommon, Rare, Ultra Rare, Legendary). Ogni file contiene: nome con ID, descrizione, URI immagine IPFS placeholder, attributi (Type, HP, Attack, Defense, Speed, Rarity, Generation, Experience) e colore di sfondo basato sul tipo Pokemon. Le statistiche sono randomizzate entro range che scalano con la rarita (Common: 20-60, Legendary: 120-255).

Generates 50 ERC-721 metadata JSON files in the `metadata/generated/` directory. Iterates over 10 sample Pokemon (Pikachu, Charizard, Blastoise, Venusaur, Mewtwo, Gengar, Dragonite, Lucario, Garchomp, Greninja) each with 5 rarity tiers (Common, Uncommon, Rare, Ultra Rare, Legendary). Each file contains: name with ID, description, placeholder IPFS image URI, attributes (Type, HP, Attack, Defense, Speed, Rarity, Generation, Experience), and background color based on Pokemon type. Stats are randomized within ranges that scale with rarity (Common: 20-60, Legendary: 120-255).

### `check-connection.ts`

Script diagnostico Hardhat che verifica la connessione alla rete Sepolia. Stampa nome della rete, chain ID, indirizzo del wallet e saldo ETH formattato. Se il saldo e zero, avvisa e suggerisce il faucet Sepolia per ottenere ETH di test. Utile come primo controllo prima del deploy.

Hardhat diagnostic script that verifies the connection to the Sepolia network. Prints network name, chain ID, wallet address, and formatted ETH balance. If the balance is zero, warns and suggests the Sepolia faucet for obtaining test ETH. Useful as a first check before deployment.

## Variabili d'Ambiente Necessarie / Required Environment Variables

```
SEPOLIA_RPC_URL              # Endpoint RPC Sepolia / Sepolia RPC endpoint
PRIVATE_KEY                  # Wallet del deployer / Deployer wallet
POKEDEX_CARD_ADDRESS         # Per deploy-new.ts / For deploy-new.ts
API3_AIRNODE_RRP             # Per deploy-new.ts (ha default) / For deploy-new.ts (has default)
CUSTOM_CARDS_ADDRESS         # Per deploy-custom-cards-v2.ts / For deploy-custom-cards-v2.ts
ETHERSCAN_API_KEY            # Per verify.ts / For verify.ts
```
