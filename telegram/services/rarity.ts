// =============================================================================
// SISTEMA RARITA' - Generazione stats e calcolo rarita' dinamica
// RARITY SYSTEM - Stats generation and dynamic rarity calculation
// =============================================================================
//
// Questo modulo implementa il cuore del sistema di gioco delle carte PokeDEX.
// Gestisce due aspetti fondamentali:
//
// This module implements the core of the PokeDEX card game system.
// It handles two fundamental aspects:
//
// 1. GENERAZIONE STATISTICHE (generateStatsForRarity):
//    Quando un utente crea una carta, le stats (HP, Attacco, Difesa, Velocità)
//    vengono generate casualmente entro limiti definiti dalla rarità. Una carta
//    Legendary avrà stats molto più alte di una Common, ma con variazione casuale
//    per rendere ogni carta unica. Il sistema usa un "budget di punti stat" —
//    ogni rarità ha un totale di punti da distribuire tra le 4 statistiche.
//
//    When a user creates a card, stats (HP, Attack, Defense, Speed) are randomly
//    generated within limits defined by the rarity. A Legendary card will have
//    much higher stats than a Common, but with random variation to make each card
//    unique. The system uses a "stat point budget" — each rarity has a total
//    of points to distribute among the 4 statistics.
//
// 2. RARITÀ DINAMICA (calculateDynamicRarityScore):
//    La rarità di una carta può cambiare nel tempo in base al comportamento del
//    mercato. Una carta molto scambiata, dal prezzo alto e creata da un artista
//    verificato avrà un punteggio di rarità più alto. Questo sistema premia le
//    carte che il mercato considera davvero rare e di valore.
//
//    A card's rarity can change over time based on market behavior. A frequently
//    traded card with a high price from a verified creator will have a higher
//    rarity score. This system rewards cards that the market considers truly
//    rare and valuable.
// =============================================================================

import { RARITY_STAT_CONFIGS, RARITY_WEIGHTS } from "../config.js";

// =============================================================================
// GENERAZIONE STATISTICHE BILANCIATE
// BALANCED STATS GENERATION
// =============================================================================
//
// Il sistema di generazione stats usa un approccio "budget based":
//   - Ogni livello di rarità ha un totalStatBudget (budget totale di punti)
//   - Ogni stat ha un minStat e maxStat (limiti per singola statistica)
//   - Il budget viene distribuito casualmente tra le 4 stats
//   - L'ultima stat riceve il residuo (per garantire che il totale sia rispettato)
//
// Esempio per rarità Common (ipotetico):
//   totalStatBudget = 200, minStat = 20, maxStat = 80
//   → HP=45, ATK=60, DEF=35, SPD=60 (totale = 200)
//
// Esempio per rarità Legendary (ipotetico):
//   totalStatBudget = 800, minStat = 150, maxStat = 255
//   → HP=220, ATK=190, DEF=200, SPD=190 (totale = 800)
//
// The stats generation system uses a "budget based" approach:
//   - Each rarity tier has a totalStatBudget (total point budget)
//   - Each stat has a minStat and maxStat (limits per individual statistic)
//   - The budget is distributed randomly among the 4 stats
//   - The last stat gets the remainder (to ensure the total is respected)
//
// Example for Common rarity (hypothetical):
//   totalStatBudget = 200, minStat = 20, maxStat = 80
//   → HP=45, ATK=60, DEF=35, SPD=60 (total = 200)
//
// Example for Legendary rarity (hypothetical):
//   totalStatBudget = 800, minStat = 150, maxStat = 255
//   → HP=220, ATK=190, DEF=200, SPD=190 (total = 800)
// =============================================================================

