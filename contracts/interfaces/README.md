# contracts/interfaces/

Interfacce Solidity che definiscono le ABI (firme delle funzioni) dei contratti PokeDEX.
Solidity interfaces defining the ABIs (function signatures) of the PokeDEX contracts.

## Panoramica / Overview

Le interfacce separano la definizione pubblica di un contratto dalla sua implementazione. Questo permette ad altri contratti (come il Marketplace) di interagire con i contratti NFT senza dipendere dal codice concreto, favorendo modularita e aggiornabilita. Ogni interfaccia dichiara le struct, gli eventi e le firme delle funzioni esterne del rispettivo contratto.

Interfaces separate a contract's public definition from its implementation. This allows other contracts (such as the Marketplace) to interact with the NFT contracts without depending on concrete code, promoting modularity and upgradeability. Each interface declares the structs, events, and external function signatures of its corresponding contract.

## File / Files

| File | Descrizione / Description |
|------|---------------------------|
| `IPokeDEXCard.sol` | Interfaccia per il contratto ERC-721 delle carte Pokemon. Definisce le struct `CardStats` (HP, attacco, difesa, velocita, tipo, rarita, generazione, esperienza) e `CardMetrics` (metriche estese per il battle power). Espone funzioni di minting (`mintCard`, `batchMintCards`), aggiornamento stats (`addExperience`, `setLastSalePrice`), lettura dati (`getCardStats`, `getCardMetrics`, `calculateBattlePower`, `tokensOfOwner`), e trasferimento admin a due step. Usata da `PokeDEXMarketplace` per aggiornare il prezzo di ultima vendita dopo ogni transazione. / Interface for the Pokemon card ERC-721 contract. Defines `CardStats` (HP, attack, defence, speed, type, rarity, generation, experience) and `CardMetrics` (extended metrics for battle power). Exposes minting functions (`mintCard`, `batchMintCards`), stats updates (`addExperience`, `setLastSalePrice`), data queries (`getCardStats`, `getCardMetrics`, `calculateBattlePower`, `tokensOfOwner`), and two-step admin transfer. Used by `PokeDEXMarketplace` to update the last sale price after each transaction. |
| `IPokeDEXMarketplace.sol` | Interfaccia per il contratto Marketplace. Definisce le struct `Listing`, `NFTStats` e `Offer`, e le firme di tutte le funzioni di listing (`listNFT`, `cancelListing`, `updateListing`, `buyNFT`), offerte (`makeOffer`, `cancelOffer`, `acceptOffer`, `withdrawExpiredOffer`), query (`getListing`, `getOffer`, `getNFTStats`, `getSellerListings`, `getBuyerOffers`), e admin (`setMarketplaceFee`, `setFeeRecipient`, `pause`, `unpause`, trasferimento admin a due step). / Interface for the Marketplace contract. Defines `Listing`, `NFTStats`, and `Offer` structs, plus signatures for all listing functions (`listNFT`, `cancelListing`, `updateListing`, `buyNFT`), offers (`makeOffer`, `cancelOffer`, `acceptOffer`, `withdrawExpiredOffer`), queries (`getListing`, `getOffer`, `getNFTStats`, `getSellerListings`, `getBuyerOffers`), and admin (`setMarketplaceFee`, `setFeeRecipient`, `pause`, `unpause`, two-step admin transfer). |

## Interfacce rimosse / Removed Interfaces

I seguenti file sono stati rimossi durante una fase di pulizia del codice:

The following files were removed during a codebase cleanup:

- `IBattleArena.sol` -- interfaccia per il contratto arena di battaglia / interface for the battle arena contract
- `ICardPack.sol` -- interfaccia per il contratto di apertura pacchetti / interface for the card pack opening contract

## Architettura / Architecture

```
IPokeDEXCard  <-----  PokeDEXMarketplace.sol
  (interfaccia)          (importa e usa IPokeDEXCard per chiamare setLastSalePrice)
  (interface)            (imports and uses IPokeDEXCard to call setLastSalePrice)

IPokeDEXMarketplace
  (interfaccia)          Usata da client esterni (bot Telegram, frontend)
  (interface)            Used by external clients (Telegram bot, frontend)
```

`PokeDEXMarketplace.sol` importa direttamente `IPokeDEXCard` e mantiene un riferimento al contratto card (`pokeDEXCard`). Dopo ogni vendita tramite `buyNFT()`, se il contratto NFT venduto corrisponde a `pokeDEXCard`, il Marketplace chiama `setLastSalePrice()` per aggiornare il prezzo di ultima vendita sulla carta. Questa dipendenza e gestita tramite interfaccia, quindi il Marketplace funziona indipendentemente dall'implementazione concreta del contratto card.

`PokeDEXMarketplace.sol` directly imports `IPokeDEXCard` and holds a reference to the card contract (`pokeDEXCard`). After each sale via `buyNFT()`, if the sold NFT contract matches `pokeDEXCard`, the Marketplace calls `setLastSalePrice()` to update the last sale price on the card. This dependency is managed through the interface, so the Marketplace works independently of the concrete card contract implementation.
