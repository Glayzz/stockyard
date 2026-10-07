#!/usr/bin/env node
// An agent buying data over x402 with no SDK: ask, get 402 and the price, sign, ask again.
//
//   node scripts/x402-buy.mjs wallet                      make or show the buyer wallet
//   node scripts/x402-buy.mjs http://localhost:4173/x402/league?stock=SPY
//
// The buyer signs an EIP-3009 transferWithAuthorization for U or USD1. It never sends a
// transaction and needs no BNB: Binance's B402 facilitator submits it and pays the gas.
// The wallet is a throwaway one, kept in data/x402-buyer.json (not in git) or given as
// X402_BUYER_KEY. Fund it with cents only. The signing here is plain BigInt arithmetic, written
// to be read, not hardened against side channels.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../server/net.mjs';

const KEYFILE = fileURLToPath(new URL('../data/x402-buyer.json', import.meta.url));
const RPC = 'https://bsc-rpc.publicnode.com';

// ---- Keccak-256, the hash Ethereum uses (not the later SHA3-256 padding) ----
const MASK = (1n << 64n) - 1n;
const ROUND = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an,
  0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
const TURN = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rot = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;
export function keccak256(bytes) {
  const rate = 136, padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes); padded[bytes.length] ^= 0x01; padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) { let w = 0n; for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(padded[off + i * 8 + b]); s[i] ^= w; }
    for (let round = 0; round < 24; round++) {
      const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) { const d = c[(x + 4) % 5] ^ rot(c[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[x + y] ^= d; }
      const b = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rot(s[x + 5 * y], TURN[x + 5 * y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = b[x + 5 * y] ^ (~b[(x + 1) % 5 + 5 * y] & MASK & b[(x + 2) % 5 + 5 * y]);
      s[0] ^= ROUND[round];
    }
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((s[i] >> BigInt(8 * b)) & 0xffn);
  return out;
}

// ---- secp256k1 ----
const P = 2n ** 256n - 2n ** 32n - 977n, N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
const inv = (a, m = P) => { let [r0, r1, t0, t1] = [m, mod(a, m), 0n, 1n]; while (r1) { const q = r0 / r1; [r0, r1, t0, t1] = [r1, r0 - q * r1, t1, t0 - q * t1]; } return mod(t0, m); };
const add = (p, q) => {
  if (!p) return q;
  if (!q) return p;
  const [x1, y1] = p, [x2, y2] = q;
  if (x1 === x2 && mod(y1 + y2) === 0n) return null;
  const l = x1 === x2 ? mod(3n * x1 * x1 * inv(2n * y1)) : mod((y2 - y1) * inv(x2 - x1));
  const x3 = mod(l * l - x1 - x2);
  return [x3, mod(l * (x1 - x3) - y1)];
};
const mul = (k, p = G) => { let r = null; for (; k > 0n; k >>= 1n) { if (k & 1n) r = add(r, p); p = add(p, p); } return r; };

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const bytes = (h) => Uint8Array.from((h.replace(/^0x/, '').match(/../g) || []).map((b) => parseInt(b, 16)));
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const text = (s) => new TextEncoder().encode(s);
const hash = (h) => hex(keccak256(bytes(h)));

export function addressOf(privateKey) {
  const [x, y] = mul(BigInt('0x' + privateKey));
  return '0x' + hash(word(x) + word(y)).slice(24);
}
// A 65-byte Ethereum signature (r, s, v) over a 32-byte digest.
function sign(digestHex, privateKey) {
  const z = BigInt('0x' + digestHex), d = BigInt('0x' + privateKey);
  for (;;) {
    const k = mod(BigInt('0x' + hex(randomBytes(32))), N);
    if (!k) continue;
    const [rx, ry] = mul(k), r = mod(rx, N);
    let s = mod(inv(k, N) * (z + r * d), N), odd = Number(ry & 1n);
    if (!r || !s) continue;
    if (s > N / 2n) { s = N - s; odd ^= 1; }
    return '0x' + word(r) + word(s) + (27 + odd).toString(16);
  }
}

// ---- EIP-712 for EIP-3009 transferWithAuthorization ----
const DOMAIN_TYPE = hex(keccak256(text('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')));
const TRANSFER_TYPE = hex(keccak256(text('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)')));
export const domainSeparator = (name, version, chainId, contract) => hash(DOMAIN_TYPE + hex(keccak256(text(name))) + hex(keccak256(text(version))) + word(chainId) + word(contract));
export function authorize(terms, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const auth = { from: addressOf(privateKey), to: terms.payTo, value: terms.amount, validAfter: '0', validBefore: String(now + terms.maxTimeoutSeconds), nonce: '0x' + hex(randomBytes(32)) };
  const struct = hash(TRANSFER_TYPE + word(auth.from) + word(auth.to) + word(auth.value) + word(auth.validAfter) + word(auth.validBefore) + auth.nonce.slice(2));
  const digest = hash('1901' + domainSeparator(terms.extra.name, terms.extra.version, Number(terms.network.split(':')[1]), terms.asset) + struct);
  return { signature: sign(digest, privateKey), authorization: auth };
}

function loadKey(create) {
  if (process.env.X402_BUYER_KEY) return process.env.X402_BUYER_KEY.replace(/^0x/, '');
  if (existsSync(KEYFILE)) return JSON.parse(readFileSync(KEYFILE, 'utf8')).privateKey;
  if (!create) return null;
  const privateKey = hex(randomBytes(32));
  writeFileSync(KEYFILE, JSON.stringify({ privateKey, note: 'Throwaway x402 buyer wallet. Fund it with cents only.' }), { mode: 0o600 });
  return privateKey;
}
const balance = async (token, owner) => {
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data: '0x70a08231' + word(owner) }, 'latest'] }) })).json();
  return BigInt(r.result && r.result !== '0x' ? r.result : 0);
};

