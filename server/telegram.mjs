// Stockyard in Telegram. Every screen is a picture in the site's own look with a row of buttons
// under it: home, the league, a coin's card, a wallet's payslip. Tapping a button redraws the
// same message, so a chat holds one live screen plus the payslips it printed. Long polling, so it
// needs no public address. It starts only when TELEGRAM_BOT_TOKEN is set. It holds no key and
// cannot trade: a price check shows what a trade would give right now, and the trade itself is
// signed on the site in the user's own wallet.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './net.mjs';
import { handle } from './routes.mjs';
import { status } from './status.mjs';
import { slipImage } from './slip-image.mjs';
import { homeImage, leagueImage, coinImage } from './cards.mjs';

const STATE = fileURLToPath(new URL('../data/telegram.json', import.meta.url));
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const DEMO = '0xe1b0e19f8e014e760bfa6f81769fd3587cf9d767'; // NIUMA's treasury, offered as an example
const MAX_WATCHED = 200;

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toPrecision(3) : '$0';
const num = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(4);
const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const plain = (n) => n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 6 });
const units = (amount, decimals = 18) => {
  const [whole, frac = ''] = String(amount).split('.');
  return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
};
const nameOf = (x, zh) => (zh && x.nameZh) || x.name;
const day = (ms, zh, year) => new Date(ms).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
const listed = (r) => r.mcap >= 100000 && r.stockUsd >= 1000;

let token, site, base, state = { offset: 0, chats: {} };
const save = () => { try { writeFileSync(STATE, JSON.stringify(state)); } catch {} };
const chatOf = (id, from) => (state.chats[id] ??= { lang: (from?.language_code || '').toLowerCase().startsWith('zh') ? 'zh' : 'en' });

async function api(path, query) {
  const { status: code, json } = await handle('GET', path, query || {});
  if (code !== 200) throw new Error(json.error || 'Stockyard answered ' + code);
  return json;
}

async function tg(method, body) {
  const form = body instanceof FormData;
  const r = await fetch(`${base}/bot${token}/${method}`, {
    method: 'POST', body: form ? body : JSON.stringify(body || {}), signal: AbortSignal.timeout(form ? 120000 : 40000),
    ...(!form && { headers: { 'content-type': 'application/json' } }),
  });
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.description || 'Telegram answered ' + r.status), { code: j.error_code });
  return j.result;
}

// ---- how a screen reaches the chat ----
const btn = (text, data) => ({ text, callback_data: data });
const link = (text, url) => ({ text, url });
const markup = (keys) => (keys?.length ? { reply_markup: { inline_keyboard: keys } } : {});
const same = (err) => /not modified/i.test(err.message);
const send = (chat, html, keys) => tg('sendMessage', { chat_id: chat, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup(keys) });
function sendPhoto(chat, png, caption, keys) {
  const form = new FormData();
  form.set('chat_id', String(chat)); form.set('caption', caption); form.set('parse_mode', 'HTML');
  if (keys?.length) form.set('reply_markup', JSON.stringify({ inline_keyboard: keys }));
  form.set('photo', new Blob([png], { type: 'image/png' }), 'stockyard.png');
  return tg('sendPhoto', form);
}
function editMedia(chat, message, png, caption, keys) {
  const form = new FormData();
  form.set('chat_id', String(chat)); form.set('message_id', String(message));
  form.set('media', JSON.stringify({ type: 'photo', media: 'attach://photo', caption, parse_mode: 'HTML' }));
  if (keys?.length) form.set('reply_markup', JSON.stringify({ inline_keyboard: keys }));
  form.set('photo', new Blob([png], { type: 'image/png' }), 'stockyard.png');
  return tg('editMessageMedia', form);
}
const busy = (chat, action) => { tg('sendChatAction', { chat_id: chat, action }).catch(() => {}); };

