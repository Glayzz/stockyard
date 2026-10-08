// Paid data for agents: x402 over HTTP, settled through Binance's B402 facilitator.
// A call without a payment gets HTTP 402 and the price. A call with a signed payment is verified
// off-chain, answered, and then settled on BNB Chain by B402, which also pays the gas. The money
// goes straight to the receiving address set during B402 onboarding; this server never holds it.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bw3 } from './binance.mjs';
import { multicall, toText } from './chain.mjs';
import { handle } from './routes.mjs';

const NETWORK = 'eip155:56';
const LEDGER = fileURLToPath(new URL('../data/b402-ledger.jsonl', import.meta.url));
// The stablecoins B402 lists for BNB Chain, from Binance's B402 docs. Which of them are live, and
// under what EIP-712 name, comes from the Supported call and each token's own name().
const ASSETS = {
  U: '0xcE24439F2D9C6a2289F741120FE202248B666666', USD1: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
  USDT: '0x55d398326f99059fF775485246999027B3197955', USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};
// What each asset is offered with. EIP-3009 needs no approval from the buyer, so it comes first.
const OFFER = [['U', 'eip3009'], ['USD1', 'eip3009'], ['USDT', 'permit2-exact'], ['USDC', 'permit2-exact']];

// The data on sale. Each is one of the free site routes, priced per call for agents.
const PRODUCTS = {
  '/x402/league': {
    api: '/api/memes', price: '0.01', query: { stock: 'Ticker to filter by, e.g. SPY', minMcap: 'Smallest market cap in USD', sort: 'stock or mcap', limit: 'Rows, up to 100' },
    description: 'Every stock meme on BNB Chain (meme coins whose pool is quoted in a tokenized stock), ranked by the stock its pool holds.',
  },
  '/x402/coin': {
    api: '/api/coin', price: '0.01', query: { a: 'The coin contract address' },
    description: 'One stock meme in detail: price, pool, holders, trades, hourly history of the coin and of its stock, and the stock token price against the real share.',
  },
  '/x402/payslip': {
    api: '/api/payslip', price: '0.02', query: { w: 'The wallet address' },
    description: 'What a wallet has been paid in tokenized stock by the stock memes it holds: balances, payout counts and dates, latest payouts.',
  },
};

const b402 = (operation, body) => bw3('/api/v2/b402/' + operation, { method: 'POST', body: { body } });
// The same call for the two steps that carry a payment. If Binance cannot be asked at all, the
// reason is kept and nothing is charged.
const unreachable = (err) => ({ unreachable: String(err.message).replace(/<[^>]*>?/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) });
const units = (amount, decimals = 18) => {
  const [whole, frac = ''] = String(amount).split('.');
  return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
};
// Same object, same string, whatever order the keys came in.
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v));
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64');

// Live payment kinds from B402, matched to token addresses by the name each token reports on-chain.
let ready = null;
async function kinds() {
  if (ready && Date.now() - ready.at < 600000) return ready.list;
  const [supported, names] = await Promise.all([b402('supported', {}), multicall(Object.values(ASSETS).map((a) => [a, '06fdde03']))]);
  const byName = Object.fromEntries(Object.entries(ASSETS).map(([sym, address], i) => [toText(names[i] || ''), { sym, address }]));
  const list = supported.kinds.filter((k) => k.x402Version === 2 && k.network === NETWORK && byName[k.extra?.name]).map((k) => ({ ...byName[k.extra.name], scheme: k.scheme, extra: k.extra }));
  ready = { at: Date.now(), list };
  return list;
}

async function requirements(product, payTo) {
  const live = await kinds(), out = [];
  for (const [sym, method] of OFFER) {
    const k = live.find((x) => x.sym === sym && x.extra.assetTransferMethod === method);
    if (k) out.push({ scheme: k.scheme, network: NETWORK, amount: units(product.price), asset: k.address, payTo, maxTimeoutSeconds: 300, extra: k.extra });
  }
  return out;
}

// A repeated request with a payment already settled gets the same answer, not a second charge.
const settled = new Map();
// Why the last payment that failed was turned down, so a buyer or the operator can see it.
let last = null;
const turnedDown = (step, reason, extra) => { last = { at: new Date().toISOString(), step, reason, ...extra }; console.log(`paid: ${step} turned a payment down: ${reason}`); };
const totals = { calls: 0, usd: 0, last: null };
if (existsSync(LEDGER)) for (const line of readFileSync(LEDGER, 'utf8').split('\n')) { try { const e = JSON.parse(line); totals.calls++; totals.usd += Number(e.usd); totals.last = { at: e.at, transaction: e.transaction }; } catch {} }

