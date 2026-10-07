// Stockyard in Telegram: print a wallet's payslip, browse the league, look up a coin, get a quote,
// and be told when a watched wallet is paid. Long polling, so it needs no public address.
// It starts only when TELEGRAM_BOT_TOKEN is set. It never holds a key and never sends a trade.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handle } from './routes.mjs';
import { status } from './status.mjs';

const STATE = fileURLToPath(new URL('../data/telegram.json', import.meta.url));
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const WIDTH = 28, RULE = '─'.repeat(WIDTH);
const MAX_WATCHED = 200;

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toPrecision(3) : '$0';
const num = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(4);
const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
// Chinese characters take two columns in a monospace block.
const width = (s) => [...s].reduce((a, c) => a + (c.codePointAt(0) > 0x2e7f ? 2 : 1), 0);
const row = (left, right) => left + ' '.repeat(Math.max(1, WIDTH - width(left) - width(right))) + right;
const units = (amount, decimals = 18) => {
  const [whole, frac = ''] = String(amount).split('.');
  return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
};

let token, site, base, state = { offset: 0, chats: {} };
const save = () => { try { writeFileSync(STATE, JSON.stringify(state)); } catch {} };
const chatOf = (id, from) => (state.chats[id] ??= { lang: (from?.language_code || '').toLowerCase().startsWith('zh') ? 'zh' : 'en' });

async function api(path, query) {
  const { status, json } = await handle('GET', path, query || {});
  if (status !== 200) throw new Error(json.error || 'Stockyard answered ' + status);
  return json;
}