// Show a whole screen. With a picture it replaces the picture under the tapped button; where it
// cannot (the tap came from a text message), it sends the picture and clears the text away.
async function screen(ctx, { png, caption, text, keys }) {
  if (png) {
    if (ctx.msg && ctx.photo) { try { return await editMedia(ctx.chat, ctx.msg, png, caption, keys); } catch (err) { if (same(err)) return null; } }
    const sent = await sendPhoto(ctx.chat, png, caption, keys);
    if (ctx.msg && !ctx.photo) tg('deleteMessage', { chat_id: ctx.chat, message_id: ctx.msg }).catch(() => {});
    return sent;
  }
  // No image library on this server: the same screen in words.
  if (ctx.msg && !ctx.photo) { try { return await tg('editMessageText', { chat_id: ctx.chat, message_id: ctx.msg, text: text || caption, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup(keys) }); } catch (err) { if (same(err)) return null; } }
  return send(ctx.chat, text || caption, keys);
}
// Change only the words and buttons under the screen that is already there.
async function say(ctx, html, keys) {
  if (ctx.msg) {
    try {
      return ctx.photo
        ? await tg('editMessageCaption', { chat_id: ctx.chat, message_id: ctx.msg, caption: html, parse_mode: 'HTML', ...markup(keys) })
        : await tg('editMessageText', { chat_id: ctx.chat, message_id: ctx.msg, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup(keys) });
    } catch (err) { if (same(err)) return null; }
  }
  return send(ctx.chat, html, keys);
}

// ---- screens ----
async function home(ctx) {
  const zh = ctx.c.lang === 'zh';
  delete ctx.c.expect;
  const lg = await api('/api/league');
  const caption = zh
    ? '<b>Stockyard</b> · 股票 Meme 的家\nBNB Chain 上与真实美股配对交易的 Meme 币，其中一些会用这只股票给持有人发工资。\n\n想看什么？'
    : '<b>Stockyard</b> · the home for stock memes\nMeme coins on BNB Chain that trade against real US stocks. Some pay their holders in that stock.\n\nWhat do you want to see?';
  const keys = [
    [btn(zh ? '🧾 工资条' : '🧾 Payslip', 'ps'), btn(zh ? '🏆 排行榜' : '🏆 League', 'l:')],
    [btn(zh ? '🔔 发薪提醒' : '🔔 Payday alerts', 'al'), btn(zh ? '🌐 English' : '🌐 中文', 'lg')],
  ];
  if (site) keys.push([link(zh ? '打开 Stockyard 网站 ↗' : 'Open the Stockyard site ↗', site)]);
  return screen(ctx, { png: await homeImage(lg.stats, lg.rows.filter(listed).length, zh).catch(() => null), caption, keys });
}

function askWallet(ctx) {
  const zh = ctx.c.lang === 'zh';
  ctx.c.expect = 'slip';
  return say(ctx, zh
    ? '🧾 <b>牛马工资条</b>\n把钱包地址（0x…）发给我，我把它的 Meme 用股票发给它的工资打印出来。'
    : '🧾 <b>Payslip</b>\nSend me a wallet address (0x…) and I will print what its memes have paid it in stock.', [
    [btn(zh ? '看个例子：NIUMA 金库' : 'Show me one: NIUMA\'s treasury', 'p:' + DEMO)], [btn(zh ? '‹ 首页' : '‹ Home', 'h')],
  ]);
}

