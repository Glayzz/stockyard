// Builds the league from the chain: every pool the scan found that pairs a coin with a tokenized
// stock, with balances, prices and market caps read on-chain through Multicall3. Binance's Market
// API then adds 24h volume, 24h change, holders and logos for the coins that make the default list.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { multicallAll, addrWord, word, toAddr, toNum, toText } from './chain.mjs';
import { bw3 } from './binance.mjs';
import { pairCount, scanRange } from './scan.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SCAN = root + 'data/stock-pairs.json', NEW = root + 'data/stock-pairs-new.json', PACK = root + 'data/pools.bin';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const DEAD = '0x000000000000000000000000000000000000dead';
const V2_FACTORY = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73', V3_FACTORY = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865';
const V3_FEES = [100, 500, 2500, 10000];
const MIN_MCAP = 100000, MIN_STOCK_USD = 1000, FULL_PASS_MS = 20 * 60000;
// Pools this recent are checked on every refresh, since a new coin can gain liquidity at any moment.
const WATCH_LAST = 8000;
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
  SKHY: 'SK Hynix',
};

// Binance's saved RWA list adds Chinese names and logos to the stock tokens it covers.
const rwa = existsSync(root + 'data/rwa-tokens.json')
  ? new Map(JSON.parse(readFileSync(root + 'data/rwa-tokens.json', 'utf8')).tokens.map((t) => [t.address, t])) : new Map();
