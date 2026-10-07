// Signed client for the Binance Web3 API, following https://web3.binance.com/en/dev-docs/authentication.
// The signed path must carry the /build prefix and the query exactly as sent (spaces as %20, not +).
import { createHmac } from 'node:crypto';
import './net.mjs';

const BASE = 'https://web3.binance.com', PREFIX = '/build';
const OK = new Set([0, '0', '000000000']);

const CONNECT = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']);

// When Binance cannot be reached at all, calls fail at once instead of each waiting out a timeout.
// A quiet check every 30 seconds notices when it is back.
let down = false;
export const binanceUp = () => !down;
function recheck() {
  setTimeout(() => send('/api/v1/dex/market/rwa/platforms').then(() => { down = false; }, (e) => { if (e.offline) recheck(); else down = false; }), 30000).unref();
}

export async function bw3(path, opts) {
  if (down) throw new Error('Binance cannot be reached from this server right now');
  try { return await send(path, opts); }
  catch (err) {
    if (err.offline && !down) { down = true; recheck(); }
    throw err;
  }
}

async function send(path, { method = 'GET', params, body } = {}) {
  const key = process.env.BINANCE_W3_API_KEY, secret = process.env.BINANCE_W3_API_SECRET;
  if (!key || !secret) throw new Error('Set BINANCE_W3_API_KEY and BINANCE_W3_API_SECRET in .env');
  const pairs = Object.entries(params || {}).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v));
  const query = pairs.length ? '?' + pairs.join('&') : '';
  const payload = body ? JSON.stringify(body) : '';
  const timestamp = new Date().toISOString();
  const sign = createHmac('sha256', secret).update(timestamp + method + PREFIX + path + query + payload).digest('base64');
  const res = await fetch(BASE + PREFIX + path + query, {
    method, body: payload || undefined, signal: AbortSignal.timeout(15000),
    headers: {
      'content-type': 'application/json', 'X-OC-APIKEY': key, 'X-OC-TIMESTAMP': timestamp,
      'X-OC-SIGN': sign, 'X-OC-RECV-WINDOW': '10000',
    },
  }).catch((e) => {
    // Only a failure to connect counts as Binance being unreachable; one slow answer does not.
    const code = e.cause?.code || e.name;
    throw Object.assign(new Error('Binance did not answer: ' + code), { offline: CONNECT.has(code) });
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 120) || '(empty body)'}`); }
  // The API reports failures as HTTP 200 with a code in the body.
  if (!OK.has(json.code)) throw new Error(`code ${json.code}: ${json.msg}`);
  return json.data;
}
