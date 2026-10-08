// The Telegram bot's screens as images, in the site's own look: paper, ink, yellow. Each function
// returns a PNG, or null when the optional canvas library is not installed, in which case the bot
// answers in text.
import { canvasKit } from './slip-image.mjs';

const INK = '#121212', PAPER = '#f3eedf', CARD = '#fffdf6', YEL = '#ffd400', MUT = '#6a6455', GREEN = '#0a8a55', RED = '#df3a2c';
const W = 1080, PAD = 56;
const usd = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toPrecision(3) : '$0';
const num = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(4);
const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
const disp = (s) => `${s}px "Archivo Black", "Stockyard CJK"`;
const body = (s) => `700 ${s}px "Space Grotesk", "Stockyard CJK"`;
const mono = (w, s) => `${w} ${s}px "JetBrains Mono", "Stockyard CJK"`;

// A blank card of the given height with the paper background, and the drawing helpers every card uses.
function stage(lib, H) {
  const c = lib.createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(18, 18, 18, .11)';
  for (let y = 11; y < H; y += 22) for (let x = 11; x < W; x += 22) g.fillRect(x, y, 2, 2);
  const path = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const kit = {
    c, g,
    text(str, x, y, font, color = INK, align = 'left') { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(str, x, y); },
    fit(str, font, max) { g.font = font; if (g.measureText(str).width <= max) return str; let s = str; while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; },
    width(str, font) { g.font = font; return g.measureText(str).width; },
    // A box with the site's hard ink shadow.
    box(x, y, w, h, { fill = CARD, r = 22, shadow = 8, line = 5 } = {}) {
      if (shadow) { path(x + shadow, y + shadow, w, h, r); g.fillStyle = INK; g.fill(); }
      path(x, y, w, h, r); g.fillStyle = fill; g.fill();
      if (line) { g.lineWidth = line; g.strokeStyle = INK; g.stroke(); }
    },
    pill(str, x, y, { font = mono(700, 24), fill = INK, color = PAPER, padX = 18, h = 44 } = {}) {
      const w = kit.width(str, font) + padX * 2;
      path(x, y, w, h, h / 2); g.fillStyle = fill; g.fill();
      kit.text(str, x + padX, y + h / 2 + 9, font, color);
      return w;
    },
    // The brand tag that opens every card.
    brand(right) {
      kit.box(PAD, 44, 386, 78, { fill: INK, r: 16, shadow: 0, line: 0 });
      kit.text('STOCKYARD', PAD + 22, 98, disp(38), YEL);
      kit.box(PAD + 290, 60, 78, 46, { fill: YEL, r: 10, shadow: 0, line: 0 });
      kit.text('牛马', PAD + 329, 95, '30px "Stockyard CJK Black", "Stockyard CJK"', INK, 'center');
      if (right) kit.text(right, W - PAD, 94, mono(500, 22), MUT, 'right');
    },
    foot(str, y) { kit.text(str, PAD, y, mono(500, 21), MUT); },
  };
  return kit;
}

// The opening screen: the one number the whole product is about.
export async function homeImage(stats, listed, zh) {
  const lib = await canvasKit();
  if (!lib) return null;
  const t = (en, cn) => (zh ? cn : en), k = stage(lib, 760);
  k.brand(t('stock memes on BNB Chain', 'BNB Chain 上的股票 Meme'));
  k.pill(t('LIVE FROM BNB CHAIN', 'BNB CHAIN 链上实时数据'), PAD, 168, { color: YEL });
  k.text(t('Meme coins are sitting on', 'Meme 币的池子里躺着'), PAD, 288, disp(56));
  const big = usd(stats.stockUsd), bw = k.width(big, disp(150)) + 72;
  k.box(PAD, 318, bw, 178, { fill: YEL, r: 28, shadow: 10, line: 6 });
  k.text(big, PAD + 36, 452, disp(150));
  k.text(t('of real US stock.', '的真实美股。'), PAD, 580, disp(56));
  const cells = [[stats.poolsFound.toLocaleString('en-US'), t('stock pools found', '个股票配对池')], [stats.holdingStock.toLocaleString('en-US'), t('hold stock today', '个今天持有股票')], [String(listed), t('coins worth $100K+', '个币市值 $100K 以上')]];
  cells.forEach(([v, label], i) => {
    const x = PAD + i * 330;
    k.box(x, 622, 308, 96, { r: 18, shadow: 6, line: 4 });
    k.text(v, x + 20, 668, disp(34));
    k.text(label, x + 20, 702, mono(500, 20), MUT);
  });
  return k.c.toBuffer('image/png');
}

