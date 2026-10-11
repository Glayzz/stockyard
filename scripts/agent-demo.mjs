#!/usr/bin/env node
// What an agent gets from Stockyard, shown in a few seconds. It starts the MCP server the way an
// agent would, asks it three things, then has the Stockyard agent write one report. Reads only:
// nothing is paid, signed or traded.
//
//   node scripts/agent-demo.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import '../server/net.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const NIUMA = '0xc01a2e136f92772eecab15eb054e8f6fa06b7777', HOLDER = '0xddb90566ded15a402da02d1fd6d99102d172568b';
const usd = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Number(n).toFixed(2));

// ---- 1. the MCP server, over stdio, one JSON-RPC message per line ----
// It is started with the same name lookup as this script, which asks public DNS when the local one
// gives no answer (a mobile hotspot often does not).
const server = spawn(process.execPath, ['--import', pathToFileURL(root + 'server/net.mjs').href, root + 'mcp/server.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map();
let buffer = '', next = 1;
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (let i; (i = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(i + 1)) {
    try { const m = JSON.parse(buffer.slice(0, i)); waiting.get(m.id)?.(m); waiting.delete(m.id); } catch {}
  }
});
const ask = (method, params) => new Promise((done, fail) => {
  const id = next++;
  waiting.set(id, (m) => (m.error ? fail(new Error(m.error.message)) : done(m.result)));
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => fail(new Error('the MCP server did not answer in 60 s')), 60000).unref();
});
const tool = async (name, args) => {
  const text = (await ask('tools/call', { name, arguments: args })).content[0].text;
  try { return JSON.parse(text); } catch { throw new Error(`${name} could not reach the Stockyard site: ${text}`); }
};

console.log('Stockyard MCP server (node mcp/server.mjs)\n');
const { tools } = await ask('tools/list', {});
console.log(`Tools: ${tools.map((t) => t.name).join(', ')}\n`);

const league = await tool('stock_meme_league', { stock: 'SPY', limit: 3 });
console.log(`stock_meme_league { stock: "SPY" }  →  ${league.totals.holdingStock.toLocaleString()} pools hold stock, ${usd(league.totals.stockUsd)} in all`);
for (const m of league.memes) console.log(`   ${m.coin.padEnd(10)} ${String(Number(m.sharesInPool).toFixed(2)).padStart(8)} ${m.stockTicker} shares in its pool (${usd(m.stockUsdInPool)}), market cap ${usd(m.marketCapUsd)}`);

const keep = await tool('keep_stock_quote', { address: NIUMA, amount: '1000' });
console.log(`\nkeep_stock_quote { NIUMA, amount: "1000" }  →  keep the stock: ${keep.keepTheStock.shares.toFixed(6)} ${keep.keepTheStock.stock} shares (${usd(keep.keepTheStock.worthUsd)}, ${keep.keepTheStock.swaps} swaps)  ·  or take cash: ${usd(keep.takeCash.usdt)}`);

const slip = await tool('stock_payslip', { wallet: HOLDER });
console.log(`\nstock_payslip { a NIUMA holder }  →  ${slip.paid ? `paid ${usd(slip.paid.usd)} in stock over ${slip.paid.count} payouts, by ${slip.employers.map((e) => e.coin).join(', ')}` : 'holds ' + usd(slip.total) + ' of stock'}`);
server.kill();

// ---- 2. the Stockyard agent's own work: one report, written by fixed code ----
const work = root + 'stockyardagent/app/agent/dist/stockyardWork.js';
if (existsSync(work)) {
  const { stockyardWork } = await import(pathToFileURL(work));
  console.log('\n────────────────────────────────────────\nThe Stockyard agent (ERC-8004 agent 365431), asked: "Tell me about NIUMA"\n');
  const report = await stockyardWork('Tell me about the coin ' + NIUMA);
  console.log(report.split('\n').slice(0, 16).join('\n'));
}
process.exit(0);
