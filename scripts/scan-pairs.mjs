// Walks PancakeSwap v2's on-chain pair list and records every pool that contains a tokenized stock.
// This is how Stockyard finds every stock meme, instead of trusting an aggregator's top-30 list.
// The running server keeps this up to date by itself; this script is the first, long backfill.
//
// Usage: node scripts/scan-pairs.mjs            continue from where the last scan stopped
//        node scripts/scan-pairs.mjs 900000     start 900,000 pairs back from the newest
import { readFileSync, writeFileSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FACTORY, pairCount, scanRange } from '../server/scan.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = root + 'data/stock-pairs.json', BIN = root + 'data/pairs.bin';

const stocks = new Map(readFileSync(root + 'data/bsc-stock-tokens.csv', 'utf8').trim().split('\n').slice(1)
  .map((line) => { const [symbol, address] = line.split(','); return ['0x' + address, symbol]; }));

const total = await pairCount();
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const back = Number(process.argv[2]);
const from = back ? Math.max(0, total - back) : prev ? prev.scannedTo : Math.max(0, total - 900000);
const kept = back || !prev ? [] : prev.pairs;
const scannedFrom = back || !prev ? from : prev.scannedFrom;
console.log(`PancakeSwap v2 has ${total.toLocaleString()} pairs. Scanning ${(total - from).toLocaleString()} from index ${from.toLocaleString()} against ${stocks.size} stock tokens.`);

// Every pair's two tokens are also kept in a local binary file (60 bytes per pair), so the scan
// can be re-matched against a longer stock list later without touching the chain again.
const bin = openSync(BIN, existsSync(BIN) && !back && prev ? 'r+' : 'w');
let done = 0;
const batches = Math.ceil((total - from) / 500), t0 = Date.now();
const found = await scanRange(from, total, stocks, {
  parallel: 5,
  onBatch(rows, start) {
    const buf = Buffer.alloc(rows.length * 60);
    rows.forEach((r, k) => { if (r) buf.write(r.pair.slice(2) + r.token0.slice(2) + r.token1.slice(2), k * 60, 'hex'); });
    writeSync(bin, buf, 0, buf.length, (start - scannedFrom) * 60);
    if (++done % 100 === 0 || done === batches) console.log(`${done}/${batches} batches, ${Math.round((Date.now() - t0) / 1000)}s`);
  },
});
closeSync(bin);

const pairs = [...kept, ...found];
writeFileSync(OUT, JSON.stringify({ factory: FACTORY, scannedFrom, scannedTo: total, updatedAt: new Date().toISOString(), pairs }, null, 1));
const tally = {};
for (const f of pairs) for (const s of [f.stock0, f.stock1]) if (s) tally[s] = (tally[s] || 0) + 1;
console.log(`Done. ${pairs.length} pools contain a stock token. By stock:`, Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