/**
 * Genera statistiche bilanciate in base al livello di rarita'.
 * Generates balanced stats based on rarity tier.
 *
 * L'algoritmo distribuisce un budget totale di punti stat tra HP, Attacco,
 * Difesa e Velocità. Per le prime 3 stats, genera un valore casuale tra il
 * minimo consentito e il massimo possibile (tenendo conto dei punti necessari
 * per le stats rimanenti). L'ultima stat riceve tutti i punti residui, ma
 * viene limitata tra minStat e maxStat per evitare valori estremi.
 *
 * The algorithm distributes a total stat point budget among HP, Attack,
 * Defense, and Speed. For the first 3 stats, it generates a random value
 * between the allowed minimum and the maximum possible (accounting for
 * points needed for remaining stats). The last stat gets all remaining
 * points, but is clamped between minStat and maxStat to avoid extreme values.
 *
 * Perché questo approccio? / Why this approach?
 *   - Budget garantisce che carte della stessa rarità siano comparabili in potenza
 *   - Casualità garantisce che ogni carta sia unica (non esistono due carte identiche)
 *   - Min/max per stat previene carte "degenerate" (es. tutto in ATK, 0 in DEF)
 *
 *   - Budget ensures cards of the same rarity are comparable in power
 *   - Randomness ensures each card is unique (no two identical cards)
 *   - Per-stat min/max prevents "degenerate" cards (e.g. all in ATK, 0 in DEF)
 *
 * @param rarity - Livello di rarita' (0=Common, 1=Uncommon, 2=Rare, 3=Ultra Rare, 4=Legendary) /
 *                 Rarity tier (0=Common, 1=Uncommon, 2=Rare, 3=Ultra Rare, 4=Legendary)
 * @returns Oggetto con le 4 statistiche generate / Object with the 4 generated stats
 */
export function generateStatsForRarity(rarity: number): { hp: number; attack: number; defense: number; speed: number } {
  // Recupera la configurazione per la rarità richiesta; se non esiste, usa Common (tier 0)
  // Get the config for the requested rarity; if it doesn't exist, use Common (tier 0)
  const config = RARITY_STAT_CONFIGS[rarity] || RARITY_STAT_CONFIGS[0];

  const stats = { hp: 0, attack: 0, defense: 0, speed: 0 };
  let remaining = config.totalStatBudget;  // Punti da distribuire / Points to distribute
  const statKeys: (keyof typeof stats)[] = ['hp', 'attack', 'defense', 'speed'];

  for (let i = 0; i < statKeys.length; i++) {
    const key = statKeys[i];
    const isLast = i === statKeys.length - 1;

    if (isLast) {
      // L'ultima stat riceve il residuo, limitato tra min e max
      // The last stat gets the remainder, clamped between min and max
      stats[key] = Math.min(Math.max(remaining, config.minStat), config.maxStat);
    } else {
      // Per le stats intermedie: calcola il range possibile
      // For intermediate stats: calculate the possible range
      const minForStat = config.minStat;
      // Il massimo è il minore tra maxStat e (punti rimanenti - minimo necessario per le stats successive)
      // The max is the lesser of maxStat and (remaining points - minimum needed for subsequent stats)
      const maxForStat = Math.min(
        config.maxStat,
        remaining - (config.minStat * (statKeys.length - i - 1))
      );
      // Genera un valore casuale nell'intervallo [min, max]
      // Generate a random value in the range [min, max]
      const value = Math.floor(minForStat + Math.random() * (maxForStat - minForStat));
      stats[key] = value;
      remaining -= value;  // Sottrai i punti usati dal budget rimanente / Subtract used points from remaining budget
    }
  }

  // Garanzia: HP deve essere almeno 1 (una carta con 0 HP non ha senso nel gioco)
  // Guarantee: HP must be at least 1 (a card with 0 HP makes no sense in the game)
  if (stats.hp < 1) stats.hp = Math.max(1, config.minStat);

  return stats;
}

