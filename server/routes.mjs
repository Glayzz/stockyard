// /api routes. They run on the server so the Binance key and secret never reach the browser.
import { bw3 } from './binance.mjs';
import { league } from './league.mjs';
import { payslip } from './payslip.mjs';
import { coin } from './coin.mjs';
import { prepare, status } from './swap.mjs';
import { status as parts } from './status.mjs';

const CHAIN = '56';
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const NIUMA = '0xc01a2e136f92772eecab15eb054e8f6fa06b7777';
const listed = (r) => r.mcap >= 100000 && r.stockUsd >= 1000;

// Where the flagship coin stands among every pool, worked out here so the home page does not
// have to download them all to say it.
function standing(rows) {
  const me = rows.find((r) => r.address === NIUMA);
  if (!me) return null;
  const peers = rows.filter((r) => r.sym === me.sym);
  const rank = (list, k) => list.filter((r) => r[k] > me[k]).length + 1;
  const ahead = peers.filter((r) => r.shares > me.shares).sort((a, b) => a.shares - b.shares)[0];
  return { bySize: rank(peers, 'mcap'), byStock: rank(peers, 'shares'), ofAll: rank(rows, 'stockUsd'), coins: rows.length, ahead: ahead ? { coin: ahead.coin, shares: ahead.shares } : null };
}

