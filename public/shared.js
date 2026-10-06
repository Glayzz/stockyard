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

// The wallet steps for one swap: connect, check, approve if needed, dry run, then send. Every step is
// signed in the user's own wallet. job() describes the swap, or returns null while there is none:
// { from, to, amount, slippage, symbol, owner, receive(units), action, done }
let WALLET = null;
const FLOWS = new Set();
if (window.ethereum?.on) window.ethereum.on('accountsChanged', (list) => { WALLET = list[0] || null; for (const f of FLOWS) { f.clear(); f.render(); } });

function tradeFlow(box, job) {
  let plan = null, busy = false;
  const say = (text, cls) => box.append(el('p', 'note' + (cls ? ' ' + cls : ''), text));
  const button = (text, fn, plain) => { const b = el('button', 'btn' + (plain ? ' plain' : ''), text); b.type = 'button'; b.onclick = fn; box.append(b); };
  const kind = (what) => (zh ? (what === 'approval' ? '授权' : '兑换') : what);

  function render(message, isError) {
    box.replaceChildren();
    if (message) say(message, isError ? 'down' : null);
    const j = job();
    if (!j || busy) return;
    if (!window.ethereum) { say(t('To trade, open this page in a browser with a BNB Chain wallet such as MetaMask or Binance Wallet.', '要交易，请在装有 BNB Chain 钱包（如 MetaMask 或币安钱包）的浏览器中打开本页。')); return; }
    if (!WALLET) { button(t('Connect wallet', '连接钱包'), connect); return; }
    if (j.owner && j.owner.toLowerCase() !== WALLET.toLowerCase()) {
      say(zh ? `已连接的钱包 ${short(WALLET)} 不是这张工资条上的钱包。请在钱包里切换到 ${short(j.owner)}。` : `The connected wallet ${short(WALLET)} is not the one on this payslip. Switch to ${short(j.owner)} in your wallet.`, 'down');
      return;
    }
    const p = plan;
    if (!p) { say(t('Wallet ', '钱包 ') + short(WALLET)); button(t('Check this trade', '检查这笔交易'), check); return; }
    say(zh ? `钱包 ${short(WALLET)} 持有 ${num(p.wallet.balance)} ${j.symbol}。` : `Wallet ${short(WALLET)} holds ${num(p.wallet.balance)} ${j.symbol}.`);
    if (!p.wallet.enough) { say(t('That is less than the amount entered.', '少于你输入的数量。'), 'down'); return; }
    if (p.wallet.needsApproval) {
      say((zh ? `第 1 步（共 2 步）：授权币安路由合约动用恰好这个数量的 ${j.symbol}。` : `Step 1 of 2: let Binance's router spend exactly this amount of ${j.symbol}.`) + (p.dryRun ? (p.dryRun.ok ? t(' Dry run passed.', '模拟执行通过。') : t(' Dry run failed: ', '模拟执行失败：') + (p.dryRun.reason || p.dryRun.status)) : ''), p.dryRun && !p.dryRun.ok ? 'down' : null);
      button(t('Approve ', '授权 ') + j.symbol, () => send(p.approveTx, 'approval'));
      return;
    }
    if (p.dryRun?.ok) {
      say(zh ? `已在币安 Transaction API 上模拟执行通过。你将收到${j.receive(p.quote.toAmount)}，最多允许 ${p.slippage}% 滑点。` : `Dry run passed on Binance's Transaction API. You would receive ${j.receive(p.quote.toAmount)}, with up to ${p.slippage}% slippage allowed.`, 'up');
      button(j.action, () => send(p.swapTx, 'swap'));
    } else {
      say(t('Dry run failed: ', '模拟执行失败：') + (p.dryRun?.reason || p.dryRun?.status || t('no result', '没有结果')) + t('. Nothing was sent.', '。没有发送任何交易。'), 'down');
      button(t('Check again', '重新检查'), check, true);
    }
  }

  async function connect() {
    try {
      const [account] = await ethereum.request({ method: 'eth_requestAccounts' });
      if (await ethereum.request({ method: 'eth_chainId' }) !== '0x38')
        await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
      WALLET = account;
      for (const f of FLOWS) f.render();
    } catch (e) { render(t('Could not connect: ', '连接失败：') + (e.message || e), true); }
  }

  async function check() {
    const j = job();
    busy = true;
    render(t('Preparing the trade and running it dry.', '正在准备交易并模拟执行。'));
    let error = null;
    try {
      const r = await fetch('/api/swap/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: WALLET, from: j.from, to: j.to, amount: j.amount, slippage: Math.ceil(j.slippage * 10) / 10 }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || r.status);
      plan = body;
    } catch (e) { plan = null; error = e.message; }
    busy = false;
    if (error) render(t('Could not prepare the trade: ', '无法准备交易：') + error, true); else render();
  }

  async function send(tx, what) {
    const j = job();
    let hash;
    try {
      hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: WALLET, to: tx.to, data: tx.data, value: '0x' + BigInt(tx.value || '0').toString(16), gas: '0x' + Math.ceil(Number(tx.gas || 450000) * 1.3).toString(16) }] });
    } catch (e) { return render(t('Nothing was sent: ', '没有发送任何交易：') + (e.message || e), true); }
    busy = true;
    render(zh ? `${kind(what)}已发送，等待 BNB Chain 确认。` : `Sent the ${what}. Waiting for BNB Chain to confirm it.`);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      let receipt = null;
      try { receipt = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] }); } catch {}
      if (!receipt) continue;
      busy = false;
      if (receipt.status !== '0x1') { plan = null; return render(zh ? `${kind(what)}在链上失败。交易 ${short(hash)}。` : `The ${what} failed on-chain. Transaction ${short(hash)}.`, true); }
      if (what === 'approval') return check();
      plan = null;
      const a = el('a', null, t('View the transaction on BscScan', '在 BscScan 查看交易'));
      a.href = 'https://bscscan.com/tx/' + hash; a.target = '_blank'; a.rel = 'noopener';
      const p = el('p', 'note');
      p.append(a);
      box.replaceChildren(el('p', 'note up', j.done), p);
      return;
    }
    busy = false;
    render(zh ? `仍在等待交易 ${short(hash)}，可在 BscScan 查看。` : `Still waiting on transaction ${short(hash)}. Check it on BscScan.`);
  }

  const flow = { render, clear() { plan = null; busy = false; } };
  FLOWS.add(flow);
  return flow;
}