// =============================================================================
// CALCOLO RARITA' DINAMICA
// DYNAMIC RARITY CALCULATION
// =============================================================================
//
// A differenza della rarità "statica" (Common/Rare/Legendary assegnata al minting),
// la rarità dinamica è un punteggio che cambia nel tempo basato su metriche reali.
// Questo crea un sistema dove le carte possono guadagnare o perdere valore in base
// a come il mercato le tratta — simile a come funziona il mondo dell'arte reale.
//
// Unlike "static" rarity (Common/Rare/Legendary assigned at minting), dynamic
// rarity is a score that changes over time based on real metrics. This creates
// a system where cards can gain or lose value based on how the market treats
// them — similar to how the real art world works.
//
// Il punteggio è composto da 5 componenti pesate:
//
// The score is composed of 5 weighted components:
//
//   COMPONENTE          | PESO | SPIEGAZIONE
//   COMPONENT           | WEIGHT | EXPLANATION
//   --------------------|--------|--------------------------------------------------
//   Price Score          | 30%   | Rapporto prezzo corrente / prezzo minimo
//                       |        | Current price / floor price ratio
//   --------------------|--------|--------------------------------------------------
//   Holder/Provenance   | 15%   | Quante volte è stata trasferita (più trasferimenti
//   Score               |        | = più collezionisti l'hanno voluta)
//                       |        | How many times it was transferred (more transfers
//                       |        | = more collectors wanted it)
//   --------------------|--------|--------------------------------------------------
//   Volume Score        | 25%   | Volume totale scambiato (in scala logaritmica per
//                       |        | normalizzare valori molto diversi)
//                       |        | Total traded volume (logarithmic scale to normalize
//                       |        | very different values)
//   --------------------|--------|--------------------------------------------------
//   Age Score           | 10%   | Età della carta + bonus se è "genesis" (prima serie)
//                       |        | Card age + bonus if it's "genesis" (first edition)
//   --------------------|--------|--------------------------------------------------
//   Creator Score       | 20%   | Reputazione del creatore (verificato, vendite totali,
//                       |        | numero di carte create)
//                       |        | Creator reputation (verified, total sales, number
//                       |        | of cards created)
// =============================================================================

/**
 * Calcola un punteggio di rarita' dinamico (0-100) basato su metriche di mercato.
 * Calculates a dynamic rarity score (0-100) based on market metrics.
 *
 * Il punteggio tiene conto di molteplici fattori per creare una valutazione
 * olistica della rarità di una carta. Ogni componente è normalizzata a un
 * punteggio 0-100, poi combinata con pesi configurabili (RARITY_WEIGHTS).
 *
 * The score accounts for multiple factors to create a holistic assessment
 * of a card's rarity. Each component is normalized to a 0-100 score,
 * then combined with configurable weights (RARITY_WEIGHTS).
 *
 * Nota: in una versione precedente, questo sistema includeva anche metriche di
 * battaglia (esperienza, vittorie, ecc.). Queste sono state rimosse per
 * semplificare il sistema e concentrarsi sulle metriche di mercato.
 *
 * Note: in a previous version, this system also included battle metrics
 * (experience, wins, etc.). These were removed to simplify the system
 * and focus on market metrics.
 *
 * @param inputs - Le metriche di mercato della carta / The card's market metrics
 * @param inputs.currentPriceEth - Prezzo corrente in ETH / Current price in ETH
 * @param inputs.floorPriceEth - Prezzo minimo della collezione / Collection floor price
 * @param inputs.totalVolumeEth - Volume totale scambiato in ETH / Total traded volume in ETH
 * @param inputs.transferCount - Numero di trasferimenti di proprietà / Number of ownership transfers
 * @param inputs.daysSinceMint - Giorni dalla creazione / Days since creation
 * @param inputs.isGenesis - Se la carta è della prima serie / Whether the card is from the first edition
 * @param inputs.creatorVerified - Se il creatore è verificato / Whether the creator is verified
 * @param inputs.creatorTotalSalesEth - Vendite totali del creatore in ETH / Creator's total sales in ETH
 * @param inputs.creatorCardCount - Numero totale di carte del creatore / Creator's total card count
 * @returns Punteggio di rarità 0-100 (100 = massima rarità) / Rarity score 0-100 (100 = maximum rarity)
 */
