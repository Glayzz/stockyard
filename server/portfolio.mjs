// A wallet's portfolio: the stock memes it holds, the tokenized stock it holds, and its cash, all
// read from BNB Chain. Binance's Market API adds the 24h change of each holding.
//
// A meme is valued twice. `mark` is balance times the pool price, the number every tracker shows.
// `value` is what the coin's own pool would pay for the whole holding today, which is the number
// a holder can act on: for a small holder the two agree, for a whale in a thin pool they do not.
import { league } from './league.mjs';
import { stockLines } from './payslip.mjs';
import { bw3 } from './binance.mjs';
import { multicallAll, rpc, addrWord, toNum } from './chain.mjs';

const USDT = '0x55d398326f99059ff775485246999027b3197955', WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
// PancakeSwap's USDT/BNB pool, read for the price of BNB.
const BNB_POOL = '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae';
// Dollar tokens, counted at one dollar each. All have 18 decimals on BNB Chain.
const DOLLARS = [
  ['USDT', USDT], ['USDC', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'], ['U', '0xce24439f2d9c6a2289f741120fe202248b666666'],
  ['USD1', '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d'], ['FDUSD', '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409'],
];
const DUST = 0.01, CHANGES_ASKED = 50;
const balanceOf = (who) => '70a08231' + addrWord(who);
const cache = new Map(), asking = new Map();

// One row per coin: its deepest stock pool. Worked out once per league build.
let coinsFor = null, coins = [];
function coinsOf(lg) {
  if (coinsFor === lg.updatedAt) return coins;
  const best = new Map();
  for (const r of lg.rows) { const b = best.get(r.address); if (!b || r.stockUsd > b.stockUsd) best.set(r.address, r); }
  coinsFor = lg.updatedAt; coins = [...best.values()];
  return coins;
}

// Selling x coins into a pool holding C coins and S dollars of stock pays S·x/(C+x), before the
// coin's own tax. That is the most the pool can give for the holding, however the price reads.
const poolPays = (r, balance) => r.stockUsd * balance / (r.coinInPool + balance);

async function memeLines(wallet, lg) {
  const list = coinsOf(lg);
  const bal = await multicallAll(list.map((r) => [r.address, balanceOf(wallet)]));
  return list.map((r, i) => {
    const balance = bal[i] ? toNum(bal[i], r.decimals ?? 18) : 0;
    return balance > 0 ? {
      coin: r.coin, name: r.coinName, address: r.address, logo: r.logo || null, balance, price: r.price,
      mark: balance * r.price, value: poolPays(r, balance), change24: r.change24 ?? null,
      sym: r.sym, stock: r.name, stockZh: r.nameZh, ticker: r.ticker, stockToken: r.stock,
      poolUsd: r.stockUsd, mcap: r.mcap, listed: r.mcap >= 100000 && r.stockUsd >= 1000,
      // A balance larger than the coin's whole supply is a broken or dishonest token. It is listed
      // but never counted.
      odd: r.price > 0 && balance > (r.mcap / r.price) * 1.001,
    } : null;
  }).filter((m) => m && m.value >= DUST).sort((a, b) => b.value - a.value);
}

async function cashLines(wallet) {
  const [bnb, read] = await Promise.all([
    rpc('eth_getBalance', [wallet, 'latest']),
    multicallAll([[USDT, balanceOf(BNB_POOL)], [WBNB, balanceOf(BNB_POOL)], ...DOLLARS.map(([, token]) => [token, balanceOf(wallet)])]),
  ]);
  const bnbPrice = read[0] && read[1] ? toNum(read[0]) / toNum(read[1]) : 0, held = Number(BigInt(bnb)) / 1e18;
  const lines = [{ symbol: 'BNB', address: WBNB, balance: held, price: bnbPrice, value: held * bnbPrice, change24: null }];
  DOLLARS.forEach(([symbol, address], i) => {
    const balance = read[i + 2] ? toNum(read[i + 2]) : 0;
    lines.push({ symbol, address, balance, price: 1, value: balance, change24: 0 });
  });
  return lines.filter((c) => c.value >= DUST).sort((a, b) => b.value - a.value);
}

// The 24h change of the largest holdings, in one call. Without it the portfolio still shows.
async function addChanges(memes, stocks, cash) {
  const want = [...stocks, ...memes.filter((m) => m.change24 == null), ...cash.filter((c) => c.symbol === 'BNB')]
    .sort((a, b) => b.value - a.value).slice(0, CHANGES_ASKED);
  if (!want.length) return true;
  try {
    const data = await bw3('/api/v1/dex/market/price-info', { method: 'POST', body: want.map((h) => ({ binanceChainId: '56', tokenContractAddress: h.address })) });
    const by = new Map((data || []).map((x) => [x.tokenContractAddress.toLowerCase(), x]));
    for (const h of want) {
      const x = by.get(h.address.toLowerCase());
      if (x && x.priceChange24H != null && x.priceChange24H !== '') h.change24 = Number(x.priceChange24H) / 100;
    }
    return true;
  } catch { return false; }
}

// Reading a wallet takes a few thousand chain reads. No more than two wallets are read at once and
// the rest wait their turn, so a burst of visitors cannot starve the league or the trade page.
const AT_ONCE = 2, waiting = [];
let reading = 0;
async function inTurn(work) {
  if (reading >= AT_ONCE) await new Promise((go) => waiting.push(go)); else reading++;
  // A finished read hands its place straight to the next in line.
  try { return await work(); } finally { const next = waiting.shift(); if (next) next(); else reading--; }
}

export async function portfolio(input) {
  const wallet = input.toLowerCase();
  const hit = cache.get(wallet);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  if (!asking.has(wallet)) asking.set(wallet, inTurn(() => build(wallet)).finally(() => asking.delete(wallet)));
  return asking.get(wallet);
}

async function build(wallet) {
  const lg = await league();
  const [held, lines, cash] = await Promise.all([memeLines(wallet, lg), stockLines(wallet, lg), cashLines(wallet)]);
  const memes = held.filter((m) => !m.odd), odd = held.filter((m) => m.odd).map((m) => ({ coin: m.coin, address: m.address, balance: m.balance }));
  const stocks = lines.map((l) => {
    const s = lg.stocks[l.sym] || {};
    return {
      sym: l.sym, name: l.name, nameZh: l.nameZh, ticker: s.ticker || l.sym, issuer: s.issuer || null, logo: s.logo || null, address: l.address,
      shares: l.shares, raw: l.raw, price: l.price, value: l.value, change24: null,
      // The memes this wallet holds that trade against this stock.
      via: memes.filter((m) => m.sym === l.sym).slice(0, 3).map((m) => ({ coin: m.coin, address: m.address })),
    };
  });
  const changes = await addChanges(memes, stocks, cash);

  const sum = (list, k = 'value') => list.reduce((a, x) => a + x[k], 0);
  const parts = { memes: sum(memes), stocks: sum(stocks), cash: sum(cash) };
  const total = parts.memes + parts.stocks + parts.cash;

  // What the wallet is really exposed to: a meme quoted in a stock moves with that stock, so it is
  // counted under it, next to the shares held directly.
  const under = new Map();
  const slot = (x, sym) => under.get(sym) || under.set(sym, { sym, name: x.stock || x.name, nameZh: x.stockZh || x.nameZh, ticker: x.ticker, direct: 0, viaMemes: 0, memes: [] }).get(sym);
  for (const s of stocks) slot(s, s.sym).direct += s.value;
  for (const m of memes) { const e = slot(m, m.sym); e.viaMemes += m.value; if (e.memes.length < 4) e.memes.push(m.coin); }
  const exposure = [...under.values()].map((e) => ({ ...e, total: e.direct + e.viaMemes })).sort((a, b) => b.total - a.total);

  // The day's move in dollars, over the holdings whose change is known.
  let moved = 0, covered = 0;
  for (const h of [...memes, ...stocks, ...cash]) {
    if (h.change24 == null || h.change24 <= -1) continue;
    moved += h.value - h.value / (1 + h.change24); covered += h.value;
  }

  const thin = memes.filter((m) => m.value < m.mark * 0.9);
  const value = {
    wallet, updatedAt: new Date().toISOString(), leagueAt: lg.updatedAt, changes,
    total, parts,
    day: covered > 0 ? { usd: moved, pct: moved / (covered - moved || 1), covered: total > 0 ? covered / total : 0 } : null,
    memes, stocks, cash, exposure, odd,
    // Meme holdings larger than their pool can pay for at the quoted price, and what that gap is.
    thin: { count: thin.length, markUsd: sum(memes, 'mark'), gapUsd: sum(memes, 'mark') - parts.memes },
    counts: { memes: memes.length, stocks: stocks.length, coinsChecked: coinsOf(lg).length, stocksChecked: Object.keys(lg.stocks).length },
  };
  // Answers are good for a minute; old ones are dropped once there are many, so memory stays flat.
  if (cache.size > 300) for (const [k, v] of cache) if (Date.now() - v.at > 60000) cache.delete(k);
  cache.set(wallet, { at: Date.now(), value });
  return value;
}