function slipCaption(d, zh) {
  const who = `<b>${short(d.wallet)}</b>`, from = d.employers.map((e) => e.coin).slice(0, 2).join(', ') + (d.employerCount > 2 ? ` +${d.employerCount - 2}` : '');
  let text;
  if (d.paid) text = zh
    ? `${who} 已经领到 <b>${usd(d.paid.usd)}</b>${d.paid.atLeast ? '以上' : ''}的真实股票。\n自 ${day(d.paid.since, zh, true)} 起共 ${d.paid.count} 次` + (from ? `，来自 ${esc(from)}。` : '。')
    : `${who} has been paid <b>${d.paid.atLeast ? 'at least ' : ''}${usd(d.paid.usd)}</b> in real stock.\n${d.paid.count} payouts since ${day(d.paid.since, zh, true)}` + (from ? `, from ${esc(from)}.` : '.');
  else if (d.total > 0) text = zh
    ? `${who} 持有 <b>${usd(d.total)}</b> 的代币化股票，但没有发现分红。自己买的股票不算工资。`
    : `${who} holds <b>${usd(d.total)}</b> of tokenized stock, but no payouts were found. Stock you bought yourself is not pay.`;
  else text = zh
    ? `${who} 还没有股票。持有会发股票的 Meme（比如牛马 NIUMA），工资就会出现在这里。`
    : `${who} holds no stock yet. Hold a stock meme that pays, like 牛马 NIUMA, and the pay shows up here.`;
  if (!d.history) text += zh ? '\n暂时拿不到分红记录，这张工资条只显示余额。' : '\nPayout history is unavailable right now, so this slip shows balances only.';
  return text;
}
// The payslip in words, for when the image cannot be drawn.
function slipText(d, zh) {
  const out = [];
  for (const l of d.lines.slice(0, 6)) out.push(`<b>${esc(nameOf(l, zh))}</b> · ${num(l.shares)} ${zh ? '股' : 'shares'} · <b>${usd(l.value)}</b>` + (l.paid ? `\n   ${zh ? `自 ${day(l.paid.first, zh)} 起 ${l.paid.count}${l.paid.more ? '+' : ''} 次分红` : `${l.paid.count}${l.paid.more ? '+' : ''} payouts since ${day(l.paid.first, zh)}`}` : ''));
  if (d.recent.length) out.push('', `<b>${zh ? '最近发放' : 'Latest payouts'}</b>`, ...d.recent.slice(0, 4).map((p) => `${day(p.time, zh)} · +${num(p.shares)} ${esc(nameOf(p, zh))} · ${usd(p.value)}`));
  return out.join('\n');
}

// A payslip is sent as its own message, so it stays in the chat to keep or forward. Only Refresh
// redraws it in place.
async function slip(ctx, wallet, refresh) {
  const { chat, c } = ctx, zh = c.lang === 'zh';
  delete c.expect;
  busy(chat, 'upload_photo');
  const d = await api('/api/payslip', { w: wallet });
  const keys = [
    [c.wallet === d.wallet ? btn(zh ? '🔕 关闭发薪提醒' : '🔕 Stop payday alerts', 'u:') : btn(zh ? '🔔 发薪时提醒我' : '🔔 Tell me on payday', 'w:' + d.wallet)],
    [btn(zh ? '↻ 刷新' : '↻ Refresh', 'r:' + d.wallet), btn(zh ? '🏠 首页' : '🏠 Home', 'hn')],
  ];
  if (site) keys.splice(1, 0, [link(zh ? '在网站上打开，再投资 ↗' : 'Open on the site to reinvest ↗', `${site}/payslip.html?w=${d.wallet}`)]);
  const png = await slipImage(d, zh).catch(() => null);
  if (!png) return send(chat, `🧾 <b>牛马工资条${zh ? '' : ' · Payslip'}</b>\n${slipCaption(d, zh)}\n\n${slipText(d, zh)}`, keys);
  if (refresh && ctx.msg && ctx.photo) { try { return await editMedia(chat, ctx.msg, png, slipCaption(d, zh), keys); } catch (err) { if (same(err)) return null; } }
  return sendPhoto(chat, png, slipCaption(d, zh), keys);
}

async function league(ctx, ticker) {
  const zh = ctx.c.lang === 'zh', lg = await api('/api/league');
  const big = lg.rows.filter(listed);
  const want = (ticker || '').toUpperCase();
  const list = big.filter((r) => !want || r.ticker === want || r.sym === want).sort((a, b) => b.stockUsd - a.stockUsd).slice(0, 10);
  // The three companies with the most stock in meme pools become filters.
  const by = {};
  for (const r of big) (by[r.ticker] ??= { ticker: r.ticker, name: nameOf(r, zh), usd: 0 }).usd += r.stockUsd;
  const top = Object.values(by).sort((a, b) => b.usd - a.usd).slice(0, 3);
  const mark = (on, text) => (on ? '• ' + text : text);
  const keys = [];
  for (let i = 0; i < Math.min(list.length, 6); i += 3) keys.push(list.slice(i, i + 3).map((r) => btn(r.coin, 'c:' + r.address)));
  keys.push([btn(mark(!want, zh ? '全部' : 'All'), 'l:'), ...top.map((s) => btn(mark(s.ticker === want, s.name), 'l:' + s.ticker))]);
  keys.push([btn(zh ? '🏠 首页' : '🏠 Home', 'h')]);
  const title = want && list.length ? (zh ? `${nameOf(list[0], zh)} 排行榜` : `The ${nameOf(list[0], zh)} league`) : (zh ? '股票排行榜' : 'The stock league');
  const caption = zh ? `🏆 <b>${esc(title)}</b>\n点一个币看它的卡片，或者换一只股票。` : `🏆 <b>${esc(title)}</b>\nTap a coin for its card, or switch company.`;
  const medal = ['🥇', '🥈', '🥉'];
  const text = `${caption}\n\n` + (list.length ? list.map((r, i) => `${medal[i] || `${i + 1}.`} <b>${esc(r.coin)}</b> · ${esc(nameOf(r, zh))} · <b>${usd(r.stockUsd)}</b>`).join('\n') : esc(zh ? `没有与 ${want} 配对、市值 $100K 以上的币。` : `No coin worth $100K or more trades against ${want}.`));
  return screen(ctx, { png: await leagueImage(list, { title, total: lg.stats.stockUsd }, zh).catch(() => null), caption, text, keys });
}

