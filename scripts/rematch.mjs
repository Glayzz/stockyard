// Re-matches the saved pair list (data/pairs.bin, written by scan-pairs.mjs) against the current
// stock list, without touching the chain. Run it after the stock list grows, e.g. when Ondo
// tokens were added. Pairs created after that scan are picked up by the server's own rescan.
// Usage: node scripts/rematch.mjs
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stocks } from '../server/league.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = root + 'data/stock-pairs.json', NEW = root + 'data/stock-pairs-new.json';
const base = JSON.parse(readFileSync(OUT, 'utf8'));
const bin = readFileSync(root + 'data/pairs.bin');
const bySymbol = new Map(stocks.map((s) => [s.address.slice(2), s.symbol]));

const pairs = [], tally = {};
for (let o = 0, i = 0; o + 60 <= bin.length; o += 60, i++) {
  const t0 = bin.toString('hex', o + 20, o + 40), t1 = bin.toString('hex', o + 40, o + 60);
  const stock0 = bySymbol.get(t0) || null, stock1 = bySymbol.get(t1) || null;
  if (!stock0 && !stock1) continue;
  pairs.push({ index: base.scannedFrom + i, pair: '0x' + bin.toString('hex', o, o + 20), token0: '0x' + t0, token1: '0x' + t1, stock0, stock1 });
  for (const s of [stock0, stock1]) if (s) tally[s] = (tally[s] || 0) + 1;
}
const scannedTo = base.scannedFrom + bin.length / 60;
writeFileSync(OUT, JSON.stringify({ factory: base.factory, scannedFrom: base.scannedFrom, scannedTo, updatedAt: new Date().toISOString(), pairs }, null, 1));
// The side file only knew the old stock list, so drop it and let the server rescan from scannedTo.
if (existsSync(NEW)) rmSync(NEW);
console.log(`${pairs.length.toLocaleString()} pools contain one of ${stocks.length} stock tokens (was ${base.pairs.length.toLocaleString()}). Scanned pairs ${base.scannedFrom.toLocaleString()} to ${scannedTo.toLocaleString()}.`);
console.log('Top:', Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + ' ' + v).join(', '));