// Used as a script: buy one resource. Imported: only the helpers above.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (!target) { console.log('Usage: node scripts/x402-buy.mjs wallet | <url>'); process.exit(1); }
  if (target === 'wallet') {
    const address = addressOf(loadKey(true));
    console.log('Buyer wallet:', address, '\nSend it a few cents of U or USD1 on BNB Chain. It needs no BNB.');
    process.exit(0);
  }
  const key = loadKey(false);
  if (!key) { console.log('No buyer wallet yet. Run: node scripts/x402-buy.mjs wallet'); process.exit(1); }
  const me = addressOf(key);

  const first = await fetch(target);
  if (first.status !== 402) { console.log('Expected 402, got', first.status, (await first.text()).slice(0, 300)); process.exit(1); }
  const offer = await first.json();
  console.log('402 from', new URL(target).pathname, '·', offer.accepts.length, 'ways to pay');

  // Take the first gasless offer this wallet can afford.
  let terms = null;
  for (const a of offer.accepts.filter((x) => x.extra?.assetTransferMethod === 'eip3009')) {
    const have = await balance(a.asset, me);
    console.log(' ', a.extra.name, 'costs', Number(a.amount) / 1e18, '· wallet holds', Number(have) / 1e18);
    if (!terms && have >= BigInt(a.amount)) terms = a;
  }
  // With nothing to spend, sign anyway with the --unfunded flag to watch B402 turn it down.
  if (!terms && process.argv.includes('--unfunded')) terms = offer.accepts.find((x) => x.extra?.assetTransferMethod === 'eip3009');
  if (!terms) { console.log(`Wallet ${me} cannot afford any of them. Send it a few cents of U or USD1.`); process.exit(1); }

  const payment = { x402Version: 2, resource: offer.resource, accepted: terms, payload: authorize(terms, key) };
  const second = await fetch(target, { headers: { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(payment)).toString('base64') } });
  const body = await second.json();
  const receipt = second.headers.get('payment-response');
  console.log('Second call:', second.status, receipt ? 'paid · ' + Buffer.from(receipt, 'base64').toString('utf8') : body.error || '');
  if (second.status === 200) console.log(JSON.stringify(body).slice(0, 600) + ' …');
}