// A coin by address, or by symbol: the one with the most stock in its pool wins a name clash.
// listedOnly keeps a stray word in a chat from matching one of thousands of tiny coins.
async function findCoin(q, listedOnly) {
  const lg = await api('/api/league'), key = String(q || '').toLowerCase();
  const rows = lg.rows.filter((r) => (isAddr(key) ? r.address === key : r.coin.toLowerCase() === key) && (!listedOnly || listed(r))).sort((a, b) => b.stockUsd - a.stockUsd);
  return rows[0] ? { row: rows[0], stockPrice: lg.stocks[rows[0].sym]?.price || 0 } : null;
}
const noCoin = (ctx, q) => say(ctx, esc(ctx.c.lang === 'zh' ? `没有叫“${q}”的股票 Meme。` : `There is no stock meme called "${q}".`), [[btn(ctx.c.lang === 'zh' ? '🏆 排行榜' : '🏆 League', 'l:'), btn(ctx.c.lang === 'zh' ? '🏠 首页' : '🏠 Home', 'h')]]);

async function coin(ctx, q) {
  const zh = ctx.c.lang === 'zh', t = (en, cn) => (zh ? cn : en);
  const found = await findCoin(q);
  if (!found) return noCoin(ctx, q);
  busy(ctx.chat, 'upload_photo');
  const r = found.row, d = await api('/api/coin', { a: r.address }), stock = esc(nameOf(d.stock, zh)), sym = esc(d.coin.symbol);
  // Split the last 24 hours of hourly closes into the coin's move and the stock's move.
  const move = (s) => { const cut = Date.now() / 1000 - 86400, before = s.filter((p) => p[0] < cut).pop() || s[0]; return s.length > 1 ? s[s.length - 1][1] / before[1] - 1 : null; };
  const split = { coin: move(d.series.coin), stock: move(d.series.stock) };
  const caption = t(`<b>${sym}</b> trades against <b>${stock}</b>. Its pool holds ${num(d.pool.shares)} shares, worth ${usd(d.pool.stockUsd)}.`, `<b>${sym}</b> 与 <b>${stock}</b> 配对交易。它的池子里有 ${num(d.pool.shares)} 股，价值 ${usd(d.pool.stockUsd)}。`);
  const out = [`<b>${sym}</b>  ·  ${usd(d.coin.price)}` + (split.coin != null ? `  ·  ${split.coin >= 0 ? '🟢' : '🔴'} ${pct(split.coin)}` : ''), caption, '', `${t('Market cap', '市值')}  <b>${usd(d.coin.mcap)}</b>`];
  if (d.coin.holders) out.push(`${t('Holders', '持有人')}  <b>${d.coin.holders.toLocaleString('en-US')}</b>`);
  if (split.coin != null && split.stock != null) out.push('', `${t('The meme itself', 'Meme 本身')}  ${pct((1 + split.coin) / (1 + split.stock) - 1)}`, `${t(`The ${stock} token`, `${stock} 代币`)}  ${pct(split.stock)}`);

  // The coin's own links, as its team set them, then where to look it up and where to go next.
  const own = d.coin.links || {}, social = [];
  if (own.website) social.push(link(t('Website ↗', '官网 ↗'), own.website));
  if (own.x) social.push(link('X ↗', own.x));
  if (own.telegram) social.push(link('Telegram ↗', own.telegram));
  const keys = [[btn(t('💱 Price check', '💱 查价'), 'q:' + r.address)]];
  if (social.length) keys.push(social);
  keys.push([link('BscScan ↗', 'https://bscscan.com/token/' + r.address), ...(site ? [link(t('Trade on Stockyard ↗', '去 Stockyard 交易 ↗'), `${site}/coin.html?a=${r.address}`)] : own.dex ? [link('DexScreener ↗', own.dex)] : [])]);
  keys.push([btn(t('‹ League', '‹ 排行榜'), 'l:'), btn(t('🏠 Home', '🏠 首页'), 'h')]);
  return screen(ctx, { png: await coinImage(d, split, zh).catch(() => null), caption, text: out.join('\n'), keys });
}

