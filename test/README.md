# Test

Test Hardhat per gli smart contract PokeDEX, con asserzioni Chai ed Ethers.js.
Hardhat tests for PokeDEX smart contracts, using Chai assertions and Ethers.js.

## Panoramica / Overview

Questa directory contiene i test unitari e di integrazione per i contratti principali del progetto. I test usano un nodo Hardhat locale in-memory: ogni suite deploya i contratti da zero nel `beforeEach`, configura i ruoli necessari (STATS_UPDATER_ROLE, MARKETPLACE_ROLE), minta le carte per i giocatori, e verifica il comportamento end-to-end.

This directory contains unit and integration tests for the project's main contracts. Tests use a local in-memory Hardhat node: each suite deploys contracts from scratch in `beforeEach`, configures necessary roles (STATS_UPDATER_ROLE, MARKETPLACE_ROLE), mints cards for players, and verifies end-to-end behavior.

## File / Files

### `Basic.test.cjs`

File di test principale in formato CommonJS (`.cjs` necessario perche il progetto usa ES modules in `package.json` ma il test runner Hardhat richiede CJS per il caricamento dei plugin).

Main test file in CommonJS format (`.cjs` required because the project uses ES modules in `package.json` but Hardhat's test runner needs CJS for plugin loading).

Contiene tre suite di test:

Contains three test suites:

**PokeDEXCard** -- Verifica il deploy corretto (nome "PokeDEX Card", simbolo "PDEX"). Testa il mint di carte NFT con statistiche complete (HP, Attack, Defense, Speed, pokemonType, rarity, generation, experience) e controlla `balanceOf` e `ownerOf`. Verifica che il `tradeCount` si incrementi ad ogni `transferFrom` tra utenti. Testa il calcolo del battle power tramite `calculateBattlePowerWithMetrics` e controlla che il risultato sia positivo.

**PokeDEXCard** -- Verifies correct deployment (name "PokeDEX Card", symbol "PDEX"). Tests NFT card minting with full stats (HP, Attack, Defense, Speed, pokemonType, rarity, generation, experience) and checks `balanceOf` and `ownerOf`. Verifies that `tradeCount` increments on each `transferFrom` between users. Tests battle power calculation via `calculateBattlePowerWithMetrics` and checks the result is positive.

**BattleArena** -- Deploya BattleArena con il riferimento a PokeDEXCard e assegna STATS_UPDATER_ROLE. Testa la creazione di sfide (`createChallenge` con stato Pending), sfide con scommessa in ETH (`createChallengeWithBet` con 0.01 ETH), accettazione con scommessa corrispondente (`acceptChallengeWithBet`) e verifica che il vincitore riceva le vincite e che `bet.paid` sia true. Controlla il tracking delle statistiche giocatore (`totalBattles`, `wins`) e verifica che la formula del battle power produca un vincitore valido (indirizzo diverso da zero).

**BattleArena** -- Deploys BattleArena with the PokeDEXCard reference and grants STATS_UPDATER_ROLE. Tests challenge creation (`createChallenge` with Pending status), challenges with ETH betting (`createChallengeWithBet` with 0.01 ETH), acceptance with matching bet (`acceptChallengeWithBet`) and verifies the winner receives winnings and `bet.paid` is true. Checks player stats tracking (`totalBattles`, `wins`) and verifies the battle power formula produces a valid winner (non-zero address).

**PokeDEXMarketplace** -- Deploya il Marketplace con admin, feeRecipient e PokeDEXCard, assegna MARKETPLACE_ROLE. Testa il listing di NFT con immagine IPFS (`listNFT` con `imageURI`). Verifica l'acquisto completo: trasferimento di proprieta al compratore, disattivazione del listing, pagamento della fee al destinatario, e incremento del saldo del venditore. Controlla il tracking delle statistiche NFT tramite `nftStats` (tradeCount, lastSalePrice, lastBuyer) e la sincronizzazione del `lastSalePrice` nel contratto PokeDEXCard tramite `getCardMetrics`.

**PokeDEXMarketplace** -- Deploys the Marketplace with admin, feeRecipient, and PokeDEXCard, grants MARKETPLACE_ROLE. Tests NFT listing with IPFS image (`listNFT` with `imageURI`). Verifies the full purchase flow: ownership transfer to buyer, listing deactivation, fee payment to recipient, and seller balance increase. Checks NFT stats tracking via `nftStats` (tradeCount, lastSalePrice, lastBuyer) and `lastSalePrice` synchronization in the PokeDEXCard contract via `getCardMetrics`.

## Esecuzione / Running

```bash
npx hardhat test
```

## Copertura Mancante / Coverage Gaps

| Contratto / Contract | Stato / Status | Note / Notes |
|----------------------|----------------|--------------|
| PokeDEXCustomCards   | Non testato / Untested | Minting con fee, validazione stats, ban system, tokensOfOwner |
| CardPackQRNG         | Non testato / Untested | Richiede mock di API3 Airnode RRP / Requires API3 Airnode RRP mock |
