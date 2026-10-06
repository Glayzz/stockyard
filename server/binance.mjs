// Signed client for the Binance Web3 API, following https://web3.binance.com/en/dev-docs/authentication.
// The signed path must carry the /build prefix and the query exactly as sent (spaces as %20, not +).
import { createHmac } from 'node:crypto';

const BASE = 'https://web3.binance.com', PREFIX = '/build';
const OK = new Set([0, '0', '000000000']);

export async function bw3(path, { method = 'GET', params, body } = {}) {
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
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 120) || '(empty body)'}`); }
  // The API reports failures as HTTP 200 with a code in the body.
  if (!OK.has(json.code)) throw new Error(`code ${json.code}: ${json.msg}`);
  return json.data;
}
