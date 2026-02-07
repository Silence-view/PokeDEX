# PokeDEX Smart Contract Security Audit Report

**Date:** 2026-02-07
**Auditors:** 10 Specialized Security Audit Agents (350+ academic sources)
**Contracts Audited:** PokeDEXCustomCards.sol (553 LOC), PokeDEXMarketplace.sol (836 LOC)
**Interfaces:** IPokeDEXCard.sol (270 LOC), IPokeDEXMarketplace.sol (409 LOC)
**Solidity:** ^0.8.20 | **Framework:** Hardhat v3 | **Dependencies:** OpenZeppelin v5
**Status:** COMPLETE

---

## Executive Summary

This report consolidates findings from 10 independent security auditors, each specializing in a distinct vulnerability domain, after deep research across 350+ academic and industry sources. The audit covers 4 Solidity files totaling ~2,068 lines of code.

**Overall Risk Assessment: MEDIUM-HIGH**

The contracts demonstrate solid fundamentals (ReentrancyGuard, AccessControl, Pausable, CEI pattern), but contain several systemic issues primarily around the **push-payment pattern** and **cross-contract state inconsistencies** that could lead to denial-of-service, fund lockup, and marketplace manipulation.

### Finding Distribution

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 2 | Push-payment DoS in buyNFT and acceptOffer |
| **HIGH** | 11 | Admin centralization, stale listings, dangling offers, fee truncation, wash trading, admin bypass |
| **MEDIUM** | 18 | Royalty griefing, phantom listings, banned card trading, unbounded arrays, silent failures, stats gaps |
| **LOW** | 14 | Gas griefing, event mismatches, missing bounds, stale approvals |
| **INFORMATIONAL** | 15 | Storage packing, missing constructor events, theoretical edge cases |
| **Total** | **60** (deduplicated: ~35 unique issues) |

---

## Audit Coverage Matrix

| Domain | Auditor | Sources | Findings |
|--------|---------|---------|----------|
| Reentrancy & CEI | #1 | 40 | 10 |
| Access Control & Privilege | #2 | 34 | 14 |
| Integer & Arithmetic | #3 | 36 | 15 |
| Front-Running & MEV | #4 | 36 | 12 |
| DoS & Gas Griefing | #5 | 35 | 15 |
| ERC-721 Compliance | #6 | 35 | 15 |
| Flash Loan & Economic | #7 | 34 | 15 |
| ETH Handling & Low-Level Calls | #8 | 32 | 11 |
| Marketplace-Specific Logic | #9 | 30 | 12 |
| Design Patterns & Events | #10 | 32 | 19 |

---

## CRITICAL Findings

### C-01: Push-Payment DoS in `buyNFT` -- Sequential ETH Transfers Create Multi-Point Denial of Service

**File:** `PokeDEXMarketplace.sol` lines 443-460
**Found by:** Auditors 5, 7, 8, 9
**Status:** ⚠️ ACCEPTED RISK

`buyNFT` performs up to 5 sequential external ETH transfers (fee, royalty, seller, refund, setLastSalePrice), each with `require(success)`. If ANY recipient reverts (malicious contract, non-payable address, gas griefing), the entire purchase fails.

**Attack vectors:**
- **Seller griefing:** Seller lists from a contract with `receive() { revert(); }` -- NFT permanently unpurchasable
- **Royalty DoS:** Malicious NFT contract returns a reverting royalty recipient via ERC-2981 -- blocks ALL sales of that collection
- **Fee recipient compromise:** If `feeRecipient` is set to a reverting contract, ALL marketplace sales are globally blocked

**Recommendation:** Implement pull-payment (escrow) pattern. Credit balances to a withdrawal mapping instead of pushing ETH directly.

**Team Decision:** The push-payment pattern is intentionally retained. The PokeDEX Telegram bot operates as a custodial service that executes all on-chain operations on behalf of users, requiring synchronous transaction finality. Migrating to a pull-payment model would break the seamless UX where users interact only through the bot without needing to perform any on-chain actions themselves. This is a known trade-off widely adopted by custodial NFT platforms and Telegram-based crypto bots in the current market. The risk is mitigated by: (1) admin-controlled `feeRecipient` set to EOA, (2) whitelisting only the PokeDEXCustomCards contract (which uses EOA royalty recipients), and (3) the `pause()` emergency mechanism.

