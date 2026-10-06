// Reading PancakeSwap v2's pair list on-chain. Shared by the one-off backfill script and the
// server's rescan, which picks up pools created since the last look.
import { rpc, multicall, word, toAddr } from './chain.mjs';

export const FACTORY = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';

export const pairCount = async () => parseInt(await rpc('eth_call', [{ to: FACTORY, data: '0x574f2ba3' }, 'latest']), 16);

// Pairs [start, start + n): each row is { index, pair, token0, token1 }, or null where a read failed.
export async function readPairs(start, n) {
  const pairs = (await multicall(Array.from({ length: n }, (_, k) => [FACTORY, '1e3dd18b' + word(start + k)]))).map((r) => (r ? toAddr(r) : null));
  const toks = await multicall(pairs.flatMap((p) => [[p || FACTORY, '0dfe1681'], [p || FACTORY, 'd21220a7']]));
  return pairs.map((pair, k) => (pair && toks[2 * k] && toks[2 * k + 1]
    ? { index: start + k, pair, token0: toAddr(toks[2 * k]), token1: toAddr(toks[2 * k + 1]) } : null));
}

// Scans [from, to) and returns the pools where either side is in `stocks` (address -> symbol).
// onBatch(rows, start) sees every batch, matched or not.
export async function scanRange(from, to, stocks, { batch = 500, parallel = 4, onBatch } = {}) {
  const starts = [];
  for (let i = from; i < to; i += batch) starts.push(i);
  const found = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, starts.length) }, async () => {
    while (next < starts.length) {
      const s = starts[next++];
      const rows = await readPairs(s, Math.min(batch, to - s));
      for (const r of rows) {
        if (!r) continue;
        const stock0 = stocks.get(r.token0) || null, stock1 = stocks.get(r.token1) || null;
        if (stock0 || stock1) found.push({ ...r, stock0, stock1 });
      }
      onBatch?.(rows, s);
    }
  }));
  return found.sort((a, b) => a.index - b.index);
}
