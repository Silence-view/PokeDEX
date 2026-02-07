# Docs

Documentazione di progetto, design document e piani di implementazione per PokeDEX.
Project documentation, design documents, and implementation plans for PokeDEX.

## Panoramica / Overview

Questa directory raccoglie i documenti di architettura e pianificazione del progetto PokeDEX. I design document descrivono le scelte tecniche, i flussi dei dati e le fasi di sviluppo. I file seguono la convenzione `YYYY-MM-DD-<nome-descrittivo>.md` per ordinamento cronologico.

This directory collects the architecture and planning documents for the PokeDEX project. Design documents describe technical choices, data flows, and development phases. Files follow the `YYYY-MM-DD-<descriptive-name>.md` naming convention for chronological ordering.

## File / Files

### `plans/2025-01-30-pokedex-upgrade-design.md`

Design document principale, approvato il 30 gennaio 2025. Rete target: Ethereum Sepolia Testnet.

Main design document, approved on January 30, 2025. Target network: Ethereum Sepolia Testnet.

Contenuti principali / Main contents:

- **Architettura / Architecture** -- Diagramma a tre livelli: Telegram Bot (WalletManager, MarketplaceUI, BattleUI, CardCreator, PortfolioViewer), smart contract su Sepolia (PokeDEXCard, PokeDEXCustomCards, PokeDEXMarketplace, BattleArena, CardPack), servizi esterni (Pinata/IPFS per immagini, API3 QRNG per randomness gratuita, Sepolia RPC).
- **Architecture** -- Three-tier diagram: Telegram Bot (WalletManager, MarketplaceUI, BattleUI, CardCreator, PortfolioViewer), smart contracts on Sepolia (PokeDEXCard, PokeDEXCustomCards, PokeDEXMarketplace, BattleArena, CardPack), external services (Pinata/IPFS for images, API3 QRNG for free randomness, Sepolia RPC).

- **Cleanup** -- Rimozione di Counter.sol e Counter.t.sol (template Hardhat) e CardPack.sol (Chainlink VRF, richiede subscription a pagamento). CardPackQRNG.sol lo sostituisce con randomness quantistica gratuita tramite API3.
- **Cleanup** -- Removal of Counter.sol and Counter.t.sol (Hardhat templates) and CardPack.sol (Chainlink VRF, requires paid subscription). CardPackQRNG.sol replaces it with free quantum randomness via API3.

- **Sistema di battaglia / Battle system** -- Formula BattlePower: `(BaseStats x RarityMultiplier) + (TradeCount x 10) + (LastSalePrice / 0.01 ETH) + RandomFactor`. I moltiplicatori di rarita vanno da 1x (Common) a 5x (Legendary). Il flusso di betting prevede: creazione sfida con stake, accettazione con stake corrispondente, callback QRNG per il calcolo, distribuzione vincite (stake x 2 - 5% fee), timeout 24h con rimborso automatico.
- **Battle system** -- BattlePower formula: `(BaseStats x RarityMultiplier) + (TradeCount x 10) + (LastSalePrice / 0.01 ETH) + RandomFactor`. Rarity multipliers range from 1x (Common) to 5x (Legendary). Betting flow: challenge creation with stake, acceptance with matching stake, QRNG callback for calculation, winnings distribution (stake x 2 - 5% fee), 24h timeout with automatic refund.

- **Wallet custodial / Custodial wallet** -- Crittografia AES-256-GCM con chiave derivata da MASTER_KEY + visitorId + salt. Messaggi Telegram auto-cancellanti con tempi differenziati: private key (30s), balance (60s), indirizzo deposito (120s), conferma transazione (300s).
- **Custodial wallet** -- AES-256-GCM encryption with key derived from MASTER_KEY + visitorId + salt. Auto-deleting Telegram messages with differentiated timers: private key (30s), balance (60s), deposit address (120s), transaction confirmation (300s).

- **Piano di implementazione / Implementation plan** -- Quattro fasi: (1) Cleanup dei file template e obsoleti, (2) Smart contract con betting, marketplace e trade tracking, (3) Telegram Bot con moduli wallet, marketplace, battle e portfolio, (4) Testing unitario, di integrazione e E2E su Sepolia.
- **Implementation plan** -- Four phases: (1) Cleanup of template and obsolete files, (2) Smart contracts with betting, marketplace, and trade tracking, (3) Telegram Bot with wallet, marketplace, battle, and portfolio modules, (4) Unit, integration, and E2E testing on Sepolia.

## Documentazione Correlata / Related Documentation

| File | Descrizione / Description |
|------|---------------------------|
| `../README.md` | Overview del progetto e istruzioni di setup / Project overview and setup instructions |
| `../SECURITY_AUDIT_REPORT.md` | Audit di sicurezza degli smart contract / Smart contract security audit |
| `../LICENSE` | Licenza del progetto / Project license |