// Pick a size, then see what that trade would give. Nothing is bought or sold from the chat.
async function checkMenu(ctx, q) {
  const zh = ctx.c.lang === 'zh', found = await findCoin(q);
  if (!found) return noCoin(ctx, q);
  const r = found.row, a = r.address, stock = esc(nameOf(r, zh)), sym = esc(r.coin);
  return say(ctx, zh
    ? `💱 <b>查价 · ${sym}</b>\n看看现在交易能换到多少，价格来自币安的实时报价。这里不会买入或卖出任何东西。\n\n<b>卖出</b>：把 ${sym} 换成 ${stock} 股票，或者换成现金。\n<b>买入</b>：用 ${stock} 股票支付。`
    : `💱 <b>Price check · ${sym}</b>\nSee what a trade would give you right now, priced live by Binance. Nothing is bought or sold here.\n\n<b>Sell</b>: ${sym} into ${stock} shares, or into cash.\n<b>Buy</b>: pay with ${stock} shares.`, [
    [10, 100, 1000].map((v) => btn((zh ? '卖出 ' : 'Sell ') + (v === 1000 ? '$1K' : '$' + v), `s:${a}:${v}`)),
    [10, 100, 1000].map((v) => btn((zh ? '买入 ' : 'Buy ') + (v === 1000 ? '$1K' : '$' + v), `b:${a}:${v}`)),
    [btn('‹ ' + r.coin, 'c:' + a)],
  ]);
}

