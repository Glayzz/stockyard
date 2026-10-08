// One swap, signed in the user's own wallet, from one button. The page says what the trade is;
// this file gets it ready in the background, asks the wallet for each signature in turn, waits
// for BNB Chain, and prints a receipt. The server checks that the trade would go through before
// anything is signed, and the user only hears about that check if it fails.
//
// job() describes the swap, or returns null while there is none:
//   { from, to, amount, slippage, owner?, action, link?,     link: an address that reopens this trade
//     spend:   { symbol, decimals, text(n) },      what leaves the wallet
//     receive: { decimals, text(n), usd } }        what arrives, and its dollar price per unit
let WALLET = null;
const FLOWS = new Set();
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
if (window.ethereum?.on) window.ethereum.on('accountsChanged', (list) => { WALLET = list[0] || null; for (const f of FLOWS) { f.clear(); f.render(); } });

function tradeFlow(box, job) {
  // plan: what the server prepared. stage: where a running trade has got to.
  let plan = null, planFor = null, planAt = 0, loading = null, stage = null, note = null;
  // The receipt stays under the trade box until the next trade replaces it.
  const slip = el('div', 'receipt-slot');
  box.after(slip);

  const say = (text, cls) => box.append(el('p', 'note' + (cls ? ' ' + cls : ''), text));
  const button = (text, fn, plain) => { const b = el('button', 'btn' + (plain ? ' plain' : ''), text); b.type = 'button'; b.onclick = fn; box.append(b); return b; };
  const keyOf = (j) => [WALLET, j.from, j.to, j.amount].join(':');
  const units = (raw, decimals) => Number(raw) / 10 ** decimals;

  // Ask the server for the trade, once per wallet and amount. Runs ahead of the click when it can.
  function prepare(j) {
    const key = keyOf(j);
    // A prepared trade is good for 40 seconds; after that the price behind it is too old.
    if (plan && planFor === key && Date.now() - planAt < 40000) return Promise.resolve(plan);
    if (loading?.key === key) return loading.promise;
    const promise = (async () => {
      const r = await fetch('/api/swap/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: WALLET, from: j.from, to: j.to, amount: j.amount, slippage: Math.ceil(j.slippage * 10) / 10 }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || r.status);
      if (loading?.key === key) { plan = body; planFor = key; planAt = Date.now(); loading = null; }
      return body;
    })();
    loading = { key, promise };
    promise.catch(() => { if (loading?.key === key) loading = null; });
    return promise;
  }

  function steps(now, two) {
    const row = el('div', 'steps');
    const names = two ? [t('Allow', '授权'), t('Swap', '兑换'), t('Done', '完成')] : [t('Swap', '兑换'), t('Done', '完成')];
    names.forEach((name, i) => row.append(el('span', i < now ? 'done' : i === now ? 'on' : '', (i < now ? '✓ ' : '') + name)));
    box.append(row);
  }

  function render() {
    box.replaceChildren();
    const j = job();
    if (stage) { steps(stage.step, stage.two); say(stage.text); return; }
    if (note) say(note.text, note.bad ? 'down' : null);
    if (!j) return;
    if (!window.ethereum) { noWallet(j); return; }
    if (!WALLET) { button(t('Connect wallet', '连接钱包'), connect); return; }
    if (j.owner && j.owner.toLowerCase() !== WALLET.toLowerCase()) {
      say(zh ? `已连接的钱包 ${short(WALLET)} 不是这张工资条上的钱包。请在钱包里切换到 ${short(j.owner)}。` : `The connected wallet ${short(WALLET)} is not the one on this payslip. Switch to ${short(j.owner)} in your wallet.`, 'down');
      return;
    }
    button(j.action, run);
    const ready = plan && planFor === keyOf(j) ? plan : null;
    if (ready && !ready.wallet.enough) say(zh ? `钱包 ${short(WALLET)} 只有 ${j.spend.text(ready.wallet.balance)}。` : `Wallet ${short(WALLET)} holds only ${j.spend.text(ready.wallet.balance)}.`, 'down');
    else say(t('Wallet ', '钱包 ') + short(WALLET) + (ready ? ' · ' + (ready.wallet.needsApproval ? t('you will confirm twice: once to allow the token, once to swap', '需要在钱包里确认两次：先授权，再兑换') : t('you will confirm once in your wallet', '只需在钱包里确认一次')) : ''));
    // Get the trade ready before the click, so the click goes straight to the wallet.
    if (!ready) prepare(j).then(() => { if (!stage) render(); }, () => {});
  }

  // A phone's own browser has no wallet in it. These links reopen this page inside a wallet app's
  // browser, where the Connect button shows. Each follows that wallet's own documented link; the
  // Binance one is built the way @binance/w3w-utils builds it. Any other wallet: copy the link.
  function noWallet(j) {
    if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      say(t('To trade, open this page in a browser with a BNB Chain wallet such as Binance Wallet or MetaMask.', '要交易，请在装有 BNB Chain 钱包（如币安钱包或 MetaMask）的浏览器中打开本页。'));
      return;
    }
    const url = j.link || location.href;
    const binance = 'bnc://app.binance.com/mp/app?appId=yFK5FCqYprrXDiVFbhyRx7&startPagePath=' + btoa('/pages/browser/index') + '&startPageQuery=' + btoa('url=' + url + '&defaultChainId=56');
    const apps = [
      [t('Binance Wallet', '币安钱包'), 'https://app.binance.com/en/download?_dp=' + btoa(binance)],
      ['MetaMask', 'https://metamask.app.link/dapp/' + url.replace(/^https?:\/\//, '')],
      ['Trust Wallet', 'https://link.trustwallet.com/open_url?coin_id=20000714&url=' + encodeURIComponent(url)],
      ['OKX Wallet', 'https://www.okx.com/download?deeplink=' + encodeURIComponent('okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(url))],
      ['Bitget Wallet', 'https://bkcode.vip?action=dapp&url=' + encodeURIComponent(url)],
      ['TokenPocket', 'tpdapp://open?params=' + encodeURIComponent(JSON.stringify({ url, chain: 'BSC', source: 'Stockyard' }))],
      ['Coinbase Wallet', 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(url)],
    ];
    say(t('To trade on your phone, open this page inside your wallet app:', '在手机上交易，请在钱包 App 里打开本页：'));
    const row = el('div', 'wallets');
    apps.forEach(([name, href], i) => { const a = el('a', 'btn' + (i ? ' plain' : ''), name); a.href = href; a.rel = 'noopener'; row.append(a); });
    const other = el('button', 'btn plain', t('Other · copy link', '其他 · 复制链接'));
    other.type = 'button';
    // If the browser will not copy, the link is shown instead, selected and ready to copy by hand.
    const shown = el('input', 'linkfield');
    shown.readOnly = true; shown.value = url; shown.hidden = true;
    other.onclick = async () => {
      if (await copyText(url)) { other.textContent = t('Copied', '已复制'); setTimeout(() => { other.textContent = t('Other · copy link', '其他 · 复制链接'); }, 1500); }
      else { shown.hidden = false; shown.focus(); shown.select(); }
    };
    row.append(other);
    box.append(row, shown);
    say(t('It opens there with this trade filled in and a Connect wallet button. With any other wallet, copy the link and paste it into the wallet\'s own browser.', '打开后这笔交易已填好，并会出现「连接钱包」按钮。其他钱包：复制链接，粘贴到钱包自带的浏览器里。'));
  }

  async function connect() {
    try {
      const [account] = await ethereum.request({ method: 'eth_requestAccounts' });
      if (await ethereum.request({ method: 'eth_chainId' }) !== '0x38')
        await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
      WALLET = account; note = null;
      for (const f of FLOWS) f.render();
    } catch (e) { note = { text: t('Could not connect: ', '连接失败：') + (e.message || e), bad: true }; render(); }
  }

  const fail = (text) => { stage = null; plan = null; note = { text, bad: true }; render(); };
  const rejected = (e) => e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || '');

  // Send one transaction and wait for it. Returns its receipt, or null if it never showed up.
  async function send(tx) {
    const hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: WALLET, to: tx.to, data: tx.data, value: '0x' + BigInt(tx.value || '0').toString(16), gas: '0x' + Math.ceil(Number(tx.gas || 450000) * 1.3).toString(16) }] });
    stage = { ...stage, text: t('Sent. Waiting for BNB Chain…', '已发送，等待 BNB Chain 确认…') }; render();
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      let receipt = null;
      try { receipt = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] }); } catch {}
      if (receipt) return { hash, receipt };
    }
    return { hash, receipt: null };
  }

  // The whole trade from one click: the allowance if it is needed, then the swap.
  async function run() {
    const j = job();
    if (!j) return;
    note = null; slip.replaceChildren();
    try {
      stage = { step: 0, two: false, text: t('Getting your trade ready…', '正在准备交易…') }; render();
      let p = await prepare(j);
      if (!p.wallet.enough) return fail(zh ? `钱包 ${short(WALLET)} 只有 ${j.spend.text(p.wallet.balance)}。` : `Wallet ${short(WALLET)} holds only ${j.spend.text(p.wallet.balance)}.`);
      const two = p.wallet.needsApproval;
      if (two) {
        if (p.dryRun && !p.dryRun.ok) return fail(t('This trade would fail right now, so nothing was sent. ', '这笔交易现在会失败，所以没有发送任何东西。') + (p.dryRun.reason || ''));
        stage = { step: 0, two, text: zh ? `请在钱包里确认：允许动用 ${j.spend.text(units(j.amount, j.spend.decimals))}。` : `Confirm in your wallet: allow ${j.spend.text(units(j.amount, j.spend.decimals))} to be swapped.` }; render();
        const a = await send(p.approveTx);
        if (!a.receipt) return fail(zh ? `还没等到确认。交易 ${short(a.hash)}，稍后再试。` : `Still waiting on transaction ${short(a.hash)}. Try again in a moment.`);
        if (a.receipt.status !== '0x1') return fail(t('The allowance did not go through. Nothing was swapped.', '授权没有成功，没有进行兑换。'));
        // A fresh price for the swap itself, now that it can be checked end to end.
        stage = { step: 1, two, text: t('Allowed. Getting the swap ready…', '已授权，正在准备兑换…') }; render();
        // The node the server reads may be a block behind the wallet's, so look again if needed.
        for (let i = 0; i < 4; i++) {
          plan = null;
          p = await prepare(j);
          if (!p.wallet.needsApproval) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (p.wallet.needsApproval) return fail(t('The allowance has not reached the network yet. Try again in a moment.', '授权还没有生效，请稍后再试。'));
      if (!p.dryRun?.ok) return fail(t('This trade would fail right now, so nothing was sent. ', '这笔交易现在会失败，所以没有发送任何东西。') + (p.dryRun?.reason || ''));
      stage = { step: two ? 1 : 0, two, text: t('Confirm the swap in your wallet.', '请在钱包里确认兑换。') }; render();
      const s = await send(p.swapTx);
      if (!s.receipt) return fail(zh ? `还没等到确认。交易 ${short(s.hash)}，可在 BscScan 查看。` : `Still waiting on transaction ${short(s.hash)}. Check it on BscScan.`);
      if (s.receipt.status !== '0x1') return fail(zh ? `兑换在链上失败了，你的币没有动。交易 ${short(s.hash)}。` : `The swap failed on-chain and your tokens did not move. Transaction ${short(s.hash)}.`);
      stage = null; plan = null;
      printReceipt(j, p, s);
      render();
      j.after?.();
    } catch (e) {
      fail(rejected(e) ? t('Cancelled in your wallet. Nothing was sent.', '已在钱包里取消，没有发送任何交易。') : t('That did not work: ', '没有成功：') + (e.message || e));
    }
  }

  // What actually moved, read from the transaction's own transfer events.
  function printReceipt(j, p, s) {
    const me = WALLET.toLowerCase().slice(2), moved = (token, topic) => {
      let sum = 0n;
      for (const l of s.receipt.logs || []) if (l.topics?.[0] === TRANSFER && l.topics.length === 3 && l.address.toLowerCase() === token.toLowerCase() && l.topics[topic].slice(26).toLowerCase() === me) sum += BigInt(l.data);
      return sum;
    };
    const out = moved(j.from, 1), got = moved(j.to, 2);
    const spent = units(out > 0n ? out : j.amount, j.spend.decimals), received = units(got > 0n ? got : p.quote.toAmount, j.receive.decimals);
    const fee = s.receipt.gasUsed && s.receipt.effectiveGasPrice ? Number(BigInt(s.receipt.gasUsed) * BigInt(s.receipt.effectiveGasPrice)) / 1e18 : null;
    const card = el('div', 'receipt');
    const head = el('div', 'receipt-head');
    head.append(el('span', 'cn', '成交单'), el('span', 'en', t('TRADE RECEIPT', '交易回执')));
    const body = el('div', 'receipt-body');
    const line = (k, v, big) => { const r = el('div', 'receipt-row' + (big ? ' big' : '')); r.append(el('span', null, k), el('b', null, v)); body.append(r); };
    line(t('YOU GAVE', '你付出'), j.spend.text(spent));
    line(t('YOU GOT', '你得到'), j.receive.text(received), true);
    if (j.receive.usd) line(t('WORTH ABOUT', '约值'), usd(received * j.receive.usd));
    if (fee != null) line(t('NETWORK FEE', '网络费'), fee.toFixed(6) + ' BNB');
    line(t('WALLET', '钱包'), short(WALLET));
    line(t('TIME', '时间'), new Date().toLocaleString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    const seal = el('span', 'receipt-seal');
    seal.append(el('span', null, '已成交'), el('small', null, 'FILLED'));
    body.append(seal);
    const foot = el('div', 'receipt-foot');
    const tx = el('a', 'btn plain', t('View on BscScan ↗', '在 BscScan 查看 ↗'));
    tx.href = 'https://bscscan.com/tx/' + s.hash; tx.target = '_blank'; tx.rel = 'noopener';
    const pay = el('a', 'btn', t('Print my payslip', '打印我的工资条'));
    pay.href = 'payslip.html?w=' + WALLET;
    foot.append(tx, pay);
    card.append(head, body, el('div', 'receipt-tx', s.hash), foot);
    slip.replaceChildren(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const flow = { render, clear() { plan = null; planFor = null; loading = null; if (!stage) note = null; } };
  FLOWS.add(flow);
  return flow;
}
