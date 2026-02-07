# contracts/

Smart contract Solidity per il progetto PokeDEX NFT TCG, deployati sulla testnet Ethereum Sepolia.
Solidity smart contracts for the PokeDEX NFT Trading Card Game, deployed on the Ethereum Sepolia testnet.

## Panoramica / Overview

Questa directory contiene i contratti principali del sistema PokeDEX. I contratti gestiscono la creazione di carte NFT personalizzate dagli utenti e un marketplace decentralizzato per la compravendita con supporto alle royalty ERC-2981. Sono scritti in Solidity `^0.8.20` e utilizzano le librerie OpenZeppelin per sicurezza e conformita agli standard.

This directory holds the core PokeDEX system contracts. They handle user-created custom NFT cards and a decentralised marketplace for buying and selling those cards with ERC-2981 royalty support. Written in Solidity `^0.8.20`, they rely on OpenZeppelin libraries for security and standards compliance.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `PokeDEXCustomCards.sol` | Contratto ERC-721 per carte NFT create dagli utenti. Supporta minting singolo (`createCard`), semplificato (`createSimpleCard`) e batch (`batchCreateCards`, max 10). Ogni carta ha statistiche on-chain (HP, attacco, difesa, velocita, tipo, rarita), royalty per-token tramite ERC-2981, e un sistema di moderazione (verifica/ban) basato su `AccessControl`. Il minting richiede una fee anti-spam (default 0.001 ETH) e il contratto e pausabile. / ERC-721 contract for user-created NFT cards. Supports single minting (`createCard`), simplified minting (`createSimpleCard`), and batch minting (`batchCreateCards`, max 10). Each card stores on-chain stats (HP, attack, defence, speed, type, rarity), per-token royalties via ERC-2981, and a moderation system (verify/ban) powered by `AccessControl`. Minting requires an anti-spam fee (default 0.001 ETH) and the contract is pausable. |
| `PokeDEXMarketplace.sol` | Marketplace NFT con listing diretti e offerte con escrow. Gestisce fee marketplace (default 2.5%, max 10%), pagamento automatico royalty ERC-2981 (cap 10%), protezione front-running (`expectedPrice`), statistiche di trading per ogni NFT, e trasferimento admin a due step. Supporta qualsiasi contratto ERC-721, non solo PokeDEX. / NFT marketplace supporting direct listings and escrow-based offers. Handles marketplace fees (default 2.5%, max 10%), automatic ERC-2981 royalty payments (capped at 10%), front-running protection (`expectedPrice`), per-NFT trading statistics, and two-step admin transfer. Works with any ERC-721 contract, not just PokeDEX cards. |
| `interfaces/` | Directory contenente le interfacce Solidity (ABI) dei contratti. Vedi il README dedicato. / Directory containing the Solidity interfaces (ABIs) for the contracts. See its dedicated README. |

## Contratti rimossi / Removed Contracts

I seguenti contratti sono stati rimossi durante una fase di pulizia del codice:

The following contracts were removed during a codebase cleanup:

- `PokeDEXCard.sol` -- contratto ERC-721 originale per le carte (sostituito da `PokeDEXCustomCards.sol`) / original ERC-721 card contract (replaced by `PokeDEXCustomCards.sol`)
- `BattleArena.sol` -- arena di battaglia on-chain tra carte / on-chain battle arena between cards
- `CardPack.sol` -- apertura pacchetti di carte con Chainlink VRF / card pack opening using Chainlink VRF
- `CardPackQRNG.sol` -- variante pacchetti con API3 QRNG / card pack variant using API3 QRNG

## Architettura / Architecture

```
PokeDEXCustomCards (ERC-721)
  |
  |-- Utente crea carta con createCard() / createSimpleCard() / batchCreateCards()
  |   User creates card via createCard() / createSimpleCard() / batchCreateCards()
  |
  |-- Moderatore verifica o banna carte tramite MODERATOR_ROLE
  |   Moderator verifies or bans cards via MODERATOR_ROLE
  |
  v
PokeDEXMarketplace
  |
  |-- Venditore elenca NFT con listNFT() --> Compratore acquista con buyNFT()
  |   Seller lists NFT via listNFT()    --> Buyer purchases via buyNFT()
  |
  |-- Compratore fa offerta con makeOffer() --> Proprietario accetta con acceptOffer()
  |   Buyer makes offer via makeOffer()     --> Owner accepts via acceptOffer()
  |
  |-- Distribuzione pagamento:
  |   Payment distribution:
  |     Seller  = prezzo - fee marketplace - royalty
  |     Seller  = price  - marketplace fee - royalty
  |     Fee     --> feeRecipient
  |     Royalty --> creatore originale (ERC-2981) / original creator (ERC-2981)
```

Il Marketplace interagisce con `PokeDEXCustomCards` (o qualsiasi ERC-721) tramite l'interfaccia standard `IERC721` per i trasferimenti e `IERC2981` per le royalty. Usa anche `IPokeDEXCard` per aggiornare il prezzo di ultima vendita quando il contratto NFT lo supporta.

The Marketplace interacts with `PokeDEXCustomCards` (or any ERC-721) through the standard `IERC721` interface for transfers and `IERC2981` for royalties. It also uses `IPokeDEXCard` to update the last sale price when the NFT contract supports it.

## Dipendenze / Dependencies

- **OpenZeppelin Contracts** -- `ERC721URIStorage`, `ERC2981`, `AccessControl`, `ReentrancyGuard`, `Pausable`, `IERC165`
- **Solidity** `^0.8.20`

## Rete / Network

- **Testnet:** Ethereum Sepolia