async function check(ctx, side, q, dollars) {
  const zh = ctx.c.lang === 'zh', t = (en, cn) => (zh ? cn : en);
  const found = await findCoin(q);
  if (!found || !(found.row.price > 0) || !(found.stockPrice > 0)) return noCoin(ctx, q);
  busy(ctx.chat, 'typing');
  const r = found.row, price = found.stockPrice, stock = esc(nameOf(r, zh)), sym = esc(r.coin), dec = r.decimals ?? 18;
  const quote = (from, to, amount) => api('/api/quote', { from, to, amount }).catch((e) => ({ error: e.message }));
  const swaps = (x) => { const n = x.hops.length - 1; return zh ? n + ' 次兑换' : n + (n === 1 ? ' swap' : ' swaps'); };
  const out = [];
  let amount;
  if (side === 's') {
    // About that many dollars of the coin, rounded to a tidy number.
    amount = plain(Number((dollars / r.price).toPrecision(2)));
    const [keep, cash] = await Promise.all([quote(r.address, r.stock, units(amount, dec)), quote(r.address, USDT, units(amount, dec))]);
    const coins = Number(amount).toLocaleString('en-US');
    out.push(`💱 <b>${t(`Selling ${coins} ${sym}`, `卖出 ${coins} ${sym}`)}</b> (${t('about ', '约 ')}${usd(Number(amount) * r.price)})`, '');
    const sh = keep.error ? 0 : Number(keep.toAmount) / 1e18;
    out.push(`<b>${t('Keep the stock', '留下股票')}</b>`, keep.error ? esc(keep.error) : t(`${num(sh)} ${stock} shares, worth about ${usd(sh * price)} · ${swaps(keep)}`, `${num(sh)} 股 ${stock}，约值 ${usd(sh * price)} · ${swaps(keep)}`), '');
    out.push(`<b>${t('Take cash', '换成现金')}</b>`, cash.error ? esc(cash.error) : t(`${usd(Number(cash.toAmount) / 1e18)} in USDT · ${swaps(cash)}`, `${usd(Number(cash.toAmount) / 1e18)}（USDT）· ${swaps(cash)}`));
  } else {
    amount = plain(Number((dollars / price).toPrecision(2)));
    const spend = Number(amount) * price;
    const [paid, cash] = await Promise.all([quote(r.stock, r.address, units(amount)), quote(USDT, r.address, units(spend.toFixed(6)))]);
    const coins = (x) => num(Number(x.toAmount) / 10 ** dec) + ' ' + sym;
    out.push(`💱 <b>${t(`Buying ${sym} with ${amount} ${stock} shares`, `用 ${amount} 股 ${stock} 买入 ${sym}`)}</b> (${t('about ', '约 ')}${usd(spend)})`, '');
    out.push(`<b>${t('Pay with the stock', '用股票支付')}</b>`, paid.error ? esc(paid.error) : `${coins(paid)} · ${swaps(paid)}`, '');
    out.push(`<b>${t('Pay with cash', '用现金支付')}</b> ${t('(the same dollars in USDT)', '（等值的 USDT）')}`, cash.error ? esc(cash.error) : `${coins(cash)} · ${swaps(cash)}`);
  }
  out.push('', `<i>${t('A live price from Binance, not a trade. To trade, open the coin page and sign with your own wallet.', '这是币安的实时报价，不是交易。要交易，请打开币页面，用自己的钱包签名。')}</i>`);
  const keys = [[btn(t('‹ Price check', '‹ 查价'), 'q:' + r.address), btn('‹ ' + r.coin, 'c:' + r.address)]];
  if (site) keys.unshift([link(t('Make this trade on Stockyard ↗', '去 Stockyard 完成这笔交易 ↗'), `${site}/coin.html?a=${r.address}&side=${side === 's' ? 'sell' : 'buy'}&amount=${amount}`)]);
  return say(ctx, out.join('\n'), keys);
}

function alerts(ctx) {
  const { c } = ctx, zh = c.lang === 'zh';
  if (c.wallet) {
    delete c.expect;
    return say(ctx, zh ? `🔔 <b>发薪提醒已开启</b>\n<code>${c.wallet}</code> 每次收到股票分红，我都会把最新工资条发给你。` : `🔔 <b>Payday alerts are on</b>\nEach time <code>${c.wallet}</code> is paid in stock, I will send you its updated payslip.`, [
      [btn(zh ? '🔕 关闭' : '🔕 Turn off', 'u:'), btn(zh ? '换一个钱包' : 'Change wallet', 'aw')], [btn(zh ? '‹ 首页' : '‹ Home', 'h')],
    ]);
  }
  c.expect = 'watch';
  return say(ctx, zh ? '🔔 <b>发薪提醒</b>\n钱包一收到股票分红，马上把最新工资条发给你。把钱包地址（0x…）发给我就能开启。' : '🔔 <b>Payday alerts</b>\nGet the updated payslip the moment a wallet is paid in stock. Send me the wallet address (0x…) to turn it on.', [[btn(zh ? '‹ 首页' : '‹ Home', 'h')]]);
}

async function watch(ctx, wallet) {
  const { c } = ctx, zh = c.lang === 'zh';
  delete c.expect;
  if (!c.wallet && Object.values(state.chats).filter((x) => x.wallet).length >= MAX_WATCHED) return send(ctx.chat, esc(zh ? '提醒名额已满，请稍后再试。' : 'Payday alerts are full right now. Try again later.'));
  const d = await api('/api/payslip', { w: wallet });
  // Start from the newest payout already made, so only new ones are announced.
  c.wallet = d.wallet; c.seen = Math.max(Date.now(), ...d.recent.map((p) => p.time));
  save();
  const last = d.recent[0];
  const tail = last ? (zh ? `上一次是 ${day(last.time, zh)}：+${num(last.shares)} 股 ${esc(nameOf(last, zh))}。` : `The last one was on ${day(last.time, zh)}: +${num(last.shares)} ${esc(last.name)} shares.`) : (zh ? '这个钱包还没有收到过分红。' : 'This wallet has not been paid yet.');
  return send(ctx.chat, (zh ? `🔔 <b>已开启</b>\n<code>${d.wallet}</code> 每次收到股票分红，我都会告诉你。\n${tail}` : `🔔 <b>Alerts are on</b>\nI will tell you each time <code>${d.wallet}</code> is paid in stock.\n${tail}`), [[btn(zh ? '🧾 打印工资条' : '🧾 Print its payslip', 'p:' + d.wallet), btn(zh ? '🏠 首页' : '🏠 Home', 'hn')]]);
}

