// The stock token list and the league both come from our own server, which reads them from the chain.
// STOCKS is symbol -> [address, name]; STOCK_BY_ADDR is the reverse. Both are filled by loadLeague().
let STOCKS = {};
let STOCK_BY_ADDR = {};
const CASH = new Set(['USDT', 'WBNB', 'BNB', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'BTCB', 'ETH', 'CAKE']);
const NIUMA = '0xc01a2e136f92772eecab15eb054e8f6fa06b7777';
const DEX = 'https://api.dexscreener.com/latest/dex/tokens/';
const RPCS = ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.bnbchain.org', 'https://bsc-dataseed2.bnbchain.org'];
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
// The default league only lists coins at or above these; the Show all switch lifts them.
const MIN_MCAP = 100000, MIN_STOCK_USD = 1000;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const usd = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toPrecision(3) : '$0';
const num = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(4);
const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const getJson = async (url) => { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(r.status + ' from ' + new URL(url, location.href).host); return r.json(); };
const byLiq = (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);

// Token logo with a letter fallback. Names and symbols are on-chain strings, so they only ever go in as text.
function avatar(url, label) {
  const letter = (label || '?').slice(0, 1).toUpperCase();
  const box = el('span', 'ava', url ? null : letter);
  if (url) {
    const img = new Image();
    img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.src = url.replace(/width=\d+&height=\d+/, 'width=144&height=144');
    img.onerror = () => { img.remove(); box.textContent = letter; };
    box.append(img);
  }
  return box;
}

// Every stock-paired pool that holds stock, with each stock token's dollar price.
async function loadLeague() {
  const data = await getJson('/api/league');
  STOCKS = Object.fromEntries(Object.entries(data.stocks).map(([sym, s]) => [sym, [s.address, s.name]]));
  STOCK_BY_ADDR = Object.fromEntries(Object.entries(data.stocks).map(([sym, s]) => [s.address, { sym, name: s.name }]));
  const prices = Object.fromEntries(Object.entries(data.stocks).map(([sym, s]) => [sym, s.price || 0]));
  return { ...data, prices };
}

// One JSON-RPC call. Public nodes are slow and uneven, so ask two at a time and take whichever answers first.
async function rpc(method, params) {
  const ask = async (url) => {
    const r = await (await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(9000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })).json();
    if (typeof r.result !== 'string' || r.error) throw new Error(r.error?.message || 'bad reply');
    return r.result;
  };
  for (let i = 0; i < RPCS.length; i += 2) {
    try { return await Promise.any(RPCS.slice(i, i + 2).map(ask)); } catch {}
  }
  throw new Error('Could not reach a BNB Chain node');
}

// balanceOf for many tokens in one eth_call through Multicall3.aggregate3, hand-encoded. Assumes 18 decimals.
async function balances(wallet, tokens) {
  const word = (n) => n.toString(16).padStart(64, '0');
  const call = ('70a08231' + wallet.slice(2).toLowerCase().padStart(64, '0')).padEnd(128, '0');
  const out = {};
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 100) chunks.push(tokens.slice(i, i + 100));
  await Promise.all(chunks.map(async (chunk) => {
    const n = chunk.length;
    // each Call3 is (target, allowFailure, bytes): 3 head words, a length word and 36 bytes padded to 64
    let data = '0x82ad56cb' + word(32) + word(n);
    for (let k = 0; k < n; k++) data += word(n * 32 + k * 192);
    for (const t of chunk) data += t.slice(2).toLowerCase().padStart(64, '0') + word(1) + word(96) + word(36) + call;
    const res = (await rpc('eth_call', [{ to: MULTICALL, data }, 'latest'])).slice(2);
    const at = (byte) => parseInt(res.slice(byte * 2, byte * 2 + 64), 16);
    for (let k = 0; k < n; k++) {
      const elem = 64 + at(64 + k * 32), bytes = elem + at(elem + 32);
      const ok = at(elem) === 1 && at(bytes) >= 32;
      out[chunk[k]] = ok ? Number(BigInt('0x' + res.slice((bytes + 32) * 2, (bytes + 64) * 2))) / 1e18 : 0;
    }
  }));
  return out;
}