async function tg(method, body) {
  const r = await fetch(`${base}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(40000),
  });
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.description || 'Telegram answered ' + r.status), { code: j.error_code });
  return j.result;
}
const send = (chat, html, keyboard) => tg('sendMessage', {
  chat_id: chat, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  ...(keyboard && { reply_markup: { inline_keyboard: keyboard } }),
});

const day = (ms, zh, year) => new Date(ms).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
const grade = (total, zh) => {
  const g = total <= 0 ? ['试用期', 'On probation'] : total < 1 ? ['实习牛马', 'Intern'] : total < 10 ? ['初级牛马', 'Junior'] : total < 100 ? ['高级牛马', 'Senior'] : total < 1000 ? ['主管', 'Manager'] : ['股东', 'Shareholder'];
  return zh ? g[0] : g[0] + ' · ' + g[1];
};
const nameOf = (x, zh) => (zh && x.nameZh) || x.name;

// The payslip as a monospace receipt.
function slip(d, zh) {
  const t = (en, cn) => (zh ? cn : en);
  const out = [row(t('EMPLOYEE', '员工'), short(d.wallet))];
  const names = d.employers.map((e) => e.coin);
  out.push(row(t('EMPLOYERS', '雇主'), names.length ? names.slice(0, 2).join(', ') + (d.employerCount > 2 ? ' +' + (d.employerCount - 2) : '') : t('none yet', '暂无')));
  out.push(row(t('GRADE', '职级'), grade(d.paid ? d.paid.usd : d.total, zh)), RULE);
  if (!d.lines.length) out.push(t('No stock in this wallet yet', '这个钱包还没有股票'));
  for (const l of d.lines.slice(0, 6)) {
    out.push(nameOf(l, zh), row(' ' + num(l.shares) + t(' shares', ' 股'), usd(l.value)));
    if (l.paid) out.push(' ' + (zh ? `自 ${day(l.paid.first, zh)} 起发放 ${l.paid.count}${l.paid.more ? '+' : ''} 次` : `${l.paid.count}${l.paid.more ? '+' : ''} payouts since ${day(l.paid.first, zh)}`));
  }
  if (d.lines.length > 6) out.push(t(` and ${d.lines.length - 6} more stocks`, ` 另有 ${d.lines.length - 6} 只股票`));
  if (d.recent.length) {
    out.push(RULE, t('LATEST PAYOUTS', '最近发放'));
    for (const p of d.recent.slice(0, 4)) out.push(row(' ' + day(p.time, zh) + '  +' + num(p.shares), usd(p.value)));
  }
  out.push(RULE, row(d.paid ? t(d.paid.atLeast ? 'PAID, AT LEAST' : 'PAID TO DATE', d.paid.atLeast ? '累计已发（至少）' : '累计已发') : t('STOCK HELD', '钱包内股票'), usd(d.paid ? d.paid.usd : d.total)));
  const foot = d.paid
    ? (zh ? `已发薪 ✅ 自 ${day(d.paid.since, zh, true)} 起共 ${d.paid.count} 次，今天持有 ${usd(d.total)} 的股票。` : `已发薪 ✅ ${d.paid.count} payouts since ${day(d.paid.since, zh, true)}, holding ${usd(d.total)} of stock today.`)
    : d.history ? t('No payouts found. Stock you bought yourself shows in the balance but is not pay.', '未发现分红。你自己买的股票计入余额，但不算工资。')
      : t('Payout history is unavailable right now, so this slip shows balances only.', '暂时拿不到分红记录，这张工资条只显示余额。');
  return `<b>牛马工资条 · ${t('PAYSLIP', '以股票发薪')}</b>\n<pre>${esc(out.join('\n'))}</pre>\n${esc(foot)}`;
}

async function sendSlip(chat, c, wallet) {
  const zh = c.lang === 'zh', d = await api('/api/payslip', { w: wallet });
  const keys = [[
    { text: zh ? '↻ 刷新' : '↻ Refresh', callback_data: 'p:' + d.wallet },
    c.wallet === d.wallet ? { text: zh ? '🔕 关闭发薪提醒' : '🔕 Stop payday alerts', callback_data: 'u:' } : { text: zh ? '🔔 发薪时提醒我' : '🔔 Tell me on payday', callback_data: 'w:' + d.wallet },
  ]];
  if (site) keys.push([{ text: zh ? '打开完整工资条' : 'Open the full payslip', url: `${site}/payslip.html?w=${d.wallet}` }]);
  return send(chat, slip(d, zh), keys);
}

async function sendLeague(chat, c, stock) {
  const zh = c.lang === 'zh', lg = await api('/api/league');
  const big = lg.rows.filter((r) => r.mcap >= 100000 && r.stockUsd >= 1000);
  const want = (stock || '').toUpperCase();
  const list = big.filter((r) => !want || r.ticker === want || r.sym === want).sort((a, b) => b.stockUsd - a.stockUsd).slice(0, 10);
  if (!list.length) return send(chat, esc(zh ? `没有与 ${want} 配对、市值 $100K 以上的币。` : `No coin worth $100K or more trades against ${want}.`));
  const lines = list.map((r, i) => row(String(i + 1).padStart(2) + ' ' + [...r.coin].slice(0, 10).join(''), usd(r.stockUsd)) + '\n' + row('    ' + nameOf(r, zh), (zh ? '市值 ' : 'cap ') + usd(r.mcap)));
  // The three companies with the most stock in meme pools become filter buttons.
  const by = {};
  for (const r of big) (by[r.ticker] ??= { ticker: r.ticker, name: nameOf(r, zh), usd: 0 }).usd += r.stockUsd;
  const top = Object.values(by).sort((a, b) => b.usd - a.usd).slice(0, 3);
  const keys = [];
  for (let i = 0; i < Math.min(list.length, 6); i += 2) keys.push(list.slice(i, i + 2).map((r) => ({ text: r.coin, callback_data: 'c:' + r.address })));
  keys.push([{ text: zh ? '全部' : 'All', callback_data: 'l:' }, ...top.map((s) => ({ text: s.name, callback_data: 'l:' + s.ticker }))]);
  const title = want ? (zh ? `${nameOf(list[0], zh)} 排行榜` : `The ${nameOf(list[0], zh)} league`) : (zh ? '股票 Meme 排行榜' : 'The stock league');
  const sub = zh ? `Meme 池里共有 ${usd(lg.stats.stockUsd)} 的真实美股，按池内持股排名。` : `${usd(lg.stats.stockUsd)} of real US stock sits in meme pools. Ranked by stock in the pool.`;
  return send(chat, `<b>${esc(title)}</b>\n${esc(sub)}\n<pre>${esc(lines.join('\n'))}</pre>`, keys);
}

// A coin by address, or by symbol: the one with the most stock in its pool wins a name clash.
async function findCoin(q) {
  const lg = await api('/api/league'), key = String(q || '').toLowerCase();
  const rows = lg.rows.filter((r) => (isAddr(key) ? r.address === key : r.coin.toLowerCase() === key)).sort((a, b) => b.stockUsd - a.stockUsd);
  return rows[0] || null;
}

async function sendCoin(chat, c, q) {
  const zh = c.lang === 'zh', t = (en, cn) => (zh ? cn : en);
  const r = await findCoin(q);
  if (!r) return send(chat, esc(t(`No stock meme called "${q}". Try /league.`, `没有叫“${q}”的股票 Meme。试试 /league。`)));
  const d = await api('/api/coin', { a: r.address }), stock = nameOf(d.stock, zh);
  // Split the last 24 hours of hourly closes into the coin's move and the stock's move.
  const move = (s) => { const cut = Date.now() / 1000 - 86400, before = s.filter((p) => p[0] < cut).pop() || s[0]; return s.length > 1 ? s[s.length - 1][1] / before[1] - 1 : null; };
  const coin24 = move(d.series.coin), stock24 = move(d.series.stock);
  const out = [row(t('MARKET CAP', '市值'), usd(d.coin.mcap))];
  if (d.coin.vol24 != null) out.push(row(t('24H VOLUME', '24小时成交额'), usd(d.coin.vol24)));
  if (d.coin.holders) out.push(row(t('HOLDERS', '持有人'), d.coin.holders.toLocaleString('en-US')));
  out.push(row(t('IN ITS POOL', '池内股票'), num(d.pool.shares) + t(' shares', ' 股')), row('', t('worth ', '价值 ') + usd(d.pool.stockUsd)));
  if (coin24 != null && stock24 != null) out.push(RULE, t('LAST 24 HOURS', '过去24小时'), row(t(' in dollars', ' 美元价格'), pct(coin24)), row(t(' from the meme', ' 来自 Meme'), pct((1 + coin24) / (1 + stock24) - 1)), row(t(' from the stock', ' 来自股票'), pct(stock24)));
  const head = `<b>${esc(d.coin.symbol)}</b> · ${usd(d.coin.price)}` + (coin24 != null ? ` · ${pct(coin24)} 24h` : '');
  const tail = zh ? `报价：/sell ${d.coin.symbol} 100000 或 /buy ${d.coin.symbol} 0.05` : `Quotes: /sell ${d.coin.symbol} 100000 or /buy ${d.coin.symbol} 0.05`;
  const keys = [[{ text: 'BscScan', url: 'https://bscscan.com/token/' + r.address }]];
  if (site) keys[0].push({ text: t('Open on Stockyard', '在 Stockyard 打开'), url: `${site}/coin.html?a=${r.address}` });
  return send(chat, `${head}\n${esc(t('Trades against ', '配对：') + stock)}\n<pre>${esc(out.join('\n'))}</pre>\n${esc(tail)}`, keys);
}

// Two live quotes from Binance's aggregator: through the stock, and through USDT.
async function sendQuote(chat, c, side, q, amount) {
  const zh = c.lang === 'zh', t = (en, cn) => (zh ? cn : en);
  if (!q || !/^\d+(\.\d+)?$/.test(amount || '') || !(Number(amount) > 0))
    return send(chat, esc(side === 'sell' ? t('Use it like this: /sell NIUMA 100000', '用法：/sell NIUMA 100000') : t('Use it like this: /buy NIUMA 0.05 (shares of the stock to spend)', '用法：/buy NIUMA 0.05（花费的股票股数）')));
  const r = await findCoin(q);
  if (!r) return send(chat, esc(t(`No stock meme called "${q}". Try /league.`, `没有叫“${q}”的股票 Meme。试试 /league。`)));
  const lg = await api('/api/league'), price = lg.stocks[r.sym]?.price || 0, stock = nameOf(r, zh), dec = r.decimals ?? 18;
  const quote = (from, to, amt) => api('/api/quote', { from, to, amount: amt }).catch((e) => ({ error: e.message }));
  const swaps = (x) => { const n = x.hops.length - 1; return zh ? n + ' 次兑换' : n + (n === 1 ? ' swap' : ' swaps'); };
  const out = [];
  let title;
  if (side === 'sell') {
    const [keep, cash] = await Promise.all([quote(r.address, r.stock, units(amount, dec)), quote(r.address, USDT, units(amount, dec))]);
    title = t(`Sell ${num(Number(amount))} ${r.coin}`, `卖出 ${num(Number(amount))} ${r.coin}`);
    if (keep.error) out.push(t('KEEP THE STOCK', '留下股票'), ' ' + keep.error);
    else { const sh = Number(keep.toAmount) / 1e18; out.push(row(t('KEEP THE STOCK', '留下股票'), swaps(keep)), ' ' + num(sh) + t(' shares of ', ' 股 ') + stock, ' ' + t('worth about ', '约值 ') + usd(sh * price)); }
    if (cash.error) out.push(t('TAKE CASH', '换成现金'), ' ' + cash.error);
    else out.push(row(t('TAKE CASH', '换成现金'), swaps(cash)), ' ' + usd(Number(cash.toAmount) / 1e18) + t(' in USDT', '（USDT）'));
  } else {
    const dollars = Number(amount) * price;
    const [paid, cash] = await Promise.all([quote(r.stock, r.address, units(amount)), dollars > 0 ? quote(USDT, r.address, units(dollars.toFixed(6))) : { error: t('No price for this stock', '这只股票暂无价格') }]);
    title = t(`Buy ${r.coin} with ${amount} ${stock} shares (about ${usd(dollars)})`, `用 ${amount} 股 ${stock}（约 ${usd(dollars)}）买入 ${r.coin}`);
    const coins = (x) => ' ' + num(Number(x.toAmount) / 10 ** dec) + ' ' + r.coin;
    if (paid.error) out.push(t('PAY WITH THE STOCK', '用股票支付'), ' ' + paid.error);
    else out.push(row(t('PAY WITH THE STOCK', '用股票支付'), swaps(paid)), coins(paid));
    if (cash.error) out.push(t('PAY WITH CASH', '用现金支付'), ' ' + cash.error);
    else out.push(row(t('PAY WITH CASH', '用现金支付'), swaps(cash)), coins(cash), ' ' + t('for the same dollars in USDT', '花费等值的 USDT'));
  }
  const note = t('Live quotes from Binance\'s aggregator. This bot never trades: sign on the coin page with your own wallet, or use your Binance Agentic Wallet.', '报价来自币安聚合器。本机器人不会交易：请在币页面用自己的钱包签名，或使用币安 Agentic Wallet。');
  const keys = site ? [[{ text: t('Open the coin page', '打开币页面'), url: `${site}/coin.html?a=${r.address}` }]] : undefined;
  return send(chat, `<b>${esc(title)}</b>\n<pre>${esc(out.join('\n'))}</pre>\n${esc(note)}`, keys);
}

async function watch(chat, c, wallet) {
  const zh = c.lang === 'zh';
  if (!isAddr(wallet)) return send(chat, esc(zh ? '用法：/watch 0x… 钱包地址' : 'Use it like this: /watch 0x… wallet address'));
  if (!c.wallet && Object.values(state.chats).filter((x) => x.wallet).length >= MAX_WATCHED) return send(chat, esc(zh ? '提醒名额已满，请稍后再试。' : 'Payday alerts are full right now. Try again later.'));
  const d = await api('/api/payslip', { w: wallet });
  // Start from the newest payout already made, so only new ones are announced.
  c.wallet = d.wallet; c.seen = Math.max(Date.now(), ...d.recent.map((p) => p.time));
  save();
  const last = d.recent[0];
  return send(chat, esc(zh
    ? `🔔 已开启。${short(d.wallet)} 每次收到股票分红，我都会告诉你。` + (last ? `上一次是 ${day(last.time, zh)}：+${num(last.shares)} 股 ${nameOf(last, zh)}。` : '这个钱包还没有收到过分红。')
    : `🔔 On. I will tell you each time ${short(d.wallet)} is paid in stock. ` + (last ? `The last one was ${day(last.time, zh)}: +${num(last.shares)} ${last.name} shares.` : 'This wallet has not been paid yet.')));
}

const HELP = {
  en: [
    '<b>Stockyard</b> · the home for stock memes on BNB Chain',
    'Stock memes are meme coins that trade against a tokenized stock, and some pay their holders in that stock.',
    '',
    'Paste a wallet address to print its 牛马工资条 payslip.',
    '/league · every stock meme, ranked by the stock in its pool',
    '/league SPY · one company\'s league',
    '/coin NIUMA · price, pool, and how much of the move was the stock',
    '/sell NIUMA 100000 · quote: keep the stock, or take cash',
    '/buy NIUMA 0.05 · quote: pay with the stock',
    '/watch 0x… · tell me when this wallet is paid',
    '/unwatch · stop payday alerts',
    '/lang · 中文',
  ],
  zh: [
    '<b>Stockyard</b> · BNB Chain 上股票 Meme 的家',
    '股票 Meme 是与代币化股票配对交易的 Meme 币，其中一些会用这只股票给持有人分红。',
    '',
    '粘贴一个钱包地址，打印它的牛马工资条。',
    '/league · 全部股票 Meme，按池内持股排名',
    '/league SPY · 某一只股票的排行榜',
    '/coin NIUMA · 价格、池子，以及涨跌里有多少来自股票',
    '/sell NIUMA 100000 · 报价：留下股票，还是换成现金',
    '/buy NIUMA 0.05 · 报价：用股票买入',
    '/watch 0x… · 这个钱包发薪时提醒我',
    '/unwatch · 关闭发薪提醒',
    '/lang · English',
  ],
};

// No more than twelve requests a minute from one chat, so one user cannot use up the Binance quota.
const recent = new Map();
function tooFast(chat) {
  const now = Date.now(), list = (recent.get(chat) || []).filter((at) => now - at < 60000);
  list.push(now);
  recent.set(chat, list);
  return list.length > 12;
}

async function onText(chat, c, text) {
  const zh = c.lang === 'zh';
  const [first, ...rest] = text.trim().split(/\s+/);
  const cmd = first.startsWith('/') ? first.slice(1).split('@')[0].toLowerCase() : null;
  if (!cmd) return isAddr(first) ? sendSlip(chat, c, first) : send(chat, HELP[c.lang].join('\n'));
  if (cmd === 'start' || cmd === 'help') return send(chat, HELP[c.lang].join('\n'));
  if (cmd === 'lang') { c.lang = zh ? 'en' : 'zh'; save(); return send(chat, HELP[c.lang].join('\n')); }
  if (cmd === 'payslip') return isAddr(rest[0]) ? sendSlip(chat, c, rest[0]) : send(chat, esc(zh ? '用法：/payslip 0x… 钱包地址' : 'Use it like this: /payslip 0x… wallet address'));
  if (cmd === 'league') return sendLeague(chat, c, rest[0]);
  if (cmd === 'coin') return rest[0] ? sendCoin(chat, c, rest[0]) : send(chat, esc(zh ? '用法：/coin NIUMA' : 'Use it like this: /coin NIUMA'));
  if (cmd === 'sell' || cmd === 'buy') return sendQuote(chat, c, cmd, rest[0], rest[1]);
  if (cmd === 'watch') return watch(chat, c, rest[0]);
  if (cmd === 'unwatch') { delete c.wallet; delete c.seen; save(); return send(chat, esc(zh ? '🔕 已关闭发薪提醒。' : '🔕 Payday alerts are off.')); }
  return send(chat, HELP[c.lang].join('\n'));
}

async function onUpdate(u) {
  const msg = u.message, cb = u.callback_query;
  const chat = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (chat == null) return;
  const c = chatOf(chat, msg?.from || cb?.from);
  if (cb) tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
  if (tooFast(chat)) return recent.get(chat).length === 13 ? send(chat, esc(c.lang === 'zh' ? '太快了，请等一分钟。' : 'Too fast. Give it a minute.')) : null;
  try {
    if (msg?.text) return await onText(chat, c, msg.text);
    if (!cb?.data) return;
    const kind = cb.data.slice(0, 2), arg = cb.data.slice(2);
    if (kind === 'p:') return await sendSlip(chat, c, arg);
    if (kind === 'w:') return await watch(chat, c, arg);
    if (kind === 'u:') return await onText(chat, c, '/unwatch');
    if (kind === 'c:') return await sendCoin(chat, c, arg);
    if (kind === 'l:') return await sendLeague(chat, c, arg);
  } catch (err) {
    console.log('telegram:', err.message);
    await send(chat, esc((c.lang === 'zh' ? '出错了：' : 'That did not work: ') + err.message)).catch(() => {});
  }
}

// Every five minutes, look at each watched wallet and announce payouts newer than the last one seen.
async function payday() {
  for (const [chat, c] of Object.entries(state.chats)) {
    if (!c.wallet) continue;
    try {
      const d = await api('/api/payslip', { w: c.wallet }), zh = c.lang === 'zh';
      const fresh = d.recent.filter((p) => p.time > (c.seen || 0)).sort((a, b) => a.time - b.time);
      for (const p of fresh) {
        const keys = [[{ text: zh ? '查看交易' : 'View the transaction', url: 'https://bscscan.com/tx/' + p.hash }, { text: zh ? '打印工资条' : 'Print the payslip', callback_data: 'p:' + d.wallet }]];
        await send(chat, `<b>🐂 ${zh ? '发薪了' : '发薪了 · Payday'}</b>\n` + esc(zh ? `${short(d.wallet)} 刚收到 +${num(p.shares)} 股 ${nameOf(p, zh)}（${usd(p.value)}）。` : `+${num(p.shares)} ${p.name} shares (${usd(p.value)}) just landed in ${short(d.wallet)}.`), keys);
      }
      if (fresh.length) { c.seen = fresh[fresh.length - 1].time; save(); }
    } catch (err) {
      // A user who blocked the bot stops being watched.
      if (err.code === 403) { delete c.wallet; save(); }
    }
    await sleep(1500);
  }
}

// For tests: run a payday check now, and reach the chats it would check.
export const internals = { payday, chats: () => state.chats };

export async function startTelegram() {
  token = process.env.TELEGRAM_BOT_TOKEN;
  site = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  base = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
  if (!token) return;
  if (existsSync(STATE)) { try { state = { offset: 0, chats: {}, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch {} }
  const commands = (zh) => [
    { command: 'payslip', description: zh ? '打印钱包的牛马工资条' : 'Print a wallet\'s payslip' },
    { command: 'league', description: zh ? '股票 Meme 排行榜' : 'The stock meme league' },
    { command: 'coin', description: zh ? '查看一个币' : 'Look up a coin' },
    { command: 'sell', description: zh ? '卖出报价：留下股票或换现金' : 'Sell quote: keep the stock or take cash' },
    { command: 'buy', description: zh ? '买入报价：用股票支付' : 'Buy quote: pay with the stock' },
    { command: 'watch', description: zh ? '发薪时提醒我' : 'Tell me on payday' },
    { command: 'lang', description: zh ? 'English' : '中文' },
  ];
  try {
    const me = await tg('getMe');
    console.log('Telegram bot @' + me.username + ' is listening');
    status.telegram = '@' + me.username;
  } catch (err) { console.log('Telegram bot did not start:', err.message); return; }

  // The command menu and profile texts are set in the background, so a slow or failed call there
  // never keeps the bot from answering.
  (async () => {
    await tg('setMyCommands', { commands: commands(false) });
    await tg('setMyCommands', { commands: commands(true), language_code: 'zh' });
    // What a new user reads before pressing Start, and the line on the bot's profile.
    await tg('setMyDescription', { description: [
      'Stock memes are meme coins on BNB Chain that trade against a tokenized stock, and some pay their holders in that stock.', '',
      'Paste a wallet to print its 牛马工资条 payslip, browse the league, get quotes, and be told on payday. This bot never holds a key and never trades.',
    ].join('\n') });
    await tg('setMyDescription', { language_code: 'zh', description: [
      '股票 Meme 是 BNB Chain 上与代币化股票配对交易的 Meme 币，其中一些会用这只股票给持有人分红。', '',
      '粘贴钱包地址打印牛马工资条，查看排行榜、获取报价，发薪时收到提醒。本机器人不持有任何私钥，也不会交易。',
    ].join('\n') });
    await tg('setMyShortDescription', { short_description: 'Payslips, league and payday alerts for stock memes on BNB Chain. Holds no keys.' });
    await tg('setMyShortDescription', { language_code: 'zh', short_description: 'BNB Chain 股票 Meme 的工资条、排行榜和发薪提醒。不持有私钥。' });
  })().catch((err) => console.log('Telegram profile setup:', err.message));

  setInterval(() => payday().catch(() => {}), 300000).unref();
  for (;;) {
    try {
      const updates = await tg('getUpdates', { offset: state.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      status.telegramPolledAt = new Date().toISOString();
      for (const u of updates) { state.offset = u.update_id + 1; onUpdate(u); }
      if (updates.length) save();
    } catch (err) {
      if (err.code === 401) { console.log('Telegram bot stopped: the token was refused'); return; }
      // 409 means another copy of the bot is polling with the same token.
      await sleep(err.code === 409 ? 30000 : 5000);
    }
  }
}