function unwatch(ctx) {
  const zh = ctx.c.lang === 'zh';
  delete ctx.c.wallet; delete ctx.c.seen; delete ctx.c.expect;
  save();
  return send(ctx.chat, zh ? '🔕 <b>发薪提醒已关闭。</b>' : '🔕 <b>Payday alerts are off.</b>', [[btn(zh ? '🏠 首页' : '🏠 Home', 'hn')]]);
}

// No more than twelve requests a minute from one chat, so one user cannot use up the Binance quota.
const recent = new Map();
function tooFast(chat) {
  const now = Date.now(), list = (recent.get(chat) || []).filter((at) => now - at < 60000);
  list.push(now);
  recent.set(chat, list);
  return list.length > 12;
}

async function onText(ctx, text) {
  const { c } = ctx;
  const [first, ...rest] = text.trim().split(/\s+/);
  const cmd = first.startsWith('/') ? first.slice(1).split('@')[0].toLowerCase() : null;
  if (!cmd) {
    // A bare address prints a payslip, or sets the alert if that is what was just asked for.
    if (isAddr(first)) return c.expect === 'watch' ? watch(ctx, first) : slip(ctx, first);
    // Anything else is tried as a listed coin's name before going home.
    return (await findCoin(first, true)) ? coin(ctx, first) : home(ctx);
  }
  // A link from the site carries what to open: t.me/<bot>?start=watch_0x… or slip_0x…
  if (cmd === 'start' && rest[0]) {
    const [what, wallet] = rest[0].split('_');
    if (isAddr(wallet)) return what === 'watch' ? watch(ctx, wallet) : slip(ctx, wallet);
  }
  if (cmd === 'payslip') return isAddr(rest[0]) ? slip(ctx, rest[0]) : askWallet(ctx);
  if (cmd === 'league') return league(ctx, rest[0]);
  if (cmd === 'coin') return rest[0] ? coin(ctx, rest[0]) : league(ctx);
  if (cmd === 'alerts') return alerts(ctx);
  if (cmd === 'watch') return isAddr(rest[0]) ? watch(ctx, rest[0]) : alerts(ctx);
  if (cmd === 'unwatch') return unwatch(ctx);
  if (cmd === 'lang') { c.lang = c.lang === 'zh' ? 'en' : 'zh'; save(); }
  return home(ctx);
}

async function onTap(ctx, data) {
  const { c } = ctx, [kind, arg, extra] = data.split(':');
  if (kind === 'h') return home(ctx);
  // Home from under a payslip opens below it, so the payslip stays in the chat.
  if (kind === 'hn') return home({ ...ctx, msg: null });
  if (kind === 'lg') { c.lang = c.lang === 'zh' ? 'en' : 'zh'; save(); return home(ctx); }
  if (kind === 'ps') return askWallet(ctx);
  if (kind === 'p') return slip(ctx, arg);
  if (kind === 'r') return slip(ctx, arg, true);
  if (kind === 'l') return league(ctx, arg);
  if (kind === 'c') return coin(ctx, arg);
  if (kind === 'q') return checkMenu(ctx, arg);
  if (kind === 's' || kind === 'b') return check(ctx, kind, arg, Number(extra));
  if (kind === 'al') return alerts(ctx);
  if (kind === 'aw') { delete c.wallet; delete c.seen; save(); return alerts(ctx); }
  if (kind === 'w') return watch(ctx, arg);
  if (kind === 'u') return unwatch(ctx);
}