// The league: ten coins ranked by the stock sitting in their pool.
export async function leagueImage(rows, { title, total, start = 0 }, zh) {
  const lib = await canvasKit();
  if (!lib) return null;
  const t = (en, cn) => (zh ? cn : en), rowH = 104, top = 318;
  const k = stage(lib, top + Math.max(rows.length, 1) * rowH + 78);
  k.brand(t('ranked by stock in the pool', '按池内股票价值排名'));
  k.text(k.fit(title.toUpperCase(), disp(64), W - PAD * 2), PAD, 216, disp(64));
  k.text(t(`${usd(total)} of real US stock sits in meme coin pools`, `Meme 币的池子里共有 ${usd(total)} 的真实美股`), PAD, 268, mono(500, 25), MUT);
  if (!rows.length) k.text(t('No coin worth $100K or more here yet.', '这里还没有市值 $100K 以上的币。'), PAD, top + 56, body(34));
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const first = start + i === 0;
    k.box(PAD, y, W - PAD * 2, rowH - 18, { r: 18, shadow: 6, line: 4, fill: first ? YEL : CARD });
    k.box(PAD + 16, y + 15, 56, 56, { fill: INK, r: 12, shadow: 0, line: 0 });
    k.text(String(start + i + 1), PAD + 44, y + 55, disp(start + i >= 99 ? 22 : 30), YEL, 'center');
    const name = k.fit(r.coin, body(38), 330);
    k.text(name, PAD + 92, y + 57, body(38));
    k.pill(k.fit((zh && r.nameZh) || r.name, mono(700, 21), 240), PAD + 92 + k.width(name, body(38)) + 18, y + 22, { font: mono(700, 21), h: 40, padX: 14 });
    k.text(usd(r.stockUsd), W - PAD - 22, y + 50, disp(36), INK, 'right');
    k.text(t('cap ', '市值 ') + usd(r.mcap), W - PAD - 22, y + 76, mono(500, 19), first ? INK : MUT, 'right');
  });
  k.foot(t('stockyard · pools read on-chain from PancakeSwap', 'stockyard · 池子数据直接读自链上 PancakeSwap'), top + Math.max(rows.length, 1) * rowH + 40);
  return k.c.toBuffer('image/png');
}

// A coin's logo. Fetched once and kept, with a short wait the first time. One that cannot be had
// is remembered too, for ten minutes, so a broken logo does not slow down every picture it is on.
const logos = new Map(), missing = new Map();
async function logo(lib, url) {
  if (!url) return null;
  if (logos.has(url)) return logos.get(url);
  if (Date.now() - (missing.get(url) || 0) < 600000) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const img = res.ok ? await lib.loadImage(Buffer.from(await res.arrayBuffer())) : null;
    if (img) logos.set(url, img); else missing.set(url, Date.now());
    return img;
  } catch { missing.set(url, Date.now()); return null; }
}

