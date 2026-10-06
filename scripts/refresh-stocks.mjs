// Saves Binance's RWA token list for BNB Chain (names, Chinese names, logos, issuer) to
// data/rwa-tokens.json, so the app still knows every stock token when Binance is unreachable.
// Usage: node scripts/refresh-stocks.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bw3 } from '../server/binance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(root + '.env');

const list = await bw3('/api/v1/dex/market/rwa/tokens', { params: { binanceChainId: '56' } });
const tokens = list.map((t) => ({
  symbol: t.tokenSymbol, address: t.tokenContractAddress.toLowerCase(), issuer: t.platformId, ticker: t.underlyingTicker,
  name: t.underlyingName, nameZh: t.underlyingNameZh, logo: t.tokenLogoUrl, ratio: Number(t.tokenToShareRatio),
}));
writeFileSync(root + 'data/rwa-tokens.json', JSON.stringify({ source: 'Binance Web3 API /api/v1/dex/market/rwa/tokens', fetchedAt: new Date().toISOString(), tokens }, null, 1));
const by = {};
for (const t of tokens) by[t.issuer] = (by[t.issuer] || 0) + 1;
console.log(`Saved ${tokens.length} tokens:`, JSON.stringify(by));