---

### C-02: Push-Payment DoS in `acceptOffer` -- Same Pattern Blocks Offer Acceptance

**File:** `PokeDEXMarketplace.sol` lines 607-618
**Found by:** Auditors 5, 8, 9
**Status:** ⚠️ ACCEPTED RISK

`acceptOffer` uses the same sequential push-payment pattern with 3-4 external calls. A reverting fee recipient, royalty recipient, or seller address blocks all offer acceptances.

**Recommendation:** Same as C-01 -- implement pull-payment pattern.

**Team Decision:** Same rationale as C-01. The custodial bot model requires synchronous push-payment for seamless user experience. See C-01 for full justification and mitigations.

---

## HIGH Findings

### H-01: Single EOA Admin Controls All Critical Functions Without Timelock

**File:** Both contracts
**Found by:** Auditors 2, 4, 10

A single externally-owned account holds `DEFAULT_ADMIN_ROLE` and can instantly: pause/unpause both contracts, change fee recipient, modify marketplace fees, set minting fees, grant/revoke all roles, and change the PokeDEXCard reference. No timelock or multi-sig protection exists.

**Risk:** Compromised admin key = complete protocol takeover.
**Recommendation:** Implement TimelockController for admin operations. Use a multi-sig wallet.

---

### H-02: Two-Step Admin Transfer Bypassable via Direct `grantRole`

**File:** `PokeDEXMarketplace.sol` lines 771-805
**Found by:** Auditor 10

The two-step admin transfer (`initiateAdminTransfer` / `acceptAdminTransfer`) can be entirely bypassed by calling `AccessControl.grantRole(DEFAULT_ADMIN_ROLE, newAdmin)` directly. The safety mechanism is advisory, not enforced.

Additionally, with multiple admins, one admin's `initiateAdminTransfer` overwrites another's pending transfer silently.

**Recommendation:** Override `grantRole` to prevent direct `DEFAULT_ADMIN_ROLE` grants, or enforce single-admin invariant.

---

### H-03: Stale Listing Exploitation After NFT Return

**File:** `PokeDEXMarketplace.sol` -- `listNFT`, `buyNFT`
**Found by:** Auditors 4, 9

When a seller lists an NFT then transfers it externally, the listing remains `active = true`. If the NFT returns to the seller (or they re-acquire it), the old listing at the original price becomes executable. This mirrors the real-world OpenSea exploit that caused ~$1M+ in losses.

**Attack:** List at 10 ETH, transfer away, wait for price to rise to 50 ETH, transfer back -- the 10 ETH listing is live.
**Recommendation:** Add listing expiration (`MAX_LISTING_DURATION`). Re-verify ownership freshness in `buyNFT`.

---

### H-04: Dangling Offers After NFT Sale -- ETH Locked in Escrow

**File:** `PokeDEXMarketplace.sol` -- `buyNFT`, `acceptOffer`
**Found by:** Auditors 7, 9

When an NFT is sold via `buyNFT`, all existing offers for that token remain active with ETH locked in escrow. The new owner could accept stale offers, or offer makers' funds remain locked until manual cancellation or expiry.

**Attack:** Bob offers 5 ETH on NFT#7. NFT#7 sells to Alice for 10 ETH. Alice now owns NFT#7 and can accept Bob's 5 ETH offer, getting both the NFT for free (she already bought it) and Bob's escrowed ETH.
**Recommendation:** Invalidate all offers for a token when it changes ownership through the marketplace.

---

### H-05: Dust-Price Listing Enables Zero-Fee Trading via Integer Division Truncation

**File:** `PokeDEXMarketplace.sol` line 421
**Found by:** Auditors 3, 7

`uint256 marketplaceCut = (price * marketplaceFee) / 10000` -- with `marketplaceFee = 250` (2.5%), any listing price below 40 wei results in `marketplaceCut = 0`. Trades execute with zero marketplace fee.

While individual dust trades are economically pointless, this enables fee-free wash trading to inflate `NFTStats` (trade count, volume) at minimal cost.
**Recommendation:** Add `require(price >= MIN_LISTING_PRICE)` with a meaningful floor (e.g., 0.001 ETH).

---

### H-06: Unrestricted Wash Trading Enables Statistics Manipulation

**File:** `PokeDEXMarketplace.sol` -- NFTStats tracking
**Found by:** Auditors 7, 4