const routes = {
  // Is the server up, and can it reach Binance from where it is hosted?
  'GET /api/health': async () => ({
    ok: true,
    binance: await bw3('/api/v1/dex/market/supported/chain').then(() => 'reachable', (e) => 'unreachable: ' + e.message),
    telegram: parts.telegram ? { bot: parts.telegram, lastPolled: parts.telegramPolledAt } : 'off',
    paidData: process.env.B402_PAY_TO ? 'on' : 'off',
  }),

  // Every stock-paired pool that holds stock, read from the chain. Cached for two minutes.
  // ?scope=listed sends only the coins worth $100K or more, about a hundredth of the full answer.
  'GET /api/league': async (q) => {
    const lg = await league(), where = standing(lg.rows);
    if (q.scope !== 'listed') return { ...lg, standing: where };
    // The short answer also leaves out the stock profiles, which no page reads from here.
    const { stocks, ...rest } = lg;
    return { ...rest, scope: 'listed', rows: lg.rows.filter((r) => listed(r) || r.address === NIUMA), standing: where };
  },

  // The league as a short, filtered list, for agents and scripts. Defaults to coins worth $100K or more.
  'GET /api/memes': async (q) => {
    const lg = await league();
    const min = q.minMcap == null ? 100000 : Number(q.minMcap), limit = Math.min(Number(q.limit) || 20, 100);
    const want = (q.stock || '').toUpperCase();
    const rows = lg.rows
      .filter((r) => r.mcap >= min && r.stockUsd >= 1000 && (!want || r.ticker === want || r.sym === want))
      .sort((a, b) => (q.sort === 'mcap' ? b.mcap - a.mcap : b.stockUsd - a.stockUsd)).slice(0, limit)
      .map((r) => ({
        coin: r.coin, address: r.address, pool: r.pair, stock: r.name, stockTicker: r.ticker, stockToken: r.stock,
        sharesInPool: r.shares, stockUsdInPool: r.stockUsd, priceUsd: r.price, marketCapUsd: r.mcap,
        volume24hUsd: r.vol24 ?? null, change24h: r.change24 ?? null, holders: r.holders ?? null,
      }));
    return { updatedAt: lg.updatedAt, totals: lg.stats, count: rows.length, memes: rows };
  },

  // Coins to pick from. With no q, the listed coins by stock in their pool; with q, any coin whose
  // symbol, name or address matches, listed ones first.
  'GET /api/search': async (q) => {
    const lg = await league(), text = String(q.q || '').trim().toLowerCase().slice(0, 60);
    // One row per coin: its deepest stock pool.
    const best = new Map();
    for (const r of lg.rows) { const b = best.get(r.address); if (!b || r.stockUsd > b.stockUsd) best.set(r.address, r); }
    const rows = [...best.values()]
      .filter((r) => (text ? r.coin.toLowerCase().includes(text) || (r.coinName || '').toLowerCase().includes(text) || r.address.startsWith(text) : listed(r)))
      .sort((a, b) => listed(b) - listed(a) || b.stockUsd - a.stockUsd).slice(0, text ? 8 : 24);
    return { coins: rows.map((r) => ({ coin: r.coin, name: r.coinName, address: r.address, stock: r.name, stockZh: r.nameZh, logo: r.logo || null, mcap: r.mcap, stockUsd: r.stockUsd, listed: listed(r) })) };
  },

  // One coin's page: pool from the chain; prices, history, trades and company profile from Binance.
  'GET /api/coin': (q) => { if (!isAddr(q.a)) throw bad('a must be a coin address'); return coin(q.a); },

  // A wallet's stock tokens, the stock memes behind them and the payouts it has received.
  'GET /api/payslip': (q) => { if (!isAddr(q.w)) throw bad('w must be a wallet address'); return payslip(q.w); },

  // Builds the approval and swap for the user's own wallet to sign, with a dry run. Moves nothing.
  'POST /api/swap/prepare': (_q, body) => {
    if (!isAddr(body?.wallet) || !isAddr(body?.from) || !isAddr(body?.to)) throw bad('wallet, from and to must be addresses');
    if (!/^[1-9]\d{0,40}$/.test(body.amount || '')) throw bad('amount must be a whole number in the smallest unit');
    const slippage = Number(body.slippage ?? 3);
    if (!(slippage > 0 && slippage <= 20)) throw bad('slippage must be between 0 and 20 percent');
    return prepare({ wallet: body.wallet, from: body.from, to: body.to, amount: body.amount, slippage });
  },

  // Where a sent swap has got to.
  'GET /api/swap/status': (q) => { if (!/^0x[0-9a-fA-F]{64}$/.test(q.hash || '')) throw bad('hash must be a transaction hash'); return status(q.hash); },

  // A real quote from Binance's aggregator, e.g. a stock meme into the stock it trades against.
  // amount is in the token's smallest unit.
  'GET /api/quote': async (q) => {
    if (!isAddr(q.from) || !isAddr(q.to)) throw bad('from and to must be token addresses');
    if (!/^[1-9]\d{0,40}$/.test(q.amount || '')) throw bad('amount must be a whole number in the smallest unit');
    if (q.wallet && !isAddr(q.wallet)) throw bad('wallet must be an address');
    const params = { binanceChainId: CHAIN, fromTokenAddress: q.from, toTokenAddress: q.to, amount: q.amount };
    if (q.wallet) params.userWalletAddress = q.wallet;
    const [best] = await bw3('/api/v1/dex/aggregator/quote', { params });
    if (!best) throw Object.assign(new Error('No route for this pair'), { status: 404 });
    return {
      quoteId: best.quoteId, vendor: best.vendorName, mode: best.executionMode,
      fromAmount: best.fromTokenAmount, toAmount: best.toTokenAmount,
      // Binance labels this a percent but returns a fraction: 0.0042 means 0.42%.
      priceImpact: Number(best.priceImpactPercent), feeUsd: Number(best.tradeFee),
      hops: String(best.router || '').split('--'),
    };
  },

  // Balances of one wallet for a list of tokens, straight from the Wallet API.
  'POST /api/balances': async (_q, body) => {
    if (!isAddr(body?.wallet)) throw bad('wallet must be an address');
    const tokens = (body.tokens || []).filter(isAddr).slice(0, 400);
    if (!tokens.length) throw bad('tokens must list at least one token address');
    const out = {};
    for (let i = 0; i < tokens.length; i += 20) {
      const data = await bw3('/api/v1/dex/balance/token-balances-by-address', {
        method: 'POST',
        body: { address: body.wallet, tokenContractAddresses: tokens.slice(i, i + 20).map((t) => ({ binanceChainId: CHAIN, tokenContractAddress: t })) },
      });
      for (const a of data?.[0]?.tokenAssets || [])
        out[a.tokenContractAddress.toLowerCase()] = { balance: Number(a.balance), price: Number(a.tokenPrice), symbol: a.symbol, risky: !!a.isRiskToken };
    }
    return out;
  },
};

export async function handle(method, pathname, query, body) {
  const route = routes[method + ' ' + pathname];
  if (!route) return { status: 404, json: { error: 'No such route' } };
  try {
    return { status: 200, json: await route(query, body) };
  } catch (err) {
    // Anything that is not our own validation error is Binance or the network failing.
    return { status: err.status || 502, json: { error: err.message } };
  }
}
