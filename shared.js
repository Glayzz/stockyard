// Stock token addresses resolved from DexScreener by symbol and cash liquidity.
// To be replaced by Binance's official RWA list once that API is reachable.
const STOCKS = {
  SPCXB: ['0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1', 'SpaceX'],
  QQQB:  ['0x205812cdbed920aff76c6580abd681a46d11efc7', 'Nasdaq 100'],
  AAPLB: ['0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a', 'Apple'],
  NVDAB: ['0x02fca66c1d1afb4e2a7884261eb00f63598a7436', 'Nvidia'],
  SPYB:  ['0x7138b48df7d98d7e3cc221bfe7192d0a178182d8', 'S&P 500'],
  TSLAB: ['0x5b1910eaad6450e50f816082aa078c41f10c292f', 'Tesla'],
  BABAB: ['0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec', 'Alibaba'],
  GOOGLB:['0x3f53de71c126bdabae20f9cd64848d317f6c3238', 'Google'],
  MSFTB: ['0x80106cb3ead06659a5ad19df39d9b4733863b9b0', 'Microsoft'],
  NFLXB: ['0xd6829ea836b6fa224d099d40e54b31262f874631', 'Netflix'],
  MSTRB: ['0xe87afb3076aeb0f9b14e368de8145ae6a2826a14', 'Strategy'],
  AMZNB: ['0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00', 'Amazon'],
  HOODB: ['0xa394dcea3fd3847fd793afbfd163e2e3858b7c65', 'Robinhood'],
  CRCLB: ['0x80f3d493ebce97e343c53d29a137942416b4ffc0', 'Circle'],
  METAB: ['0x7425889fe94f9d693e8daefe88bcced6acfef4c0', 'Meta'],
  INTCB: ['0xe614e2fc6c787035ff51f452e8e826bfd32d5283', 'Intel'],
  SNDKB: ['0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb', 'Sandisk'],
  TSMB:  ['0xab78b89b5bb00236be0b4b20704cbfa04efc711c', 'TSMC'],
};
const STOCK_BY_ADDR = Object.fromEntries(Object.entries(STOCKS).map(([sym, [addr, name]]) => [addr, { sym, name }]));
const CASH = new Set(['USDT', 'WBNB', 'BNB', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'BTCB', 'ETH', 'CAKE']);
const NIUMA = '0xc01a2e136f92772eecab15eb054e8f6fa06b7777';
const DEX = 'https://api.dexscreener.com/latest/dex/tokens/';
const RPCS = ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.bnbchain.org', 'https://bsc-dataseed2.bnbchain.org'];
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const MIN_STOCK_USD = 1000, MIN_STOCK_RATIO = 0.002;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const usd = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toPrecision(3) : '$0';
const num = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(4);
const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const getJson = async (url) => { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(r.status + ' from ' + new URL(url).host); return r.json(); };
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

// Every meme coin whose pool is quoted in a stock token, plus each stock token's dollar price.
async function loadLeague() {
  const prices = {};
  const results = await Promise.allSettled(Object.entries(STOCKS).map(async ([sym, [addr, name]]) => {
    const pairs = (await getJson(DEX + addr)).pairs || [];
    const ref = pairs.filter((p) => p.baseToken.address.toLowerCase() === addr && p.quoteToken.symbol === 'USDT').sort(byLiq)[0];
    const price = prices[sym] = ref ? Number(ref.priceUsd) : 0;
    return pairs
      .filter((p) => p.chainId === 'bsc' && p.quoteToken.address.toLowerCase() === addr)
      .filter((p) => !STOCK_BY_ADDR[p.baseToken.address.toLowerCase()] && !CASH.has(p.baseToken.symbol))
      .map((p) => {
        const shares = p.liquidity?.quote || 0;
        return {
          sym, name, coin: p.baseToken.symbol, address: p.baseToken.address.toLowerCase(), logo: p.info?.imageUrl || null,
          shares, stockUsd: price ? shares * price : (p.liquidity?.usd || 0) / 2,
          price: Number(p.priceUsd) || 0, mcap: p.marketCap || p.fdv || 0, vol24: p.volume?.h24 || 0,
        };
      });
  }));
  const rows = results.flatMap((r) => r.status === 'fulfilled' ? r.value : [])
    .filter((m) => m.stockUsd >= MIN_STOCK_USD && m.mcap > 0 && m.stockUsd / m.mcap >= MIN_STOCK_RATIO);
  if (!rows.length) throw new Error('No pools returned');
  return { rows, prices, failed: results.filter((r) => r.status === 'rejected').length };
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