export const stocks = readFileSync(root + 'data/bsc-stock-tokens.csv', 'utf8').trim().split('\n').slice(1).map((line) => {
  const [symbol, hex, ticker, type, multiplier] = line.split(',');
  const address = '0x' + hex, extra = rwa.get(address);
  return { symbol, address, ticker, name: NAMES[ticker] || ticker, nameZh: extra?.nameZh || null, logo: extra?.logo || null, type: Number(type), multiplier: Number(multiplier) };
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

// What stays in memory between builds.
const S = { mtime: 0, scan: null, pools: [], extra: [], live: null, fullAt: 0, coins: new Map(), market: new Map(), logos: new Map() };
const toPool = (p) => (p.stock0 ? { pair: p.pair, index: p.index, stock: p.token0, coin: p.token1 } : { pair: p.pair, index: p.index, stock: p.token1, coin: p.token0 });
const isMeme = (p) => !stockByAddr.has(p.coin) && !CASH.has(p.coin);

function loadScan() {
  // The full scan output if this machine has run one; otherwise the packed copy shipped in the repo.
  const full = existsSync(SCAN), file = full ? SCAN : PACK;
  if (!existsSync(file)) throw new Error('No pool list. Run: node scripts/scan-pairs.mjs');
  const mtime = statSync(file).mtimeMs;
  if (mtime === S.mtime) return;
  let scannedTo;
  if (full) {
    const scan = JSON.parse(readFileSync(SCAN, 'utf8'));
    S.pools = scan.pairs.map(toPool).filter(isMeme);
    S.scan = { from: scan.scannedFrom, to: scan.scannedTo, at: scan.updatedAt };
    scannedTo = scan.scannedTo;
  } else {
    // 45 bytes per pool: pair, coin, stock number, pair index.
    const meta = JSON.parse(readFileSync(root + 'data/pools.json', 'utf8')), buf = readFileSync(PACK);
    S.pools = [];
    for (let o = 0; o + 45 <= buf.length; o += 45) {
      const p = { pair: '0x' + buf.toString('hex', o, o + 20), coin: '0x' + buf.toString('hex', o + 20, o + 40), stock: stocks[buf.readUInt8(o + 40)].address, index: buf.readUInt32BE(o + 41) };
      if (isMeme(p)) S.pools.push(p);
    }
    S.scan = { from: meta.scannedFrom, to: meta.scannedTo, at: meta.updatedAt };
    scannedTo = meta.scannedTo;
  }
  // Pools found by rescans since then live in a small side file.
  S.extra = [];
  if (existsSync(NEW)) {
    const extra = JSON.parse(readFileSync(NEW, 'utf8'));
    if (extra.scannedTo > scannedTo) {
      S.extra = extra.pairs.filter((p) => p.index >= scannedTo);
      S.pools.push(...S.extra.map(toPool).filter(isMeme));
      S.scan.to = extra.scannedTo; S.scan.at = extra.updatedAt;
    }
  }
  S.mtime = mtime; S.live = null;
}

// Checks the pairs created since the last look and adds any that contain a stock token.
let rescanning = null;
export function rescan() {
  rescanning ??= (async () => {
    loadScan();
    const total = await pairCount();
    if (total <= S.scan.to) return 0;
    const found = await scanRange(S.scan.to, total, new Map(stocks.map((s) => [s.address, s.symbol])), { parallel: 3 });
    S.extra.push(...found);
    S.pools.push(...found.map(toPool).filter(isMeme));
    S.scan.to = total; S.scan.at = new Date().toISOString();
    writeFileSync(NEW, JSON.stringify({ scannedTo: total, updatedAt: S.scan.at, pairs: S.extra }));
    return found.length;
  })().finally(() => { rescanning = null; });
  return rescanning;
}

// The slow pass: which of the 200,000-odd pools hold any stock at all. Runs every 20 minutes.
async function fullPass(prices) {
  const held = await multicallAll(S.pools.map((p) => [p.stock, '70a08231' + addrWord(p.pair)]));
  S.live = S.pools.filter((p, i) => (held[i] ? toNum(held[i]) : 0) * (prices[stockByAddr.get(p.stock).symbol]?.price || 0) >= 50);
  S.fullAt = Date.now();
}

// Binance Market API extras for the coins on the default list. Left as they were if Binance is unreachable.
async function enrich(rows) {
  const listed = rows.filter((r) => r.mcap >= MIN_MCAP && r.stockUsd >= MIN_STOCK_USD);
  try {
    for (let i = 0; i < listed.length; i += 50) {
      const data = await bw3('/api/v1/dex/market/price-info', {
        method: 'POST', body: listed.slice(i, i + 50).map((r) => ({ binanceChainId: '56', tokenContractAddress: r.address })),
      });
      for (const x of data || [])
        S.market.set(x.tokenContractAddress.toLowerCase(), { vol24: Number(x.volume24H) || 0, change24: Number(x.priceChange24H) / 100 || 0, holders: x.holders ?? null });
    }
    // Logos never change, so each coin is asked for once; a few per build keeps under the rate limit.
    for (const r of listed.filter((r) => !S.logos.has(r.address)).slice(0, 25)) {
      const info = await bw3('/api/v1/dex/market/token/basic-info', { method: 'POST', params: { binanceChainId: '56', tokenContractAddress: r.address }, body: {} });
      S.logos.set(r.address, info?.tokenLogoUrl || null);
      await new Promise((res) => setTimeout(res, 220));
    }
  } catch { /* keep whatever was fetched before */ }
  for (const r of rows) Object.assign(r, S.market.get(r.address), S.logos.has(r.address) ? { logo: S.logos.get(r.address) } : null);
}

async function build() {
  loadScan();
  const prices = await stockPrices();
  if (!S.live || Date.now() - S.fullAt > FULL_PASS_MS) await fullPass(prices);

  // Pools that hold stock, plus the newest pools, which may have gained liquidity since the slow pass.
  const seen = new Set(S.live.map((p) => p.pair));
  const targets = S.live.concat(S.pools.filter((p) => p.index >= S.scan.to - WATCH_LAST && !seen.has(p.pair)));

  // Symbol, name and decimals are read once per coin.
  const fresh = targets.filter((p) => !S.coins.has(p.coin));
  const meta = await multicallAll(fresh.flatMap((p) => [[p.coin, '313ce567'], [p.coin, '95d89b41'], [p.coin, '06fdde03']]));
  fresh.forEach((p, i) => S.coins.set(p.coin, {
    decimals: meta[3 * i] ? parseInt(meta[3 * i].slice(0, 64), 16) : 18, symbol: toText(meta[3 * i + 1]) || '?', name: toText(meta[3 * i + 2]),
  }));

  const bal = await multicallAll(targets.flatMap((p) => [
    [p.stock, '70a08231' + addrWord(p.pair)], [p.coin, '70a08231' + addrWord(p.pair)], [p.coin, '18160ddd'], [p.coin, '70a08231' + addrWord(DEAD)],
  ]));
  const rows = [];
  targets.forEach((p, i) => {
    const s = stockByAddr.get(p.stock), c = S.coins.get(p.coin), [inStock, inCoin, supply, burned] = bal.slice(4 * i, 4 * i + 4);
    const shares = inStock ? toNum(inStock) : 0, stockUsd = shares * (prices[s.symbol]?.price || 0);
    const coinInPool = inCoin ? toNum(inCoin, c.decimals) : 0;
    if (stockUsd < 50 || !coinInPool) return;
    const price = stockUsd / coinInPool, total = supply ? toNum(supply, c.decimals) : 0, dead = burned ? toNum(burned, c.decimals) : 0;
    rows.push({
      coin: c.symbol, coinName: c.name, decimals: c.decimals, address: p.coin, pair: p.pair, index: p.index,
      sym: s.symbol, name: s.name, ticker: s.ticker, stock: p.stock,
      shares, stockUsd, coinInPool, price, mcap: price * Math.max(0, total - dead),
    });
  });
  rows.sort((a, b) => b.stockUsd - a.stockUsd);
  await enrich(rows);

  return {
    updatedAt: new Date().toISOString(),
    scan: { ...S.scan },
    stats: {
      poolsFound: S.pools.length, holdingStock: rows.length, over100k: rows.filter((r) => r.mcap >= MIN_MCAP && r.stockUsd >= MIN_STOCK_USD).length,
      stockUsd: rows.reduce((a, r) => a + r.stockUsd, 0),
    },
    stocks: Object.fromEntries(stocks.map((s) => [s.symbol, { address: s.address, name: s.name, nameZh: s.nameZh, ticker: s.ticker, logo: s.logo, price: prices[s.symbol]?.price || null }])),
    rows,
  };
}

let cache = null, building = null;

// The league is rebuilt at most once every `maxAgeMs`; callers in between get the cached copy.
export async function league(maxAgeMs = 120000) {
  if (cache && Date.now() - Date.parse(cache.updatedAt) < maxAgeMs) return cache;
  building ??= build().then((v) => { cache = v; return v; }).finally(() => { building = null; });
  return cache || building;
}