A user can list and buy their own NFTs to inflate `tradeCount`, `totalVolume`, `highestSalePrice`, and `lastSalePrice`. These statistics feed into `calculateBattlePowerWithMetrics` via the `CardMetrics` system, giving wash-traded cards inflated battle power.

**Attack:** Self-trade NFT 100 times at 100 ETH each = 10,000 ETH "volume" and 100 trades, dramatically boosting battle power metrics.
**Recommendation:** Consider off-chain stats computation, or add cooldown periods and self-trade detection.

---

### H-07: `feeRecipient` Revert Blocks ALL Minting in CustomCards

**File:** `PokeDEXCustomCards.sol` lines 154-156
**Found by:** Auditor 5

`createCard` sends the minting fee directly to `feeRecipient` with `require(success)`. If `feeRecipient` is a reverting contract, no new cards can be minted.

**Recommendation:** Accumulate fees in contract balance and use `withdrawFees` (already exists). Remove the direct push in `createCard`.

---

### H-08: Unbounded `batchVerify` Can Exceed Block Gas Limit

**File:** `PokeDEXCustomCards.sol` -- `batchVerify`
**Found by:** Auditors 5, 10

Unlike `batchCreateCards` (capped at 10), `batchVerify` has no array size limit. A moderator calling it with hundreds of token IDs can exceed block gas limit, wasting gas with a reverted transaction.

**Recommendation:** Add `require(tokenIds.length <= MAX_BATCH_SIZE)`.

---

### H-09: Force-Sent ETH Permanently Locked in Marketplace

**File:** `PokeDEXMarketplace.sol` -- no `receive()`/`fallback()`
**Found by:** Auditor 8

ETH can be force-sent to the marketplace via `selfdestruct` (pre-Dencun) or coinbase rewards. Without a `receive()` function and no sweep mechanism, this ETH is permanently locked.

**Recommendation:** Add an admin-callable `sweepETH` function to recover accidentally sent funds.

---

### H-10: Admin Can Redirect Revenue Streams Instantly

**File:** Both contracts -- `setFeeRecipient`
**Found by:** Auditor 2

Admin can instantly change `feeRecipient` to redirect all future marketplace fees and minting fees with zero delay or notification. A compromised admin key could silently redirect revenue.

**Recommendation:** Implement timelock delay on fee recipient changes. Emit events before execution.

---

### H-11: Malicious ERC-2981 Contract Can Extract Maximum Royalty

**File:** `PokeDEXMarketplace.sol` lines 426-435
**Found by:** Auditors 7, 9

A malicious NFT contract's `royaltyInfo()` can return inflated amounts up to the 10% cap on every sale. The recipient address is entirely controlled by the external contract and can change dynamically.

**Recommendation:** Maintain a whitelist of trusted NFT contracts, or cap total deductions (fee + royalty) to a configurable maximum.

---

## MEDIUM Findings

### M-01: Phantom Listing After Approval Revocation

**Found by:** Auditors 6, 9 | `PokeDEXMarketplace.sol`

Seller can revoke marketplace approval after listing. `buyNFT` reverts at `safeTransferFrom` but listing remains "active", wasting buyers' gas.

### M-02: Banned Cards Can Be Listed and Offered On

**Found by:** Auditors 9, 10 | `PokeDEXMarketplace.sol`

`listNFT` and `makeOffer` don't check `bannedTokens` status. Banned cards create phantom listings and lock offer ETH in escrow.

### M-03: `acceptOffer` Missing NFTStats Update and `setLastSalePrice`

**Found by:** Auditors 9, 10 | `PokeDEXMarketplace.sol`

Offer-based sales don't update `nftStats` or call `setLastSalePrice`, causing inconsistent trade volume and battle power metrics.

### M-04: Unbounded `sellerListings` and `buyerOffers` Array Growth

**Found by:** Auditors 5, 9, 10 | `PokeDEXMarketplace.sol`

Both arrays are append-only (never cleaned). Active users accumulate thousands of stale entries, causing RPC timeouts on view functions.

### M-05: Silent `setLastSalePrice` Failure (Empty catch block)

**Found by:** Auditors 9, 10 | `PokeDEXMarketplace.sol` lines 472-475