export async function paid(req, url) {
  const payTo = process.env.B402_PAY_TO, origin = (process.env.PUBLIC_URL || 'http://' + req.headers.host).replace(/\/$/, '');
  const json = (status, body, headers) => ({ status, headers: headers || {}, json: body });

  // The catalogue is free: what is on sale, for how much, and what has been earned so far.
  if (url.pathname === '/x402' || url.pathname === '/x402/') {
    return json(200, {
      x402Version: 2, facilitator: 'Binance B402', network: NETWORK, live: Boolean(payTo), payTo: payTo || null,
      earned: { calls: totals.calls, usd: Number(totals.usd.toFixed(4)), last: totals.last },
      resources: Object.entries(PRODUCTS).map(([path, p]) => ({ url: origin + path, method: 'GET', priceUsd: p.price, description: p.description, query: p.query })),
      how: 'Call a resource. It answers 402 with payment requirements; sign one and repeat the call with it base64-encoded in the PAYMENT-SIGNATURE header.',
    });
  }
  if (url.pathname === '/x402/last') return json(200, last || { reason: null });
  const product = PRODUCTS[url.pathname];
  if (!product || req.method !== 'GET') return json(404, { error: 'No such paid resource. GET /x402 lists them.' });
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo || '')) return json(503, { error: 'Paid data is not switched on here: B402_PAY_TO is not set.' });

  const query = Object.fromEntries(url.searchParams);
  const resource = { url: origin + url.pathname + url.search, description: product.description, mimeType: 'application/json' };
  const accepts = await requirements(product, payTo);
  const challenge = (error) => { const body = { x402Version: 2, error, resource, accepts }; return json(402, body, { 'PAYMENT-REQUIRED': b64(body) }); };

  const header = req.headers['payment-signature'] || req.headers['x-payment'];
  if (!header) return challenge('Payment required');
  let payment;
  try { payment = JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch { return challenge('The payment header is not base64 JSON'); }
  // The buyer may only pay on terms this server offered: same amount, asset, receiver and method.
  const terms = accepts.find((a) => canon(a) === canon(payment?.accepted));
  if (!terms || payment.x402Version !== 2) return challenge('The accepted terms do not match any offered here');

  const key = payment.payload?.signature;
  const again = key && settled.get(key);
  if (again && Date.now() - again.at < 600000) return json(200, again.body, { 'PAYMENT-RESPONSE': b64(again.receipt) });

  const paymentPayload = { ...payment, resource };
  const check = await b402('verify', { x402Version: 2, paymentPayload, paymentRequirements: terms }).catch(unreachable);
  if (check?.unreachable) { turnedDown('verify', 'b402_unreachable', { message: check.unreachable }); return json(502, { error: 'Binance B402 could not check this payment, so nothing was charged: ' + check.unreachable }); }
  if (!check?.isValid) { turnedDown('verify', check?.invalidReason || 'unknown', { message: check?.invalidMessage || null }); return challenge(check?.invalidReason || 'The payment could not be verified'); }

  // Do the work before taking the money, so a failed answer is never charged.
  const work = await handle('GET', product.api, query);
  if (work.status !== 200) return json(work.status, work.json);

  // Settling also lists this resource in B402's Bazaar, so other agents can find it.
  const bazaar = {
    description: product.description, routeTemplate: url.pathname,
    info: { input: { type: 'http', method: 'GET', queryParams: query } },
    schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { input: { type: 'object', properties: { type: { const: 'http' }, method: { enum: ['GET'] } }, required: ['type', 'method'] } }, required: ['input'] },
  };
  const done = await b402('settle', { x402Version: 2, paymentPayload: { ...paymentPayload, extensions: { ...payment.extensions, bazaar } }, paymentRequirements: terms }).catch(unreachable);
  if (done?.unreachable) { turnedDown('settle', 'b402_unreachable', { message: done.unreachable }); return json(502, { error: 'Binance B402 did not answer the settle call. Check the payer wallet before trying again: ' + done.unreachable }); }
  if (!done?.success) { turnedDown('settle', done?.errorReason || 'unknown', { message: done?.errorMessage || null, transaction: done?.transaction || null }); return challenge(done?.errorReason || 'The payment could not be settled'); }

  const receipt = { success: true, transaction: done.transaction, network: done.network || NETWORK, payer: done.payer };
  settled.set(key, { at: Date.now(), body: work.json, receipt });
  totals.calls++; totals.usd += Number(product.price); totals.last = { at: new Date().toISOString(), transaction: done.transaction };
  try { appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), resource: url.pathname, usd: product.price, asset: terms.asset, payer: done.payer, transaction: done.transaction }) + '\n'); } catch {}
  console.log(`paid: ${url.pathname} $${product.price} from ${done.payer} tx ${done.transaction}`);
  return json(200, work.json, { 'PAYMENT-RESPONSE': b64(receipt) });
}
