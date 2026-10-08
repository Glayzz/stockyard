#!/usr/bin/env node
// Stockyard as an MCP server: five read-only tools any agent can call over stdio.
// It talks to a running Stockyard server, so it needs no keys of its own: the live one unless
// STOCKYARD_URL names another.
//
//   node mcp/server.mjs
//   STOCKYARD_URL=http://localhost:4173 node mcp/server.mjs
//
// Speaks JSON-RPC 2.0, one message per line, with no dependencies.
import { createInterface } from 'node:readline';

const BASE = (process.env.STOCKYARD_URL || 'https://stockyardbnb.duckdns.org').replace(/\/$/, '');
const ADDRESS = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' };
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const quote = (from, to, amount) => api(`/api/quote?from=${from}&to=${to}&amount=${amount}`).catch((e) => ({ error: e.message }));

const api = async (path) => {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Stockyard answered ' + r.status);
  return j;
};
const units = (amount, decimals = 18) => {
  const [whole, frac = ''] = String(amount).split('.');
  return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
};

const tools = [
  {
    name: 'stock_meme_league',
    description: 'List stock memes on BNB Chain: meme coins whose pool is quoted in a tokenized stock. Ranked by the stock held in the pool. Read on-chain.',
    inputSchema: {
      type: 'object',
      properties: {
        stock: { type: 'string', description: 'Underlying ticker to filter by, e.g. SPY, QQQ, SPCX, NVDA' },
        minMarketCapUsd: { type: 'number', description: 'Smallest market cap to include. Default 100000' },
        sort: { type: 'string', enum: ['stock', 'mcap'], description: 'Rank by stock held in the pool or by market cap' },
        limit: { type: 'number', description: 'Rows to return, up to 100. Default 20' },
      },
    },
    run: (a) => api(`/api/memes?${new URLSearchParams({ ...(a.stock && { stock: a.stock }), ...(a.minMarketCapUsd != null && { minMcap: a.minMarketCapUsd }), ...(a.sort && { sort: a.sort }), ...(a.limit && { limit: a.limit }) })}`),
  },
  {
    name: 'stock_meme_coin',
    description: 'One stock meme in detail: price, market cap, holders, how much of its recent move came from the meme and how much from the stock, the stock token price against the real share price, and its pools.',
    inputSchema: { type: 'object', properties: { address: { ...ADDRESS, description: 'The coin contract address' } }, required: ['address'] },
    async run(a) {
      const d = await api('/api/coin?a=' + a.address);
      // Split the latest 24 hours of hourly closes into the coin's move and the stock's move.
      const day = (s) => { const cut = Date.now() / 1000 - 86400, before = s.filter((p) => p[0] < cut).pop() || s[0]; return s.length > 1 ? s[s.length - 1][1] / before[1] - 1 : null; };
      const coin24 = day(d.series.coin), stock24 = day(d.series.stock);
      return {
        coin: d.coin, stock: d.stock, pool: d.pool, pools: d.pools,
        move24h: coin24 == null || stock24 == null ? null : { coinInDollars: coin24, fromTheStock: stock24, fromTheMeme: (1 + coin24) / (1 + stock24) - 1 },
        recentTrades: d.trades.slice(0, 10),
      };
    },
  },
  {
    name: 'stock_payslip',
    description: 'What a wallet has been paid in tokenized stock by the stock memes it holds: balances, payout count and dates, and the latest payouts. Payout history comes from the Binance Web3 Wallet API.',
    inputSchema: { type: 'object', properties: { wallet: { ...ADDRESS, description: 'The wallet address' } }, required: ['wallet'] },
    run: (a) => api('/api/payslip?w=' + a.wallet),
  },
  {
    name: 'keep_stock_quote',
    description: 'Quote selling a stock meme two ways through Binance\'s aggregator: into the stock it trades against (keep the stock) and into USDT (take cash). Quotes only; it sends nothing.',
    inputSchema: {
      type: 'object',
      properties: { address: { ...ADDRESS, description: 'The coin contract address' }, amount: { type: 'string', description: 'Coins to sell, in whole coins, e.g. "100000"' } },
      required: ['address', 'amount'],
    },
    async run(a) {
      const d = await api('/api/coin?a=' + a.address), amount = units(a.amount, d.coin.decimals ?? 18);
      const [keep, cash] = await Promise.all([quote(a.address, d.stock.address, amount), quote(a.address, USDT, amount)]);
      const shares = keep.error ? null : Number(keep.toAmount) / 1e18;
      return {
        selling: { coin: d.coin.symbol, amount: a.amount },
        keepTheStock: keep.error ? keep : { stock: d.stock.name, stockToken: d.stock.address, shares, worthUsd: shares * (d.stock.price || 0), swaps: keep.hops.length - 1, priceImpact: keep.priceImpact },
        takeCash: cash.error ? cash : { usdt: Number(cash.toAmount) / 1e18, swaps: cash.hops.length - 1, priceImpact: cash.priceImpact },
        note: 'priceImpact is a fraction: 0.0042 means 0.42%. To execute, use the Binance Agentic Wallet: baw market-order swap.',
      };
    },
  },
  {
    name: 'buy_with_stock_quote',
    description: 'Quote buying a stock meme by paying with the tokenized stock it trades against, next to paying the same dollars in USDT, through Binance\'s aggregator. Quotes only; it sends nothing.',
    inputSchema: {
      type: 'object',
      properties: { address: { ...ADDRESS, description: 'The coin contract address' }, shares: { type: 'string', description: 'Shares of the stock token to spend, e.g. "0.05"' } },
      required: ['address', 'shares'],
    },
    async run(a) {
      const d = await api('/api/coin?a=' + a.address), dollars = Number(a.shares) * (d.stock.price || 0);
      const coins = (q) => Number(q.toAmount) / 10 ** (d.coin.decimals ?? 18);
      const [stock, cash] = await Promise.all([
        quote(d.stock.address, a.address, units(a.shares)),
        dollars > 0 ? quote(USDT, a.address, units(dollars.toFixed(6))) : { error: 'No price for this stock' },
      ]);
      return {
        buying: { coin: d.coin.symbol, with: d.stock.name, stockToken: d.stock.address, shares: a.shares, worthUsd: dollars },
        payWithTheStock: stock.error ? stock : { coins: coins(stock), swaps: stock.hops.length - 1, priceImpact: stock.priceImpact },
        payWithCash: cash.error ? cash : { usdt: dollars, coins: coins(cash), swaps: cash.hops.length - 1, priceImpact: cash.priceImpact },
        note: 'priceImpact is a fraction: 0.0042 means 0.42%. To execute, use the Binance Agentic Wallet: baw market-order swap from the stock token into the coin.',
      };
    },
  },
];

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no answer
  if (method === 'initialize')
    return reply(id, { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stockyard', version: '0.1.0' } });
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === 'tools/call') {
    const tool = tools.find((t) => t.name === params?.name);
    if (!tool) return fail(id, -32602, 'Unknown tool: ' + params?.name);
    try {
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(await tool.run(params.arguments || {})) }] });
    } catch (err) {
      return reply(id, { isError: true, content: [{ type: 'text', text: err.message }] });
    }
  }
  fail(id, -32601, 'Method not found: ' + method);
});
