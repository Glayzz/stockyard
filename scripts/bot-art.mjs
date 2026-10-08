// Draws the Telegram bot's two pictures in the site's own look and saves them under assets/bot/:
//   avatar.png        640 x 640, the profile picture (Telegram crops it to a circle)
//   description.png   640 x 360, the picture above the bot's description before someone presses Start
// Usage: node scripts/bot-art.mjs      Both are set by hand in @BotFather; see assets/bot/README.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { canvasKit } from '../server/slip-image.mjs';

const INK = '#121212', PAPER = '#f3eedf', CARD = '#fffdf6', YEL = '#ffd400', RED = '#df3a2c', MUT = '#6a6455';
const lib = await canvasKit();
if (!lib) throw new Error('Run npm install first: the pictures are drawn with @napi-rs/canvas.');
const out = new URL('../assets/bot/', import.meta.url);
mkdirSync(out, { recursive: true });
const CJK = '"Stockyard CJK Black", "Stockyard CJK"';

const dots = (g, w, h, step, size) => { g.fillStyle = 'rgba(18, 18, 18, .12)'; for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) g.fillRect(x, y, size, size); };
const box = (g, x, y, w, h, r, { fill = CARD, line = 0, shadow = 0 } = {}) => {
  if (shadow) { g.fillStyle = INK; g.beginPath(); g.roundRect(x + shadow, y + shadow, w, h, r); g.fill(); }
  g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  if (line) { g.lineWidth = line; g.strokeStyle = INK; g.stroke(); }
};
// The round stamp from the payslip: paid in stock.
const seal = (g, x, y, r, turn) => {
  g.save(); g.translate(x, y); g.rotate(turn * Math.PI / 180);
  g.fillStyle = CARD; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = RED; g.lineWidth = r * 0.13; g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.8, 0, Math.PI * 2); g.lineWidth = r * 0.04; g.stroke();
  g.fillStyle = RED; g.textAlign = 'center';
  g.font = `${r * 0.5}px ${CJK}`; g.fillText('已发薪', 0, r * 0.1);
  g.font = `700 ${r * 0.19}px "JetBrains Mono"`; g.fillText('PAID IN STOCK', 0, r * 0.42);
  g.restore();
};

// The profile picture: the 牛马 mark on a card, tilted the way the site tilts its brand tag.
{
  const S = 640, c = lib.createCanvas(S, S), g = c.getContext('2d');
  g.fillStyle = YEL; g.fillRect(0, 0, S, S);
  dots(g, S, S, 32, 4);
  g.save(); g.translate(S / 2, S / 2 + 6); g.rotate(-5 * Math.PI / 180);
  box(g, -182, -182, 364, 364, 44, { line: 12, shadow: 16 });
  g.fillStyle = INK; g.textAlign = 'center';
  g.font = `152px ${CJK}`; g.fillText('牛马', 0, 22);
  box(g, -146, 62, 292, 74, 18, { fill: INK });
  g.fillStyle = YEL; g.font = '40px "Archivo Black"'; g.fillText('STOCKYARD', 0, 113);
  g.restore();
  seal(g, 476, 168, 70, 14);
  writeFileSync(new URL('avatar.png', out), c.toBuffer('image/png'));
}

// The description picture: what the bot is for, in one look.
{
  const W = 640, H = 360, c = lib.createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  dots(g, W, H, 22, 2);
  // Brand tag.
  g.save(); g.translate(34, 30); g.rotate(-1.5 * Math.PI / 180);
  box(g, 0, 0, 262, 52, 11, { fill: INK });
  g.fillStyle = YEL; g.textAlign = 'left'; g.font = '26px "Archivo Black"'; g.fillText('STOCKYARD', 15, 36);
  box(g, 196, 10, 54, 32, 7, { fill: YEL });
  g.fillStyle = INK; g.textAlign = 'center'; g.font = `21px ${CJK}`; g.fillText('牛马', 223, 34);
  g.restore();
  // What it says.
  g.fillStyle = INK; g.textAlign = 'left';
  g.font = '40px "Archivo Black"';
  g.fillText('Your memes pay', 34, 150);
  g.fillText('you in real stock.', 34, 196);
  g.fillStyle = MUT; g.font = '700 18px "Space Grotesk"';
  g.fillText('Stock memes on BNB Chain, in your chat.', 34, 230);
  // What it does.
  let x = 34;
  for (const [label, fill, color] of [['PAYSLIP', YEL, INK], ['LEAGUE', CARD, INK], ['PAYDAY ALERTS', CARD, INK]]) {
    g.font = '700 15px "JetBrains Mono"';
    const w = g.measureText(label).width + 28;
    box(g, x, 268, w, 40, 10, { fill, line: 3, shadow: 4 });
    g.fillStyle = color; g.textAlign = 'left'; g.fillText(label, x + 14, 294);
    x += w + 14;
  }
  // A small payslip, with its stamp.
  g.save(); g.translate(520, 176); g.rotate(6 * Math.PI / 180);
  box(g, -78, -112, 156, 224, 14, { line: 4, shadow: 7 });
  g.fillStyle = INK; g.textAlign = 'center';
  g.font = `25px ${CJK}`; g.fillText('牛马工资条', 0, -70);
  g.font = '700 11px "JetBrains Mono"'; g.fillStyle = MUT; g.fillText('PAYSLIP', 0, -50);
  g.strokeStyle = INK; g.lineWidth = 2; g.setLineDash([5, 5]);
  for (const y of [-34, 6]) { g.beginPath(); g.moveTo(-60, y); g.lineTo(60, y); g.stroke(); }
  g.setLineDash([]);
  g.textAlign = 'left'; g.fillStyle = MUT; g.font = '500 11px "JetBrains Mono"'; g.fillText('PAID IN', -60, -14);
  g.textAlign = 'right'; g.fillStyle = INK; g.font = '700 12px "JetBrains Mono"'; g.fillText('S&P 500', 60, -14);
  g.textAlign = 'left'; g.fillStyle = MUT; g.font = '500 11px "JetBrains Mono"'; g.fillText('TO DATE', -60, 30);
  g.textAlign = 'left'; g.fillStyle = INK; g.font = '30px "Archivo Black"'; g.fillText('$275', -60, 68);
  g.restore();
  seal(g, 590, 298, 42, -12);
  writeFileSync(new URL('description.png', out), c.toBuffer('image/png'));
}
console.log('Saved assets/bot/avatar.png and assets/bot/description.png');
