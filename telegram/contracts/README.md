# telegram/contracts/ -- Blockchain Connection Layer

Bridges the Telegram bot to Ethereum smart contracts via ethers.js.
Two files handle the entire blockchain interface: connection management
and ABI definitions.

## Connection Architecture

```
  .env (secrets)          config.ts (addresses)
       |                        |
       v                        v
+----------------------------------------------+
|              provider.ts                      |
|                                               |
|  SEPOLIA_RPC_URL -----> JsonRpcProvider       |
|                              |                |
|  PRIVATE_KEY ---------> Wallet (signer)       |
|                              |                |
|  PINATA_API_KEY ------> pinataSDK client      |
|  PINATA_SECRET_KEY          |                 |
+----------------------------------------------+
       |                      |
       v                      v
  Read-only              Writable
  Contracts              Contracts
  (free calls)           (gas required)
       |                      |
       v                      v
+--------------+    +-----------------+
| customCards  |    | customCards     |
| Contract     |    | Writable       |
+--------------+    +-----------------+
| marketplace  |    | marketplace    |
| Contract     |    | Writable       |
+--------------+    +-----------------+
```

## Files

### provider.ts

Sets up four categories of exports:

| Export                  | Type              | Purpose                        |
|-------------------------|-------------------|--------------------------------|
| `provider`              | JsonRpcProvider   | Read-only RPC connection       |
| `signer`                | Wallet or null    | Signs transactions with gas    |
| `customCardsContract`   | Contract or null  | Read CustomCards (free)         |
| `customCardsWritable`   | Contract or null  | Write CustomCards (costs gas)   |
| `marketplaceContract`   | Contract or null  | Read Marketplace (free)         |
| `marketplaceWritable`   | Contract or null  | Write Marketplace (costs gas)   |
| `pinata`                | pinataSDK or null | IPFS file uploads via Pinata   |

**Initialization flow:**

1. Provider created immediately from `SEPOLIA_RPC_URL` (fallback: publicnode.com)
2. Signer created if `PRIVATE_KEY` is present in env
3. Pinata client created and auth-tested if API keys are present
4. `initContracts()` must be called at startup to build contract instances

**Dual-instance pattern** -- each contract gets two ethers.Contract objects:

```
Read path:   new ethers.Contract(address, abi, provider)   -- no gas
Write path:  new ethers.Contract(address, abi, signer)     -- signs tx
```

If `PRIVATE_KEY` is missing, writable instances stay null and the bot
operates in read-only mode.

### abis.ts

Uses ethers.js human-readable ABI format (not compiled JSON). Each
string describes one function signature or event.

**CUSTOM_CARDS_ABI** -- PokeDEXCustomCards.sol functions:

- View: `balanceOf`, `ownerOf`, `totalSupply`, `mintingFee`, `tokenURI`,
  `getCardStats`, `tokensOfOwner`, `getCreatorCards`, `isBanned`,
  `calculateBattlePower`
- Write: `createCard` (payable, requires mintingFee)

**MARKETPLACE_ABI** -- PokeDEXMarketplace.sol functions:

- View: `marketplaceFee`, `getListing`, `getOffer`, `getSellerListings`,
  `getBuyerOffers`, `totalListings`
- Write: `listNFT`, `buyNFT` (payable), `cancelListing`, `makeOffer`
  (payable), `acceptOffer`, `cancelOffer`
- Events: `NFTListed`, `NFTSold`

## Data Flow Example: Minting a Card

```
Bot handler
  |
  +--> pinata.pinFileToIPFS(image)        --> IPFS CID
  +--> pinata.pinJSONToIPFS(metadata)     --> metadata URI
  |
  +--> customCardsWritable.createCard(
  |      metadataURI, hp, atk, def, spd,
  |      cardType, rarity, royalty,
  |      { value: mintingFee }
  |    )
  |
  +--> tx.wait()                          --> token ID
```

## Required Environment Variables

```
SEPOLIA_RPC_URL          # JSON-RPC endpoint (optional, has fallback)
PRIVATE_KEY              # Bot wallet private key (for write ops)
CUSTOM_CARDS_ADDRESS     # Deployed CustomCards contract address
MARKETPLACE_ADDRESS      # Deployed Marketplace contract address
PINATA_API_KEY           # Pinata IPFS service key
PINATA_SECRET_KEY        # Pinata IPFS service secret
```
