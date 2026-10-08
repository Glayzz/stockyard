// Shared by every page: language, formatting, the league fetch and the wallet trade flow.
const NIUMA = '0xc01a2e136f92772eecab15eb054e8f6fa06b7777';
// The Stockyard agent's ERC-8004 identity on BNB Chain, and the transaction that registered it.
// WalletConnect's project ID for this site, from dashboard.reown.com. It is public by design.
// While it is empty the WalletConnect button stays hidden and phones get the longer wallet list.
const WALLETCONNECT_ID = '1493458eeadd79fa493f739dd46edb22';
const AGENT = { id: 365431, wallet: '0x1E8316cE99376E8E1F5E6b6482243e4d47DADdc3', registered: '0x1d978538d858f22bf1c51e3b678f11eb3eac0e2e50bc2642358f3182f6a4c65a' };
// Mainnet transactions made through this project, linked from the Agents page.
const PROOF = {
  trade: '0x6eb3cea632d3e97a17089c1a1576f68f2e84e560161e4cab2e3734a462b37f74',
  topUp: '0x15a2af9c65893c1c3f77efca93c203b532a7a20e0bcc13d34211284197b595e3',
  // The paid call against the hosted site, 8 Oct 2026. The first one, a day earlier against a
  // local server, was 0x1c6c4e13…f92f.
  paid: '0xee59cb7866e5a705dc58c4682399441a86a0b47970784c6dfcc854410ad8ee85',
  // Binance Agentic Wallet selling NIUMA and keeping the stock, 8 Oct 2026.
  agentic: '0xf50fecf7de599312845956dcfefa1a2fe82dde14a9ff0c0e8146609b4de71b31',
};
// The default league only lists coins at or above these; the Show all switch lifts them.
const MIN_MCAP = 100000, MIN_STOCK_USD = 1000;

// Language: English or 中文. Remembered in this browser; a Chinese browser starts in 中文.
let LANG = 'en';
try { LANG = localStorage.getItem('stockyard-lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'); } catch {}
const zh = LANG === 'zh';
const t = (en, cn) => (zh ? cn : en);
// A stock or league row carries both names; pick the one for this language.
const stockName = (x) => (zh && x.nameZh) || x.name;
const dateLocale = zh ? 'zh-CN' : 'en-GB';
function initLang() {
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  if (zh) {
    for (const n of document.querySelectorAll('[data-zh]')) n.textContent = n.dataset.zh;
    for (const n of document.querySelectorAll('[data-zh-placeholder]')) n.placeholder = n.dataset.zhPlaceholder;
  }
  const b = document.getElementById('lang');
  if (!b) return;
  b.textContent = zh ? 'EN' : '中文';
  b.setAttribute('aria-label', zh ? 'Switch to English' : '切换到中文');
  b.onclick = () => { try { localStorage.setItem('stockyard-lang', zh ? 'en' : 'zh'); } catch {} location.reload(); };
}

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const usd = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toPrecision(3) : '$0';
const num = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(4);
// A whole amount written out, for a button or a receipt: 100,000 rather than 100.0K.
const full = (n) => (n >= 1e6 ? num(n) : n >= 100 ? Math.round(n).toLocaleString('en-US') : num(n));
const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const getJson = async (url) => { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(r.status + ' from ' + new URL(url, location.href).host); return r.json(); };

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

// An address shown short. A click copies the whole thing.
// Puts text on the clipboard and says whether it worked.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Older browsers and pages without clipboard permission: copy through a hidden field.
    const field = el('textarea');
    field.value = text; field.style.position = 'fixed'; field.style.opacity = '0';
    document.body.append(field); field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    field.remove();
    return ok;
  }
}

function copyable(address) {
  const b = el('button', 'copy', short(address));
  b.type = 'button'; b.title = t('Copy ', '复制 ') + address;
  b.onclick = async (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!await copyText(address)) return;
    b.textContent = t('Copied', '已复制'); b.classList.add('done');
    setTimeout(() => { b.textContent = short(address); b.classList.remove('done'); }, 1200);
  };
  return b;
}

// A coin's own website, X and Telegram, as its team set them on DexScreener. The links were
// checked on the server to be plain https; only fixed labels are shown, never the link's text.
function socials(links, small) {
  const out = [];
  const add = (label, href) => {
    if (!href) return;
    const a = el('a', 'social' + (small ? ' small' : ''), label);
    a.href = href; a.target = '_blank'; a.rel = 'noopener nofollow';
    a.onclick = (e) => e.stopPropagation();
    out.push(a);
  };
  if (!links) return out;
  add(t('Website', '官网'), links.website);
  add('X', links.x);
  add('Telegram', links.telegram);
  if (!small) add('DexScreener', links.dex);
  return out;
}

// Every stock-paired pool that holds stock, read from the chain by our own server.
// The listed coins by default; every pool only when asked, because that answer is a hundred times larger.
const loadLeague = (all) => getJson('/api/league' + (all ? '' : '?scope=listed'));

// The server's "Binance is unreachable" error, in the reader's language. Other errors pass through.
const offlineError = (e) => /cannot be reached|did not answer/.test(e || '');
const why = (e) => (offlineError(e) ? t('Binance cannot be reached right now', '暂时连不上币安') : e);

// A coin's own buy and sell tax as fractions, from GoPlus. Null when it is not known.
async function coinTax(address) {
  try {
    const sec = Object.values((await getJson('https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=' + address)).result || {})[0];
    return sec ? { buy: sec.buy_tax === '' ? null : Number(sec.buy_tax), sell: sec.sell_tax === '' ? null : Number(sec.sell_tax) } : null;
  } catch { return null; }
}