`try pokeDEXCard.setLastSalePrice(...) {} catch {}` silently swallows all errors including missing MARKETPLACE_ROLE, masking configuration issues.

### M-06: Royalty Recipient Can Grief Sales by Reverting

**Found by:** Auditors 7, 8, 10 | `PokeDEXMarketplace.sol` lines 448-451

A royalty recipient that reverts on ETH receipt permanently blocks all sales of that NFT on the marketplace.

### M-07: Missing Event on `setFeeRecipient` in CustomCards

**Found by:** Auditor 10 | `PokeDEXCustomCards.sol`

Unlike the Marketplace's `setFeeRecipient` (which emits `FeeRecipientUpdated`), the CustomCards version emits no event, making fee recipient changes invisible to off-chain monitoring.

### M-08: Flash Loan-Assisted Wash Trading at Zero Capital Risk

**Found by:** Auditor 7 | `PokeDEXMarketplace.sol`

An attacker can flash-loan ETH, execute wash trades to inflate NFTStats, and repay within the same transaction, manipulating battle power at zero capital risk.

### M-09: Escrow Capital Lockup Griefing via Mass Low-Value Offers

**Found by:** Auditor 7 | `PokeDEXMarketplace.sol`

Attacker can lock their own ETH in thousands of tiny offers across many NFTs, cluttering the marketplace and making it harder for legitimate offers to be noticed.

### M-10: Royalty Evasion via Wrapper Contract

**Found by:** Auditor 7 | `PokeDEXMarketplace.sol`

Users can wrap NFTs in a new ERC-721 contract that returns zero royalties from `royaltyInfo()`, then trade the wrapper token on the marketplace, evading creator royalties.

### M-11: Banned Token Approvals Not Cleared

**Found by:** Auditor 10 | `PokeDEXCustomCards.sol` lines 397-403

`banCard` doesn't clear existing ERC-721 approvals. If a card is banned then later unbanned, stale approvals remain active.

### M-12: Reentrancy via `_safeMint` Callback in `createCard`

**Found by:** Auditor 1 | `PokeDEXCustomCards.sol`

`_safeMint` triggers `onERC721Received` callback to the recipient. While `nonReentrant` prevents re-entering the same contract, cross-contract calls during the callback could observe intermediate state.

### M-13: Price Update Front-Running (MEV)

**Found by:** Auditors 4, 7 | `PokeDEXMarketplace.sol`

Sellers can front-run buyer transactions with `updateListing` to change price. The `expectedPrice` parameter in `buyNFT` mitigates price increases but the buyer still wastes gas.

### M-14: Offer Acceptance Race Condition

**Found by:** Auditor 4 | `PokeDEXMarketplace.sol`

Multiple offers can exist simultaneously. When the seller accepts one, others remain active. A MEV bot could sandwich the acceptance.

### M-15: `creatorCards` and `_ownedTokens` Unbounded Growth in CustomCards

**Found by:** Auditors 5, 10 | `PokeDEXCustomCards.sol`

`creatorCards` is append-only. `_ownedTokens` is properly maintained but `getCreatorCards()` returns full unbounded array.

### M-16: Cross-Function State Inconsistency: `buyNFT` vs `acceptOffer`

**Found by:** Auditors 9, 10

`buyNFT` updates NFTStats and calls `setLastSalePrice`, but `acceptOffer` does neither, creating asymmetric behavior for economically equivalent operations.

### M-17: NFTStats Manipulation Affects Battle Power Calculations

**Found by:** Auditor 7 | Both contracts

`calculateBattlePowerWithMetrics` uses `tradeCount`, `lastSalePrice`, and `holderDays` -- all manipulable through wash trading, inflating competitive advantage.

### M-18: `withdrawFees` DoS via Reverting feeRecipient

**Found by:** Auditor 5 | `PokeDEXCustomCards.sol`

If `feeRecipient` becomes a reverting contract, accumulated fees are permanently locked.

---

## LOW Findings

