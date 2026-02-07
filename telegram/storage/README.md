# telegram/storage/ -- File-Based Persistence

JSON-on-disk storage for bot session state, card drafts, and metadata
cache. No database required -- each entity is a separate JSON file with
atomic writes to prevent corruption.

## Files

### types.ts -- Data Structures

**SessionState** -- finite state machine for conversation flow:

```
idle
  |---> awaiting_withdraw_address ---> awaiting_withdraw_amount
  |---> collecting_card_name ---> collecting_type ---> collecting_rarity
  |       ---> collecting_image ---> collecting_description
  |       ---> preview_card ---> collecting_price ---> collecting_royalty
  |       ---> confirm_deploy
```

**DraftStatus** -- card creation lifecycle:

```
in_progress --> ready_to_mint --> uploading --> minting --> minted
                                     |            |
                                     +--failed<---+
```

**Interfaces:**

| Interface          | Key Fields                                           |
|--------------------|------------------------------------------------------|
| `UserSession`      | telegramUserId, currentState, walletAddress,         |
|                    | currentDraftId, language ("en"/"it"), lastActivity    |
| `CardDraft`        | draftId (UUID), stats, imageSource, ipfsImageHash,   |
|                    | metadataUri, royaltyPercentage, status, mintTxHash    |
| `CachedCard`       | tokenId, contractAddress, stats, owner, battlePower, |
|                    | cachedAt (TTL-based expiry)                          |
| `CardMetadataCache`| cards (Record<string, CachedCard>), lastUpdated      |
| `NFTMetadata`      | name, description, image, attributes (IPFS JSON)     |

### index.ts -- Store Classes

Three singleton store instances exported at module level:

```
export const sessionStore    = new SessionStore();
export const draftStore      = new DraftStore();
export const cardCacheStore  = new CardCacheStore();
```

**SessionStore** -- one JSON file per Telegram user:

- Loads all sessions from disk into an in-memory Map on startup
- `getOrCreate(userId)` -- lazy initialization with defaults
- `setState(userId, state)` -- updates conversation state
- `setWallet(userId, address)` -- links wallet to session
- `save(session)` -- persists to disk immediately

**DraftStore** -- one JSON file per draft, grouped by user:

- `create(userId)` -- generates UUID, sets default stats
- `listByUser(userId)` -- lists all drafts sorted by updatedAt desc
- `getActiveDraft(userId)` -- finds first draft with status "in_progress"
- `markStatus(userId, draftId, status)` -- lifecycle transitions

**CardCacheStore** -- single JSON file with TTL eviction:

- Cache key: `{contractAddress}_{tokenId}`
- TTL: 5 minutes (configurable via `cacheTTL`)
- `get()` returns null if entry is expired
- `invalidate()` removes a specific entry

## Atomic Write Pattern

All writes use the same strategy to prevent data loss on crash:

```
1. Write to temporary file:   {path}.tmp
2. Rename temp to target:     rename({path}.tmp, {path})
   (rename is atomic on POSIX filesystems)
```

## Disk Layout

```
data/
+-- sessions/
|   +-- 863855745.json           # UserSession for user 863855745
|   +-- {userId}.json            # One file per Telegram user
|
+-- drafts/
|   +-- 863855745/               # Per-user directory
|   |   +-- a82e2a18-...json     # CardDraft (UUID filename)
|   |   +-- 569b9090-...json     # Another draft
|   +-- {userId}/
|       +-- {uuid}.json
|
+-- cards/
    +-- cache.json               # CardMetadataCache (single file)
```

## Module Exports

The module re-exports all types from `types.ts`:

```typescript
import {
  sessionStore,         // SessionStore singleton
  draftStore,           // DraftStore singleton
  cardCacheStore,       // CardCacheStore singleton
  UserSession,          // type
  CardDraft,            // type
  CachedCard,           // type
  SessionState,         // type
  DraftStatus,          // type
} from "./storage/index.js";
```
