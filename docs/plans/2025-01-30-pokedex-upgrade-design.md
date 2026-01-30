# PokeDEX Upgrade Design Document

**Data:** 2025-01-30
**Stato:** Approvato
**Network:** Ethereum Sepolia Testnet

---

## 1. Architettura

```
┌─────────────────────────────────────────────────────────────┐
│                    TELEGRAM BOT (bot.ts)                    │
├─────────────────────────────────────────────────────────────┤
│  WalletManager     - Custodial, chiavi AES-256 criptate     │
│  MarketplaceUI     - Immagini IPFS + inline buy buttons     │
│  BattleUI          - Sfide + betting + risultati live       │
│  CardCreator       - Upload → Pinata → mint NFT             │
│  PortfolioViewer   - Visualizza NFT + balance + stats       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SMART CONTRACTS (Sepolia Testnet)              │
├─────────────────────────────────────────────────────────────┤
│  PokeDEXCard.sol        - ERC721 base NFT                   │
│  PokeDEXCustomCards.sol - Mint carte custom (user upload)   │
│  PokeDEXMarketplace.sol - Buy/Sell con immagini             │
│  BattleArena.sol        - PvP + BETTING + formula dinamica  │
│  CardPack.sol           - Pacchetti con API3 QRNG (FREE)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        EXTERNAL                             │
├─────────────────────────────────────────────────────────────┤
│  Pinata/IPFS      - Storage immagini carte                  │
│  API3 QRNG        - Randomness quantistica gratuita         │
│  Sepolia RPC      - Connessione blockchain                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. File da Eliminare

| File | Motivo |
|------|--------|
| `Counter.sol` | Template Hardhat non necessario |
| `Counter.t.sol` | Template Hardhat non necessario |
| `CardPack.sol` | Usa Chainlink VRF (richiede subscription) |

**Nota:** `CardPackQRNG.sol` verrà rinominato in `CardPack.sol`

---

## 3. Sistema di Battaglia con Betting

### 3.1 Formula BattlePower

```
BattlePower = (BaseStats × RarityMultiplier) + (TradeCount × 10) + (LastSalePrice / 0.01 ETH) + RandomFactor

Dove:
- BaseStats = HP + Attack + Defense + Speed
- RarityMultiplier = Common(1x), Uncommon(1.5x), Rare(2x), UltraRare(3x), Legendary(5x)
- TradeCount = Numero di volte che l'NFT è stato scambiato
- LastSalePrice = Ultimo prezzo di vendita nel marketplace
- RandomFactor = API3 QRNG (0-100)
```

### 3.2 Flusso Betting

```
1. Sfidante crea challenge + deposita stake
   └── Stato: PENDING

2. Avversario accetta + deposita stesso stake
   └── Stato: ACTIVE → Richiesta QRNG

3. QRNG callback → Calcolo → Vincitore
   └── Stato: COMPLETED
   └── Vincitore: stake × 2 - 5% fee

4. Timeout 24h senza accettazione:
   └── Stato: CANCELLED → Stake restituito
```

---

## 4. Marketplace Telegram

### 4.1 UI Card Display

```
┌─────────────────────────────────────┐
│  🔥 CHARIZARD #0042                 │
│  [IMMAGINE CARTA DA IPFS]           │
│                                     │
│  ⚔️ ATK: 180  🛡️ DEF: 120           │
│  ❤️ HP: 200   ⚡ SPD: 150            │
│  ✨ Rarity: Legendary               │
│  📊 Trades: 12 | Last: 0.5 ETH      │
│                                     │
│  💰 Prezzo: 0.25 ETH                │
│                                     │
│  [🛒 COMPRA ORA]  [◀️ Prev] [Next ▶️] │
└─────────────────────────────────────┘
```

### 4.2 Listing Structure (Contract)

```solidity
struct Listing {
    address seller;
    uint256 tokenId;
    uint256 price;
    uint256 listedAt;
    bool active;
    string imageURI;
    uint256 tradeCount;
}
```

---

## 5. Wallet Custodial

### 5.1 Sicurezza

- Crittografia: AES-256-GCM
- Chiave derivata: MASTER_KEY + visitorId + salt
- Storage: `data/wallets/{visitorId}.enc`

### 5.2 Messaggi Auto-Cancellanti

| Tipo Dato | Auto-Delete | Tempo | Protect Content |
|-----------|-------------|-------|-----------------|
| Private Key | ✅ | 30 sec | ✅ |
| Balance | ✅ | 60 sec | ✅ |
| Address deposito | ✅ | 120 sec | ❌ |
| Conferma tx | ✅ | 300 sec | ❌ |

### 5.3 Comandi

| Comando | Azione |
|---------|--------|
| `/wallet` | Mostra address + balance |
| `/deposit` | QR code + address |
| `/withdraw <amt> <addr>` | Ritira ETH |
| `/export` | Esporta private key (30s auto-delete) |

---

## 6. Piano Implementazione

### Fase 1: Cleanup
- [ ] Elimina Counter.sol, Counter.t.sol, CardPack.sol
- [ ] Rinomina CardPackQRNG.sol → CardPack.sol
- [ ] Aggiorna dipendenze

### Fase 2: Smart Contracts
- [ ] BattleArena.sol - Betting + Formula
- [ ] PokeDEXMarketplace.sol - imageURI + tradeCount
- [ ] PokeDEXCard.sol - tradeCount tracking

### Fase 3: Telegram Bot
- [ ] WalletManager module
- [ ] MarketplaceUI refactor
- [ ] BattleUI refactor
- [ ] PortfolioViewer module

### Fase 4: Testing
- [ ] Unit tests contratti
- [ ] Integration tests bot
- [ ] E2E test su Sepolia

---

## 7. Environment Variables Required

```env
# Existing
TELEGRAM_BOT_TOKEN=
PINATA_API_KEY=
PINATA_SECRET_KEY=
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=

# New
WALLET_ENCRYPTION_KEY=<32-byte-hex>  # CRITICAL: Secure backup!
```
