// =============================================================================
// SERVIZIO PREZZO ETH - Recupero prezzo ETH/USD da CoinGecko con cache
// ETH PRICE SERVICE - ETH/USD price fetching from CoinGecko with cache
// =============================================================================

let cachedPrice: { usd: number; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti / 5 minutes

/**
 * Recupera il prezzo corrente di ETH in USD da CoinGecko.
 * Fetches the current ETH price in USD from CoinGecko.
 *
 * Usa una cache locale di 5 minuti per evitare troppe richieste API.
 * Uses a 5-minute local cache to avoid excessive API requests.
 *
 * @returns Il prezzo in USD o null se non disponibile /
 *          The price in USD or null if unavailable
 */
export async function getEthPriceUSD(): Promise<number | null> {
  if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_TTL) {
    return cachedPrice.usd;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    );
    const data = (await res.json()) as { ethereum: { usd: number } };
    cachedPrice = { usd: data.ethereum.usd, timestamp: Date.now() };
    return cachedPrice.usd;
  } catch {
    return cachedPrice?.usd ?? null;
  }
}
