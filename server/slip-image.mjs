// The payslip as a PNG, drawn on the server so the Telegram bot can send the same slip the site
// prints. It mirrors drawSlip in public/payslip.html. The canvas library is optional: without it
// slipImage() returns null and the bot falls back to text.
import { fileURLToPath } from 'node:url';

const FONTS = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
let kit;
export async function canvasKit() {
  if (kit !== undefined) return kit;
  try {
    const lib = await import('@napi-rs/canvas');
    for (const [file, family] of [['ArchivoBlack-Regular.ttf', 'Archivo Black'], ['SpaceGrotesk-Bold.ttf', 'Space Grotesk'], ['JetBrainsMono-Medium.ttf', 'JetBrains Mono'],
      ['JetBrainsMono-Bold.ttf', 'JetBrains Mono'], ['StockyardCJK-Bold.ttf', 'Stockyard CJK'], ['StockyardCJK-Black.ttf', 'Stockyard CJK Black']]) lib.GlobalFonts.registerFromPath(FONTS + file, family);
    kit = lib;
  } catch { kit = null; }
  return kit;
}

const usd = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toPrecision(3) : '$0';
const num = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(4);

export async function slipImage(d, zh) {
  const lib = await canvasKit();
  if (!lib) return null;
  const t = (en, cn) => (zh ? cn : en);
  const nameOf = (x) => (zh && x.nameZh) || x.name;
  const day = (ms, year) => new Date(ms).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
  const grade = (total) => { const g = total <= 0 ? ['试用期', 'On probation'] : total < 1 ? ['实习牛马', 'Intern'] : total < 10 ? ['初级牛马', 'Junior'] : total < 100 ? ['高级牛马', 'Senior'] : total < 1000 ? ['主管', 'Manager'] : ['股东', 'Shareholder']; return zh ? g[0] : g[0] + ' · ' + g[1]; };

  const W = 1080, rowH = 128, shown = d.lines.slice(0, 6), n = Math.max(shown.length, 1), recent = d.recent.slice(0, 4);
  const H = 1000 + n * rowH + (recent.length ? 76 + recent.length * 48 : 0) + (d.paid ? 46 : 0);
  // The slip sits on the site's paper colour with a margin, so it reads as a card in a chat.
  const PAD = 56, SHADOW = 14;
  const c = lib.createCanvas(W + SHADOW + PAD * 2, H + SHADOW + PAD * 2), g = c.getContext('2d');
  const INK = '#121212', PAPER = '#fffdf6', YEL = '#ffd400', RED = '#df3a2c', MUT = '#6a6455', GREEN = '#0a8a55';
  g.fillStyle = '#f3eedf'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(18, 18, 18, .11)';
  for (let y = 11; y < c.height; y += 22) for (let x = 11; x < c.width; x += 22) g.fillRect(x, y, 2, 2);
  g.translate(PAD, PAD);

  const mono = (w, s) => `${w} ${s}px "JetBrains Mono", "Stockyard CJK"`;
  const body = (w, s) => `${w} ${s}px "Space Grotesk", "Stockyard CJK"`;
  const disp = (s) => `${s}px "Archivo Black", "Stockyard CJK Black", "Stockyard CJK"`;
  const text = (str, x, y, font, color = INK, align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(str, x, y); };
  const fit = (str, font, max) => { g.font = font; if (g.measureText(str).width <= max) return str; while (str.length > 1 && g.measureText(str + '…').width > max) str = str.slice(0, -1); return str + '…'; };
  const dash = (y) => { g.save(); g.setLineDash([14, 10]); g.lineWidth = 3; g.strokeStyle = INK; g.beginPath(); g.moveTo(56, y); g.lineTo(W - 56, y); g.stroke(); g.restore(); };

  // paper with a torn bottom edge, sitting on a hard ink shadow
  const tooth = 30, bottom = H - 6;
  const paper = (o) => {
    g.beginPath();
    g.moveTo(3 + o, 3 + o); g.lineTo(W - 3 + o, 3 + o); g.lineTo(W - 3 + o, bottom - tooth + o);
    for (let x = W - 3, down = true; x > 3; x -= tooth, down = !down) g.lineTo(Math.max(3, x - tooth) + o, (down ? bottom : bottom - tooth) + o);
    g.closePath();
  };
  paper(SHADOW - 3); g.fillStyle = INK; g.fill();
  paper(0);
  g.fillStyle = PAPER; g.fill();
  g.save(); g.clip(); g.fillStyle = YEL; g.fillRect(0, 0, W, 190); g.restore();
  g.lineWidth = 6; g.strokeStyle = INK; g.lineJoin = 'miter'; g.stroke();
  g.beginPath(); g.moveTo(3, 190); g.lineTo(W - 3, 190); g.stroke();

  text('牛马工资条', 56, 128, '96px "Stockyard CJK Black"');
  text('PAYSLIP', W - 56, 98, disp(52), INK, 'right');
  text(t('PAID IN STOCK', '以股票发薪'), W - 56, 142, mono(700, 24), INK, 'right');

  let y = 268;
  const names = d.employers.map((e) => e.coin);
  const meta = [
    [t('EMPLOYEE', '员工'), d.wallet.slice(0, 10) + '…' + d.wallet.slice(-8)],
    [t('PAY PERIOD', '发薪周期'), d.paid ? day(d.paid.since, true) + t(' to ', ' 至 ') + day(Date.now(), true) : day(Date.now(), true)],
    [t('EMPLOYERS', '雇主'), names.length ? names.slice(0, 3).join(', ') + (d.employerCount > 3 ? ' +' + (d.employerCount - 3) : '') : t('none yet', '暂无')],
    [t('GRADE', '职级'), grade(d.paid ? d.paid.usd : d.total)],
  ];
  for (const [k, v] of meta) {
    text(k, 56, y, mono(500, 26), MUT);
    text(fit(v, mono(700, 30), W - 56 - 330), 330, y, mono(700, 30));
    y += 60;
  }
  dash(y - 18);
  y += 36;
  text(t('STOCK', '股票'), 56, y, mono(500, 24), MUT);
  text(t('SHARES', '股数'), 740, y, mono(500, 24), MUT, 'right');
  text(t('VALUE', '价值'), W - 56, y, mono(500, 24), MUT, 'right');
  y += 26;
  if (!shown.length) {
    text(t('No stock in this wallet yet', '这个钱包还没有股票'), 56, y + 58, body(700, 42));
    text(t('Hold a stock meme like 牛马 NIUMA to get paid in stock', '持有牛马 NIUMA 这样的股票 Meme，就能领到股票'), 56, y + 100, mono(500, 24), MUT);
    y += rowH;
  }
  for (const l of shown) {
    const coin = l.via.length ? t('via ', '来自 ') + l.via.map((v) => v.coin).join(', ') : null;
    const paid = l.paid ? (zh ? `自 ${day(l.paid.first)} 起发放 ${l.paid.count}${l.paid.more ? '+' : ''} 次` : `${l.paid.count}${l.paid.more ? '+' : ''} payouts since ${day(l.paid.first)}`) : null;
    text(nameOf(l), 56, y + 56, body(700, 46));
    text(fit([paid, coin].filter(Boolean).join(' · ') || t('held directly, no payouts found', '直接持有，未发现分红'), mono(500, 24), 540), 56, y + 98, mono(500, 24), paid ? GREEN : MUT);
    text(num(l.shares), 740, y + 62, mono(700, 36), INK, 'right');
    text(usd(l.value), W - 56, y + 62, mono(700, 36), INK, 'right');
    y += rowH;
  }
  if (recent.length) {
    dash(y + 10);
    y += 58;
    text(t('LATEST PAYOUTS', '最近发放'), 56, y, mono(500, 24), MUT);
    for (const p of recent) {
      y += 48;
      text(day(p.time), 56, y, mono(700, 28));
      text(fit(nameOf(p), mono(500, 28), 330), 220, y, mono(500, 28));
      text('+' + num(p.shares), 740, y, mono(700, 28), GREEN, 'right');
      text(usd(p.value), W - 56, y, mono(500, 28), INK, 'right');
    }
    y += 18;
  }
  dash(y + 10);
  y += 70;
  text(d.paid ? (zh ? (d.paid.atLeast ? '累计已发（至少）' : '累计已发') + ` · ${d.paid.count} 次` : (d.paid.atLeast ? 'PAID TO DATE · AT LEAST' : 'PAID TO DATE') + ` · ${d.paid.count} PAYOUTS`) : t('STOCK IN THIS WALLET', '钱包内股票'), 56, y, mono(700, 26), MUT);
  y += 100;
  text(usd(d.paid ? d.paid.usd : d.total), 56, y, disp(104));
  const sealY = y - 40;
  if (d.paid) { y += 46; text(zh ? `今天持有 ${usd(d.total)} 的股票` + (d.lines.length > shown.length ? `，共 ${d.lines.length} 只` : '') : `holding ${usd(d.total)} of stock today` + (d.lines.length > shown.length ? ` in ${d.lines.length} stocks` : ''), 56, y, mono(500, 24), MUT); }

  // red company seal
  g.save();
  g.translate(W - 200, sealY); g.rotate(-0.24); g.globalAlpha = .9;
  g.strokeStyle = RED; g.fillStyle = RED; g.textAlign = 'center';
  g.lineWidth = 9; g.beginPath(); g.arc(0, 0, 128, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 110, 0, Math.PI * 2); g.stroke();
  g.font = '68px "Stockyard CJK Black"'; g.fillText(d.paid ? '已发薪' : '待发薪', 0, 22);
  g.font = mono(700, 19); g.fillText(d.paid ? 'PAID IN STOCK' : 'NOT PAID YET', 0, -56); g.fillText('STOCKYARD', 0, 72);
  g.restore();

  // barcode from the wallet address
  let bx = 56;
  const by = y + 70;
  g.fillStyle = INK;
  [...d.wallet.slice(2)].forEach((ch, i) => { const w = 3 + (parseInt(ch, 16) % 4) * 2; if (i % 2 === 0) g.fillRect(bx, by, w, 70); bx += w + 3; });
  text(t('stockyard · payouts from the Binance Web3 Wallet API', 'stockyard · 分红记录来自币安 Web3 钱包 API'), 56, by + 110, mono(500, 22), MUT);

  return c.toBuffer('image/png');
}