// One coin: its price, what backs its pool, and how much of today's move was the stock.
export async function coinImage(d, split, zh) {
  const lib = await canvasKit();
  if (!lib) return null;
  const t = (en, cn) => (zh ? cn : en), stock = (zh && d.stock.nameZh) || d.stock.name;
  const hasSplit = split.coin != null && split.stock != null;
  const k = stage(lib, hasSplit ? 1010 : 740), g = k.g;
  k.brand(t('stock meme', '股票 Meme'));

  // logo or a letter, in the site's round badge
  const cx = PAD + 66, cy = 232, img = await logo(lib, d.coin.logo);
  g.beginPath(); g.arc(cx + 7, cy + 7, 66, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  g.beginPath(); g.arc(cx, cy, 66, 0, Math.PI * 2); g.fillStyle = YEL; g.fill();
  if (img) { g.save(); g.clip(); g.drawImage(img, cx - 66, cy - 66, 132, 132); g.restore(); }
  else k.text([...d.coin.symbol][0].toUpperCase(), cx, cy + 22, disp(64), INK, 'center');
  g.beginPath(); g.arc(cx, cy, 66, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();

  k.text(k.fit(d.coin.symbol, disp(84), 560), PAD + 164, 250, disp(84));
  k.text(usd(d.coin.price), W - PAD, 222, mono(700, 44), INK, 'right');
  if (split.coin != null) {
    const label = pct(split.coin) + ' · 24h', w = k.width(label, mono(700, 26)) + 36;
    k.box(W - PAD - w, 244, w, 48, { fill: split.coin >= 0 ? '#c9f3de' : '#ffd2cc', r: 24, shadow: 0, line: 4 });
    k.text(label, W - PAD - 18, 277, mono(700, 26), INK, 'right');
  }
  k.pill(t('Trades against ', '配对：') + stock, PAD, 330, { font: mono(700, 26), h: 50, padX: 22 });

  const cells = [
    [t('MARKET CAP', '市值'), usd(d.coin.mcap), null],
    [t('24H VOLUME', '24小时成交额'), d.coin.vol24 != null ? usd(d.coin.vol24) : '—', null],
    [t('HOLDERS', '持有人'), d.coin.holders ? Number(d.coin.holders).toLocaleString('en-US') : '—', d.coin.top10 ? t('top 10 hold ', '前10名持有 ') + d.coin.top10.toFixed(0) + '%' : null],
    [t(`${d.stock.name} IN ITS POOL`, `池内 ${stock}`).toUpperCase(), num(d.pool.shares) + t(' shares', ' 股'), t('worth ', '价值 ') + usd(d.pool.stockUsd)],
  ];
  cells.forEach(([label, value, sub], i) => {
    const x = PAD + (i % 2) * 494, y = 410 + Math.floor(i / 2) * 154;
    k.box(x, y, 474, 134, { r: 18, shadow: 6, line: 4 });
    k.text(k.fit(label, mono(700, 20), 430), x + 22, y + 38, mono(700, 20), MUT);
    k.text(k.fit(value, disp(40), 430), x + 22, y + 84, disp(40));
    if (sub) k.text(sub, x + 22, y + 114, mono(500, 19), MUT);
  });

  if (hasSplit) {
    const meme = (1 + split.coin) / (1 + split.stock) - 1, y = 748;
    k.text(t('WHAT MOVED THE PRICE TODAY', '今天价格为什么变动'), PAD, y, mono(700, 24));
    const parts = [[t('IN DOLLARS', '美元价格'), split.coin, t('what a wallet shows', '钱包里看到的')], [t('FROM THE MEME', '来自 Meme 本身'), meme, t('people trading it', '大家买卖它')], [t('FROM THE STOCK', '来自股票'), split.stock, t(`the ${d.stock.name} token`, `${stock} 代币`)]];
    parts.forEach(([label, value, sub], i) => {
      const x = PAD + i * 330;
      k.box(x, y + 24, 308, 150, { r: 18, shadow: 6, line: 4, fill: i === 0 ? YEL : CARD });
      k.text(label, x + 20, y + 62, mono(700, 19), i === 0 ? INK : MUT);
      k.text(pct(value), x + 20, y + 122, disp(50), i === 0 ? INK : value >= 0 ? GREEN : RED);
      k.text(k.fit(sub, mono(500, 18), 270), x + 20, y + 154, mono(500, 18), i === 0 ? INK : MUT);
    });
  }
  k.foot(t('stockyard · pool read on-chain, market data from Binance', 'stockyard · 池子读自链上，行情来自币安'), hasSplit ? 978 : 708);
  return k.c.toBuffer('image/png');
}
