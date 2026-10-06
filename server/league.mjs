// Builds the league from the chain: every pool the scan found that pairs a coin with a tokenized
// stock, with balances, prices and market caps read on-chain through Multicall3.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { multicallAll, addrWord, word, toAddr, toNum, toText } from './chain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const DEAD = '0x000000000000000000000000000000000000dead';
const V2_FACTORY = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73', V3_FACTORY = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865';
const V3_FEES = [100, 500, 2500, 10000];
// Tokens that are money, not memes: a stock/USDT pool is not a stock meme.
const CASH = new Set([
  USDT, '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
]);
const NAMES = {
  SPY: 'S&P 500', QQQ: 'Nasdaq 100', SPCX: 'SpaceX', AAPL: 'Apple', NVDA: 'Nvidia', TSLA: 'Tesla', BABA: 'Alibaba', GOOGL: 'Google',
  MSFT: 'Microsoft', NFLX: 'Netflix', MSTR: 'Strategy', AMZN: 'Amazon', HOOD: 'Robinhood', CRCL: 'Circle', META: 'Meta', INTC: 'Intel',
  SNDK: 'Sandisk', TSM: 'TSMC', BNC: 'BNC', COIN: 'Coinbase', AMD: 'AMD', MU: 'Micron', PLTR: 'Palantir', GME: 'GameStop', AMC: 'AMC',
  OPENAI: 'OpenAI', POLYMARKET: 'Polymarket', KLSH: 'Kalshi', TQQQ: 'Nasdaq 3x', SQQQ: 'Nasdaq -3x', ORCL: 'Oracle', AVGO: 'Broadcom',
  PYPL: 'PayPal', IBM: 'IBM', ARM: 'Arm', DELL: 'Dell', ADBE: 'Adobe', CRM: 'Salesforce', PDD: 'PDD', DJT: 'Trump Media', RDDT: 'Reddit',
  EWY: 'South Korea ETF', QCOM: 'Qualcomm', GS: 'Goldman Sachs', ASML: 'ASML', SMCI: 'Supermicro', MRNA: 'Moderna', HIMS: 'Hims & Hers',
};

export const stocks = readFileSync(root + 'data/bsc-stock-tokens.csv', 'utf8').trim().split('\n').slice(1).map((line) => {
  const [symbol, address, ticker, type, multiplier] = line.split(',');
  return { symbol, address: '0x' + address, ticker, name: NAMES[ticker] || ticker, type: Number(type), multiplier: Number(multiplier) };
});
const stockByAddr = new Map(stocks.map((s) => [s.address, s]));

// Dollar price of each stock token from its deepest USDT pool on PancakeSwap (v3 fee tiers, then v2).
export async function stockPrices() {
  const pools = await multicallAll(stocks.flatMap((s) => [
    ...V3_FEES.map((fee) => [V3_FACTORY, '1698ee82' + addrWord(s.address) + addrWord(USDT) + word(fee)]),
    [V2_FACTORY, 'e6a43905' + addrWord(s.address) + addrWord(USDT)],
  ]));
  const per = V3_FEES.length + 1;
  const cands = [];
  stocks.forEach((s, i) => {
    for (let k = 0; k < per; k++) {
      const pool = pools[i * per + k] ? toAddr(pools[i * per + k]) : null;
      if (pool && !/^0x0+$/.test(pool)) cands.push({ s, pool, v3: k < V3_FEES.length });
    }
  });
  const data = await multicallAll(cands.flatMap((c) => [
    [USDT, '70a08231' + addrWord(c.pool)], [c.s.address, '70a08231' + addrWord(c.pool)], [c.pool, c.v3 ? '3850c7bd' : '0902f1ac'],
  ]));
  const best = {};
  cands.forEach((c, i) => {
    const usdt = data[3 * i] ? toNum(data[3 * i]) : 0, held = data[3 * i + 1] ? toNum(data[3 * i + 1]) : 0, state = data[3 * i + 2];
    if (usdt < 500 || !held || !state) return;
    let price;
    if (c.v3) {
      // slot0.sqrtPriceX96 gives token1 per token0; flip when the stock is token1.
      const sqrt = Number(BigInt('0x' + state.slice(0, 64))) / 2 ** 96, ratio = sqrt * sqrt;
      price = c.s.address < USDT ? ratio : 1 / ratio;
    } else {
      price = usdt / held;
    }
    if (!best[c.s.symbol] || usdt > best[c.s.symbol].usdt) best[c.s.symbol] = { price, usdt, pool: c.pool };
  });
  return best;
}

