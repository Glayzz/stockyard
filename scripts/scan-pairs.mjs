// Walks PancakeSwap v2's on-chain pair list and records every pool that contains a tokenized stock.
// This is how Stockyard finds every stock meme, instead of trusting an aggregator's top-30 list.
//
// Usage: node scripts/scan-pairs.mjs            continue from where the last scan stopped
//        node scripts/scan-pairs.mjs 900000     start 900,000 pairs back from the newest
import { readFileSync, writeFileSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rpc, multicall, word, toAddr } from '../server/chain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const FACTORY = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';
const OUT = root + 'data/stock-pairs.json', BIN = root + 'data/pairs.bin';
const BATCH = 500, PARALLEL = 5;

const stocks = new Map(readFileSync(root + 'data/bsc-stock-tokens.csv', 'utf8').trim().split('\n').slice(1)
  .map((line) => { const [symbol, address] = line.split(','); return ['0x' + address, symbol]; }));

const total = parseInt(await rpc('eth_call', [{ to: FACTORY, data: '0x574f2ba3' }, 'latest']), 16);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const back = Number(process.argv[2]);
const from = back ? Math.max(0, total - back) : prev ? prev.scannedTo : Math.max(0, total - 900000);
const found = back || !prev ? [] : prev.pairs;
const scannedFrom = back || !prev ? from : prev.scannedFrom;
console.log(`PancakeSwap v2 has ${total.toLocaleString()} pairs. Scanning ${(total - from).toLocaleString()} from index ${from.toLocaleString()} against ${stocks.size} stock tokens.`);

// Every pair's two tokens are also kept in a local binary file (60 bytes per pair), so the scan
// can be re-matched against a longer stock list later without touching the chain again.
const bin = openSync(BIN, existsSync(BIN) && !back && prev ? 'r+' : 'w');
const binBase = scannedFrom;

const starts = [];
for (let i = from; i < total; i += BATCH) starts.push(i);
let next = 0, done = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (next < starts.length) {
    const s = starts[next++], n = Math.min(BATCH, total - s);
    const pairs = (await multicall(Array.from({ length: n }, (_, k) => [FACTORY, '1e3dd18b' + word(s + k)]))).map((r) => (r ? toAddr(r) : null));
    const toks = await multicall(pairs.flatMap((p) => [[p || FACTORY, '0dfe1681'], [p || FACTORY, 'd21220a7']]));
    const buf = Buffer.alloc(n * 60);
    for (let k = 0; k < n; k++) {
      if (!pairs[k] || !toks[2 * k] || !toks[2 * k + 1]) continue;
      const t0a = toAddr(toks[2 * k]), t1a = toAddr(toks[2 * k + 1]);
      buf.write(pairs[k].slice(2) + t0a.slice(2) + t1a.slice(2), k * 60, 'hex');
      const s0 = stocks.get(t0a), s1 = stocks.get(t1a);
      if (s0 || s1) found.push({ index: s + k, pair: pairs[k], token0: t0a, token1: t1a, stock0: s0 || null, stock1: s1 || null });
    }
    writeSync(bin, buf, 0, buf.length, (s - binBase) * 60);
    if (++done % 100 === 0 || done === starts.length)
      console.log(`${done}/${starts.length} batches, ${found.length} stock pools so far, ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}));
closeSync(bin);

found.sort((a, b) => a.index - b.index);
writeFileSync(OUT, JSON.stringify({ factory: FACTORY, scannedFrom, scannedTo: total, updatedAt: new Date().toISOString(), pairs: found }, null, 1));
const tally = {};
for (const f of found) for (const s of [f.stock0, f.stock1]) if (s) tally[s] = (tally[s] || 0) + 1;
console.log(`Done. ${found.length} pools contain a stock token. By stock:`, Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
