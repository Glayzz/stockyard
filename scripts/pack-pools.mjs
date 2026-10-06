// Packs the scan result into data/pools.bin, small enough to ship in the repo, so a fresh
// deployment starts with every known stock pool instead of rescanning for 25 minutes.
// Each pool is 45 bytes: pair (20), coin (20), stock number in bsc-stock-tokens.csv (1), pair index (4).
// Usage: node scripts/pack-pools.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stockNo = new Map(readFileSync(root + 'data/bsc-stock-tokens.csv', 'utf8').trim().split('\n').slice(1).map((line, i) => ['0x' + line.split(',')[1], i]));

const base = JSON.parse(readFileSync(root + 'data/stock-pairs.json', 'utf8'));
const extra = existsSync(root + 'data/stock-pairs-new.json') ? JSON.parse(readFileSync(root + 'data/stock-pairs-new.json', 'utf8')) : null;
const pairs = extra && extra.scannedTo > base.scannedTo ? [...base.pairs, ...extra.pairs.filter((p) => p.index >= base.scannedTo)] : base.pairs;
const scannedTo = extra && extra.scannedTo > base.scannedTo ? extra.scannedTo : base.scannedTo;

// Pools where both sides are stock tokens are not stock memes and are left out.
const rows = pairs.filter((p) => !(p.stock0 && p.stock1));
const buf = Buffer.alloc(rows.length * 45);
rows.forEach((p, i) => {
  const stock = p.stock0 ? p.token0 : p.token1, coin = p.stock0 ? p.token1 : p.token0, o = i * 45;
  buf.write(p.pair.slice(2) + coin.slice(2), o, 'hex');
  buf.writeUInt8(stockNo.get(stock), o + 40);
  buf.writeUInt32BE(p.index, o + 41);
});
writeFileSync(root + 'data/pools.bin', buf);
writeFileSync(root + 'data/pools.json', JSON.stringify({ scannedFrom: base.scannedFrom, scannedTo, updatedAt: new Date().toISOString(), count: rows.length }, null, 1));
console.log(`Packed ${rows.length.toLocaleString()} pools into data/pools.bin (${(buf.length / 1e6).toFixed(1)} MB), scanned to pair ${scannedTo.toLocaleString()}.`);