let cache = null, building = null;

async function build() {
  const file = root + 'data/stock-pairs.json';
  if (!existsSync(file)) throw new Error('No scan yet. Run: node scripts/scan-pairs.mjs');
  const scan = JSON.parse(readFileSync(file, 'utf8'));
  const prices = await stockPrices();
  const pools = scan.pairs
    .map((p) => (p.stock0 ? { pair: p.pair, index: p.index, stock: p.token0, coin: p.token1 } : { pair: p.pair, index: p.index, stock: p.token1, coin: p.token0 }))
    .filter((p) => !stockByAddr.has(p.coin) && !CASH.has(p.coin));

  // 1. How much stock sits in every pool the scan found.
  const held = await multicallAll(pools.map((p) => [p.stock, '70a08231' + addrWord(p.pair)]));
  const live = [];
  pools.forEach((p, i) => {
    const s = stockByAddr.get(p.stock), shares = held[i] ? toNum(held[i]) : 0, price = prices[s.symbol]?.price || 0;
    if (shares * price >= 50) live.push({ ...p, s, shares, stockUsd: shares * price });
  });

  // 2. Coin details for the pools that hold stock.
  const info = await multicallAll(live.flatMap((p) => [
    [p.coin, '70a08231' + addrWord(p.pair)], [p.coin, '18160ddd'], [p.coin, '313ce567'],
    [p.coin, '95d89b41'], [p.coin, '06fdde03'], [p.coin, '70a08231' + addrWord(DEAD)],
  ]));
  const rows = live.map((p, i) => {
    const [inPool, supply, dec, sym, name, burned] = info.slice(6 * i, 6 * i + 6);
    const decimals = dec ? parseInt(dec.slice(0, 64), 16) : 18;
    const coinInPool = inPool ? toNum(inPool, decimals) : 0, total = supply ? toNum(supply, decimals) : 0, dead = burned ? toNum(burned, decimals) : 0;
    const price = coinInPool ? p.stockUsd / coinInPool : 0;
    return {
      coin: toText(sym) || '?', coinName: toText(name), address: p.coin, pair: p.pair, index: p.index,
      sym: p.s.symbol, name: p.s.name, ticker: p.s.ticker, stock: p.stock,
      shares: p.shares, stockUsd: p.stockUsd, coinInPool, price, mcap: price * Math.max(0, total - dead),
    };
  }).filter((r) => r.price > 0).sort((a, b) => b.stockUsd - a.stockUsd);

  return {
    updatedAt: new Date().toISOString(),
    scan: { from: scan.scannedFrom, to: scan.scannedTo, at: scan.updatedAt },
    stats: {
      poolsFound: pools.length, holdingStock: rows.length, over100k: rows.filter((r) => r.mcap >= 100000).length,
      stockUsd: rows.reduce((a, r) => a + r.stockUsd, 0),
    },
    stocks: Object.fromEntries(stocks.map((s) => [s.symbol, { address: s.address, name: s.name, ticker: s.ticker, price: prices[s.symbol]?.price || null }])),
    rows,
  };
}

// The league is rebuilt at most once every `maxAgeMs`; callers in between get the cached copy.
export async function league(maxAgeMs = 120000) {
  if (cache && Date.now() - Date.parse(cache.updatedAt) < maxAgeMs) return cache;
  building ??= build().then((v) => { cache = v; return v; }).finally(() => { building = null; });
  return cache || building;
}