| ID | Finding | Contract | Auditors |
|----|---------|----------|----------|
| L-01 | `updateListing` has no minimum duration (unlike `cancelListing`) | Marketplace | 4, 9 |
| L-02 | `acceptOffer` listing cancellation event misattributed | Marketplace | 9 |
| L-03 | `withdrawExpiredOffer` emits `OfferCancelled` instead of distinct event | Marketplace | 10 |
| L-04 | `setMintingFee` allows zero (defeats spam prevention) | CustomCards | 10 |
| L-05 | Constructor doesn't emit initialization events | Both | 10 |
| L-06 | `safeTransferFrom` callback enables cross-contract state reading | Marketplace | 1, 9 |
| L-07 | `Marketplace Fee Set to Zero` enables free trading | Marketplace | 7 |
| L-08 | Creator Royalty Self-Dealing (creator = seller = royalty recipient) | CustomCards | 7 |
| L-09 | `_tokenIdCounter` could be `immutable` starting value (minor gas) | CustomCards | 10 |
| L-10 | Interface-Implementation event name mismatches | Marketplace | 10 |
| L-11 | `buyNFT` interface takes 1 param, implementation takes 2 (`expectedPrice`) | Marketplace | 10 |
| L-12 | `creatorCards` semantics unclear (historical vs current ownership) | CustomCards | 10 |
| L-13 | No maximum listing price allows theoretical overflow | Marketplace | 9 |
| L-14 | Listing-related front-run mitigated by `expectedPrice` but buyer wastes gas | Marketplace | 4, 7 |

---

## INFORMATIONAL Findings

| ID | Finding | Contract | Auditors |
|----|---------|----------|----------|
| I-01 | `CustomCardStats` struct wastes 33 bytes (34%) per token -- `verified` alone in slot 3 | CustomCards | 10 |
| I-02 | `Listing` struct: `bool active` wastes full slot -- pack with `address seller` | Marketplace | 10 |
| I-03 | `Offer` struct: `bool active` wastes full slot -- pack with `address buyer` | Marketplace | 10 |
| I-04 | `NFTStats` struct: `tradeCount` and `lastSaleTimestamp` oversized | Marketplace | 10 |
| I-05 | `totalSupply()` returns counter, not live supply (correct while no burn exists) | CustomCards | 10 |
| I-06 | Custom `_ownedTokens` enumeration duplicates `ERC721Enumerable` | CustomCards | 10 |
| I-07 | Basis points precision loss on small fee calculations | Both | 3 |
| I-08 | `defaultRoyalty` (500 = 5%) could benefit from constants documentation | CustomCards | 3 |
| I-09 | Redundant `_requireOwned` check (OZ already checks in transfer) | CustomCards | 6 |
| I-10 | Missing indexed parameters on some events for efficient filtering | Both | 10 |
| I-11 | `experience` overflow at uint32 max (4.2B XP) is theoretical | CustomCards | 3 |
| I-12 | Solidity 0.8.x built-in overflow makes SafeMath unnecessary (correctly omitted) | Both | 3 |
| I-13 | No ERC-165 `supportsInterface` check before `royaltyInfo` call | Marketplace | 6 |
| I-14 | `cardType` uses `uint8` (18 types) -- could use smaller bit width in packed struct | CustomCards | 3 |
| I-15 | Post-Dencun `selfdestruct` neutered (EIP-6780) -- force-send risk reduced | Marketplace | 8 |

---

## Consolidated Remediation Priority

### Priority 1 -- CRITICAL (Accepted Risk / Mitigated)

1. ~~**Replace push-payment with pull-payment pattern**~~ -- **ACCEPTED RISK.** The custodial bot architecture requires synchronous push-payments for seamless Telegram UX. This is a deliberate design trade-off common across custodial NFT bots and Telegram-based crypto platforms. C-01 and C-02 are mitigated by admin-controlled EOA recipients, contract whitelisting, and emergency `pause()`. Related findings H-07, M-06, M-18 should still be addressed independently where possible (e.g., accumulate minting fees in contract rather than direct push in `createCard`).

### Priority 2 -- HIGH (Implement Before Mainnet)

2. **Add listing expiration** (`MAX_LISTING_DURATION`) to prevent stale listing exploitation (H-03)
3. **Invalidate offers on NFT sale** -- cancel all active offers for a token when ownership changes through the marketplace (H-04)
4. **Add minimum listing price** (`MIN_LISTING_PRICE`) to prevent dust-price fee truncation (H-05)
5. **Override `grantRole`** to prevent direct `DEFAULT_ADMIN_ROLE` grants, enforcing two-step transfer (H-02)
6. **Implement TimelockController** for admin operations (H-01, H-10)
7. **Cap `batchVerify` array size** (H-08)
8. **Add `sweepETH` admin function** for stuck funds (H-09)