export function calculateDynamicRarityScore(inputs: {
  currentPriceEth: number;
  floorPriceEth: number;
  totalVolumeEth: number;
  transferCount: number;
  daysSinceMint: number;
  isGenesis: boolean;
  creatorVerified: boolean;
  creatorTotalSalesEth: number;
  creatorCardCount: number;
}): number {
  // ---------------------------------------------------------------------------
  // PRICE SCORE (30%) — Quanto vale la carta rispetto al "floor" della collezione
  // PRICE SCORE (30%) — How much the card is worth compared to the collection "floor"
  // ---------------------------------------------------------------------------
  // Il "floor price" è il prezzo della carta più economica nella collezione.
  // Se la nostra carta vale 5x il floor, è significativamente più preziosa.
  // Il punteggio massimo è 100, raggiunto con un rapporto di 5x (5 * 20 = 100).
  //
  // The "floor price" is the price of the cheapest card in the collection.
  // If our card is worth 5x the floor, it's significantly more valuable.
  // Maximum score is 100, reached at a ratio of 5x (5 * 20 = 100).
  const priceRatio = inputs.floorPriceEth > 0 ? inputs.currentPriceEth / inputs.floorPriceEth : 1;
  const priceScore = Math.min(100, priceRatio * 20);

  // ---------------------------------------------------------------------------
  // HOLDER/PROVENANCE SCORE (15%) — Quanti collezionisti hanno posseduto la carta
  // HOLDER/PROVENANCE SCORE (15%) — How many collectors have owned the card
  // ---------------------------------------------------------------------------
  // Ogni trasferimento vale 10 punti (max 100 con 10+ trasferimenti).
  // Molti trasferimenti indicano che la carta è richiesta e collezionabile.
  // Nel mondo dell'arte, la "provenienza" (storia dei proprietari) aumenta il valore.
  //
  // Each transfer is worth 10 points (max 100 with 10+ transfers).
  // Many transfers indicate the card is in demand and collectible.
  // In the art world, "provenance" (ownership history) increases value.
  const holderScore = Math.min(100, inputs.transferCount * 10);

  // ---------------------------------------------------------------------------
  // VOLUME SCORE (25%) — Volume totale scambiato della carta
  // VOLUME SCORE (25%) — Total traded volume of the card
  // ---------------------------------------------------------------------------
  // Usiamo log10 perché il volume può variare enormemente (da 0.001 a 1000+ ETH).
  // La scala logaritmica comprime questi valori in un range gestibile:
  //   log10(1+1) = 0.30 → score ≈ 7.5
  //   log10(10+1) = 1.04 → score ≈ 26
  //   log10(100+1) = 2.00 → score ≈ 50
  //   log10(10000+1) = 4.00 → score ≈ 100
  //
  // We use log10 because volume can vary enormously (from 0.001 to 1000+ ETH).
  // Logarithmic scale compresses these values into a manageable range:
  //   log10(1+1) = 0.30 → score ≈ 7.5
  //   log10(10+1) = 1.04 → score ≈ 26
  //   log10(100+1) = 2.00 → score ≈ 50
  //   log10(10000+1) = 4.00 → score ≈ 100
  const volumeScore = Math.min(100, Math.log10(inputs.totalVolumeEth + 1) * 25);

  // ---------------------------------------------------------------------------
  // AGE SCORE (10%) — Quanto è vecchia la carta + bonus per carte genesis
  // AGE SCORE (10%) — How old the card is + bonus for genesis cards
  // ---------------------------------------------------------------------------
  // Le carte più vecchie hanno più valore storico. Il punteggio base cresce
  // linearmente fino a 50 punti dopo 1 anno. Le carte "genesis" (prima serie)
  // ricevono 25 punti bonus — come le "first edition" nel mondo dei giochi di carte.
  //
  // Older cards have more historical value. The base score grows linearly
  // up to 50 points after 1 year. "Genesis" (first edition) cards get a
  // 25-point bonus — like "first edition" in the trading card world.
  const ageBase = Math.min(50, (inputs.daysSinceMint / 365) * 50);
  const ageScore = ageBase + (inputs.isGenesis ? 25 : 0);

  // ---------------------------------------------------------------------------
  // CREATOR SCORE (20%) — Reputazione e track record del creatore
  // CREATOR SCORE (20%) — Creator's reputation and track record
  // ---------------------------------------------------------------------------
  // Tre fattori contribuiscono alla reputazione del creatore:
  //   1. Verifica (30 punti): il creatore ha superato un processo di verifica
  //   2. Vendite totali (fino a 40 punti): basato su ETH totali venduti
  //   3. Numero carte create (fino a 30 punti): un creatore prolifico ha più esperienza
  //
  // Three factors contribute to the creator's reputation:
  //   1. Verification (30 points): the creator passed a verification process
  //   2. Total sales (up to 40 points): based on total ETH sold
  //   3. Card count (up to 30 points): a prolific creator has more experience
  const creatorScore =
    (inputs.creatorVerified ? 30 : 0) +
    Math.min(40, inputs.creatorTotalSalesEth / 10 * 40) +
    Math.min(30, (inputs.creatorCardCount / 100) * 30);

  // ---------------------------------------------------------------------------
  // TOTALE PESATO — Combinazione finale dei 5 punteggi
  // WEIGHTED TOTAL — Final combination of the 5 scores
  // ---------------------------------------------------------------------------
  // Ogni punteggio (0-100) viene moltiplicato per il suo peso (definito in config)
  // e diviso per 100, poi tutti vengono sommati. Il risultato è un numero 0-100.
  //
  // Each score (0-100) is multiplied by its weight (defined in config) and divided
  // by 100, then all are summed. The result is a number 0-100.
  return Math.round(
    (priceScore * RARITY_WEIGHTS.price / 100) +
    (holderScore * RARITY_WEIGHTS.holders / 100) +
    (volumeScore * RARITY_WEIGHTS.volume / 100) +
    (ageScore * RARITY_WEIGHTS.age / 100) +
    (creatorScore * RARITY_WEIGHTS.creator / 100)
  );
}

