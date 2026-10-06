// /api routes. They run on the server so the Binance key and secret never reach the browser.
import { bw3 } from './binance.mjs';
import { league } from './league.mjs';

const CHAIN = '56';
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const bad = (message) => Object.assign(new Error(message), { status: 400 });

const routes = {
  // Is the server up, and can it reach Binance from where it is hosted?
  'GET /api/health': async () => ({
    ok: true,
    binance: await bw3('/api/v1/dex/market/supported/chain').then(() => 'reachable', (e) => 'unreachable: ' + (e.cause?.code || e.message)),
  }),

  // Every stock-paired pool that holds stock, read from the chain. Cached for two minutes.
  'GET /api/league': () => league(),

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