async function onUpdate(u) {
  const msg = u.message, cb = u.callback_query;
  const chat = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (chat == null) return;
  const c = chatOf(chat, msg?.from || cb?.from);
  // msg is the message whose button was tapped; photo says whether it is a picture or plain text.
  const ctx = { chat, c, msg: cb?.message?.message_id ?? null, photo: Boolean(cb?.message?.photo) };
  if (cb) tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
  if (tooFast(chat)) return recent.get(chat).length === 13 ? send(chat, esc(c.lang === 'zh' ? '太快了，请等一分钟。' : 'Too fast. Give it a minute.')) : null;
  try {
    if (msg?.text) await onText(ctx, msg.text);
    else if (cb?.data) await onTap(ctx, cb.data);
  } catch (err) {
    console.log('telegram:', err.message);
    await send(chat, esc((c.lang === 'zh' ? '出错了：' : 'That did not work: ') + err.message), [[btn(c.lang === 'zh' ? '🏠 首页' : '🏠 Home', 'hn')]]).catch(() => {});
  }
}

// Every five minutes, look at each watched wallet and announce payouts newer than the last one seen.
async function payday() {
  for (const [chat, c] of Object.entries(state.chats)) {
    if (!c.wallet) continue;
    try {
      const d = await api('/api/payslip', { w: c.wallet }), zh = c.lang === 'zh';
      const fresh = d.recent.filter((p) => p.time > (c.seen || 0)).sort((a, b) => a.time - b.time);
      if (fresh.length) {
        const lines = fresh.slice(-3).map((p) => (zh ? `<b>+${num(p.shares)} 股 ${esc(nameOf(p, zh))}</b>（${usd(p.value)}）` : `<b>+${num(p.shares)} ${esc(p.name)} shares</b> (${usd(p.value)})`));
        const text = `🐂 <b>${zh ? '发薪了！' : '发薪了 · Payday!'}</b>\n${lines.join('\n')}\n` + (zh ? `刚刚打进 ${short(d.wallet)}。` : `just landed in ${short(d.wallet)}.`);
        const keys = [[link(zh ? '查看交易 ↗' : 'View the transaction ↗', 'https://bscscan.com/tx/' + fresh[fresh.length - 1].hash)], [btn(zh ? '🏠 首页' : '🏠 Home', 'hn')]];
        // The alert carries the updated payslip when it can be drawn.
        const png = await slipImage(d, zh).catch(() => null);
        if (png) await sendPhoto(chat, png, text, keys); else await send(chat, text, keys);
        c.seen = fresh[fresh.length - 1].time; save();
      }
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
  try {
    const me = await tg('getMe');
    console.log('Telegram bot @' + me.username + ' is listening');
    status.telegram = '@' + me.username;
  } catch (err) { console.log('Telegram bot did not start:', err.message); return; }

  // The command menu and profile texts are set in the background, so a slow or failed call there
  // never keeps the bot from answering.
  const commands = (zh) => [
    { command: 'start', description: zh ? '首页' : 'Home' },
    { command: 'payslip', description: zh ? '打印钱包的牛马工资条' : 'Print a wallet\'s payslip' },
    { command: 'league', description: zh ? '股票 Meme 排行榜' : 'The stock meme league' },
    { command: 'alerts', description: zh ? '发薪提醒' : 'Payday alerts' },
    { command: 'lang', description: zh ? 'English' : '中文' },
  ];
  (async () => {
    await tg('setMyCommands', { commands: commands(false) });
    await tg('setMyCommands', { commands: commands(true), language_code: 'zh' });
    // What a new user reads before pressing Start, and the line on the bot's profile.
    await tg('setMyDescription', { description: [
      'Stock memes are meme coins on BNB Chain that trade against a real US stock, and some pay their holders in that stock.', '',
      'Print any wallet\'s 牛马工资条 payslip, browse the league, check a price, and get a message on payday. This bot holds no keys and cannot trade.',
    ].join('\n') });
    await tg('setMyDescription', { language_code: 'zh', description: [
      '股票 Meme 是 BNB Chain 上与真实美股配对交易的 Meme 币，其中一些会用这只股票给持有人发工资。', '',
      '打印任意钱包的牛马工资条，查看排行榜、查价，发薪时收到通知。本机器人不持有任何私钥，也无法交易。',
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