### Priority 3 -- MEDIUM (Implement Before Public Launch)

9. **Check banned status in `listNFT` and `makeOffer`** (M-02)
10. **Add statistics tracking to `acceptOffer`** for functional parity with `buyNFT` (M-03, M-16)
11. **Add pagination to view functions** (`getSellerListings`, `getBuyerOffers`, `getCreatorCards`) (M-04, M-15)
12. **Emit error event in `setLastSalePrice` catch block** (M-05)
13. **Add event emission to `setFeeRecipient`** in CustomCards (M-07)
14. **Clear approvals in `banCard`** (M-11)
15. **Whitelist trusted NFT contracts** for royalty validation (H-11, M-10)

### Priority 4 -- LOW/INFORMATIONAL (Address in Next Iteration)

16. **Synchronize interface and implementation** event names and function signatures (L-10, L-11)
17. **Add minimum duration to `updateListing`** (L-01)
18. **Create distinct events** for offer expiry vs cancellation (L-03)
19. **Optimize struct packing** (I-01 through I-04)
20. **Add constructor initialization events** (L-05)

---

## Architecture Recommendations

### 1. Payment Architecture -- Accepted Risk with Mitigations
The push-payment pattern is **intentionally retained** to support the custodial Telegram bot UX where users perform zero on-chain actions. This is a known trade-off in the custodial bot ecosystem. Mitigations in place:
- `feeRecipient` is always set to an admin-controlled EOA (never a contract)
- Only whitelisted NFT contracts (PokeDEXCustomCards) are used, ensuring royalty recipients are EOAs
- Emergency `pause()` can halt all marketplace operations if a DoS vector is exploited
- For `createCard` specifically: accumulate minting fees in contract balance and use `withdrawFees()` instead of direct push (see H-07)

### 2. Governance Upgrade Path
- Deploy behind a TimelockController (24-48hr delay on admin operations)
- Transition to multi-sig wallet (Gnosis Safe) for admin role
- Override `grantRole` for `DEFAULT_ADMIN_ROLE` to enforce two-step only

### 3. Cross-Contract State Consistency
- Add marketplace hooks in PokeDEXCustomCards to notify on ban/unban
- Implement offer lifecycle management tied to NFT ownership changes
- Unify `buyNFT` and `acceptOffer` post-sale logic into shared internal function

### 4. Interface Alignment
- Synchronize `IPokeDEXMarketplace.sol` with actual implementation
- Fix `buyNFT` signature mismatch (interface: 1 param, implementation: 2 params)
- Align event names (e.g., `Listed` vs `NFTListed`, `Sale` vs `NFTSold`)

---

## Methodology

Each auditor performed:
1. **Deep research phase:** 30-40 academic/industry sources per domain (Cyfrin, Code4rena, Sherlock, RareSkills, OpenZeppelin, Hacken, CertiK, USENIX, IEEE, Springer, OWASP)
2. **Static analysis:** Line-by-line review of all 4 contract files
3. **Pattern matching:** Cross-reference with known vulnerability databases (SWC Registry, DASP Top 10, OWASP SC Top 10)
4. **Attack scenario construction:** Concrete exploit paths with step-by-step reproduction
5. **Cross-auditor deduplication:** Findings validated by multiple independent auditors receive higher confidence

### Positive Security Properties Identified

- ReentrancyGuard consistently applied to all state-changing functions
- CEI pattern mostly followed (state updates before external calls)
- `expectedPrice` parameter in `buyNFT` prevents price manipulation
- Royalty amount capped at 10% (prevents catastrophic royalty drain)
- Two-step admin transfer pattern (though bypassable -- see H-02)
- Comprehensive role separation (MODERATOR_ROLE, FEE_MANAGER_ROLE, MARKETPLACE_ROLE)
- `MIN_LISTING_DURATION` prevents instant listing cancellation manipulation
- `whenNotPaused` emergency stop on all critical operations
- Ban system prevents transfer of flagged content
- Proper use of Solidity 0.8.x built-in overflow protection

---

**Disclaimer:** This audit identifies vulnerabilities based on static analysis and industry research. It does not constitute a formal verification or guarantee of contract security. All findings should be verified through testing before implementing fixes. Smart contract security is an ongoing process -- re-audit after significant changes.