// =============================================================================
// CONVERSIONE PUNTEGGIO → LIVELLO DI RARITA'
// SCORE → RARITY TIER CONVERSION
// =============================================================================
//
// Il punteggio numerico 0-100 viene convertito in un livello discreto di rarità
// per la visualizzazione e la categorizzazione. I soglie sono:
//
// The numeric 0-100 score is converted to a discrete rarity tier for display
// and categorization. The thresholds are:
//
//   PUNTEGGIO / SCORE  |  LIVELLO / TIER     |  TIER ID
//   --------------------|---------------------|----------
//   0 - 30             |  Common             |  0
//   31 - 50            |  Uncommon           |  1
//   51 - 70            |  Rare               |  2
//   71 - 85            |  Ultra Rare         |  3
//   86 - 100           |  Legendary          |  4
//
// La distribuzione non è uniforme: è molto più facile essere Common che Legendary.
// Questo rispecchia i giochi di carte fisici dove le carte rare sono genuinamente rare.
//
// The distribution is not uniform: it's much easier to be Common than Legendary.
// This mirrors physical card games where rare cards are genuinely rare.
// =============================================================================

/**
 * Converte un punteggio (0-100) in un livello di rarita' (0-4).
 * Converts a score (0-100) into a rarity tier (0-4).
 *
 * Usata per tradurre il punteggio numerico della rarità dinamica in un livello
 * discreto che può essere usato per la visualizzazione (icone, colori, etichette)
 * e per l'interazione con lo smart contract (che accetta solo valori 0-4).
 *
 * Used to translate the numeric dynamic rarity score into a discrete tier
 * that can be used for display (icons, colors, labels) and for interaction
 * with the smart contract (which only accepts values 0-4).
 *
 * @param score - Punteggio di rarità 0-100 / Rarity score 0-100
 * @returns Livello di rarità 0-4 (0=Common, 4=Legendary) / Rarity tier 0-4 (0=Common, 4=Legendary)
 */
export function scoreToRarityTier(score: number): number {
  if (score >= 86) return 4; // Legendary — solo il top ~15% delle carte / only the top ~15% of cards
  if (score >= 71) return 3; // Ultra Rare — carte con forte domanda di mercato / cards with strong market demand
  if (score >= 51) return 2; // Rare — carte sopra la media / above-average cards
  if (score >= 31) return 1; // Uncommon — leggermente sopra il comune / slightly above common
  return 0;                  // Common — la maggior parte delle carte / the majority of cards
}
