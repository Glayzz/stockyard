#!/usr/bin/env node
// A Stockyard trade carried out by Binance Agentic Wallet.
//
// Stockyard says what the trade is and checks it: its own quote through Binance's aggregator, the
// wallet's balance, and a run on the Transaction API. Agentic Wallet, signed in on this machine
// with `baw auth signin`, quotes the same trade again and is the one that executes it. No key is
// held here: the wallet lives in the Binance app, with its own daily limit and safety settings.
//
//   node scripts/agentic-trade.mjs                                     what the wallet holds
//   node scripts/agentic-trade.mjs --from=coin --to=stock --amount=500          preview a trade
//   node scripts/agentic-trade.mjs --from=coin --to=stock --amount=all --send   make it
//
// --from and --to are each one of:
//   coin    the stock meme (牛马 NIUMA unless --coin=0x… names another)
//   stock   the tokenized stock that coin's pool is quoted in
//   bnb, usdt
// Nothing is traded without --send. A preview only reads.
import { spawnSync } from 'node:child_process';
import '../server/net.mjs';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const send = process.argv.includes('--send');
const SITE = (process.env.STOCKYARD_URL || 'https://stockyardbnb.duckdns.org').replace(/\/$/, '');
const NIUMA = '0xc01a2e136f92772eecab15eb054e8f6fa06b7777';
const BNB = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', USDT = '0x55d398326f99059fF775485246999027B3197955';
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const stop = (msg) => { console.log(msg); process.exit(1); };
const finish = (msg) => { console.log(msg); process.exit(0); };
const num = (n) => Number(n).toLocaleString('en-US', { maximumSignificantDigits: 6 });
const units = (amount, decimals = 18) => {
  const [whole, frac = ''] = String(amount).split('.');
  return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
};

// baw is Binance's own CLI. Every argument given to it here is an address, a number or a fixed
// word, and is checked to be nothing else before the command is built.
function baw(...args) {
  for (const a of args) if (!/^[\w.-]+$/.test(a)) stop('Refusing to pass this to baw: ' + a);
  // On Windows baw is a .cmd file, which only a shell can start; the checked words are joined into one line.
  const all = [...args, '--json'];
  const r = process.platform === 'win32'
    ? spawnSync('baw ' + all.join(' '), { encoding: 'utf8', shell: true, timeout: 120000 })
    : spawnSync('baw', all, { encoding: 'utf8', timeout: 120000 });
  if (r.error || (r.status !== 0 && !r.stdout)) stop('Could not run baw. Install it with: npm install -g @binance/agentic-wallet');
  try { return JSON.parse(r.stdout); } catch { stop('baw answered something unreadable: ' + String(r.stdout || r.stderr).slice(0, 200)); }
}
// An error from baw is shown exactly as it came back.
const said = (j) => JSON.stringify(j.error ?? j).slice(0, 400);

// ---- the wallet ----
const status = baw('wallet', 'status');
if (status.data?.status !== 'CONNECTED') stop('Agentic Wallet is not signed in on this machine. Run `baw auth signin --json`, open the link it prints, confirm in the Binance app, then `baw auth verify --qrCodeId <id> --json`.');
const wallet = baw('wallet', 'address').data?.addresses?.find((a) => a.binanceChainId === '56')?.address;
if (!isAddr(wallet)) stop('Agentic Wallet gave no BNB Chain address.');
const held = baw('wallet', 'balance', '--binanceChainId', '56').data || [];
console.log(`Agentic Wallet ${wallet} on BNB Chain`);
console.log(held.length ? held.map((b) => `  ${num(b.balance)} ${b.symbol}  (about $${Number(b.value).toFixed(2)})`).join('\n') : '  holds nothing worth a cent yet. Send it what you want it to trade, on BNB Smart Chain.');

const fromWord = arg('from'), toWord = arg('to'), amountWord = arg('amount');
if (!fromWord && !toWord) finish('\nTo preview a trade: node scripts/agentic-trade.mjs --from=coin --to=stock --amount=500');

// ---- what the trade is, from Stockyard ----
const coinAddress = (arg('coin', NIUMA)).toLowerCase();
if (!isAddr(coinAddress)) stop('--coin must be a token address.');
const page = await fetch(`${SITE}/api/coin?a=${coinAddress}`, { signal: AbortSignal.timeout(40000) }).then((r) => r.json(), () => null);
if (!page?.coin || !page?.stock) stop(`Stockyard does not know a stock meme at ${coinAddress}` + (page?.error ? `: ${page.error}` : '.'));
const tokens = {
  coin: { address: page.coin.address, symbol: page.coin.symbol, decimals: page.coin.decimals ?? 18 },
  stock: { address: page.stock.address, symbol: page.stock.sym, decimals: 18 },
  bnb: { address: BNB, symbol: 'BNB', decimals: 18 },
  usdt: { address: USDT, symbol: 'USDT', decimals: 18 },
};
const from = tokens[fromWord], to = tokens[toWord];
if (!from || !to || from === to) stop('--from and --to must be two different words out of: coin, stock, bnb, usdt.');
console.log(`\n${page.coin.symbol} trades against ${page.stock.name} (${page.stock.sym}). Its pool holds ${num(page.pool.shares)} shares.`);

let amount = amountWord;
if (amount === 'all') {
  if (from === tokens.bnb) stop('Give a BNB amount instead of "all": the wallet needs some BNB left for network fees.');
  amount = held.find((b) => String(b.address).toLowerCase() === from.address.toLowerCase())?.balance;
  if (!amount) stop(`The wallet shows no ${from.symbol} (balances under one cent are hidden). Give an amount instead.`);
}
if (!/^\d+(\.\d+)?$/.test(amount || '') || !(Number(amount) > 0)) stop('--amount must be a number, or "all".');

// ---- Stockyard's check: quote, balance, and a run on the Transaction API ----
const plan = await fetch(`${SITE}/api/swap/prepare`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
  body: JSON.stringify({ wallet, from: from.address.toLowerCase(), to: to.address.toLowerCase(), amount: units(amount, from.decimals), slippage: 3 }),
}).then((r) => r.json(), (e) => ({ error: e.message }));
console.log(`\nThe trade: ${num(amount)} ${from.symbol} into ${to.symbol}`);
if (plan.error) console.log(`  Stockyard could not check it: ${plan.error}`);
else {
  const hops = plan.quote.hops.length - 1;
  console.log(`  Stockyard, through Binance's aggregator: about ${num(Number(plan.quote.toAmount) / 10 ** to.decimals)} ${to.symbol} via ${plan.quote.vendor}, ${hops} ${hops === 1 ? 'swap' : 'swaps'}, price impact ${(plan.quote.priceImpact * 100).toFixed(2)}%`);
  console.log(`  The wallet holds ${plan.wallet.enough ? 'enough' : 'only ' + num(plan.wallet.balance)} ${from.symbol}.`);
}

// ---- Agentic Wallet's own quote for the same trade ----
const swapArgs = ['--fromTokenQty', amount, '--fromToken', from.address, '--toToken', to.address, '--binanceChainId', '56'];
const quote = baw('market-order', 'quote', ...swapArgs);
if (!quote.success) stop('  Agentic Wallet would not quote it: ' + said(quote));
console.log(`  Agentic Wallet: about ${num(quote.data.toCoinAmount)} ${quote.data.toCoinSymbol}, slippage allowed ${(quote.data.slippage * 100).toFixed(1)}%`);

if (!send) finish('\nNothing was traded. Add --send to make this trade with the Agentic Wallet.');
if (plan.wallet && !plan.wallet.enough) stop('\nNot sent: the wallet does not hold that much.');

// ---- the trade itself, made by Agentic Wallet ----
const order = baw('market-order', 'swap', ...swapArgs);
if (!order.success || !order.data?.orderId) stop('\nAgentic Wallet did not take the order: ' + said(order));
console.log(`\nOrder ${order.data.orderId} submitted. Waiting for it to finish…`);
// An order id is not a finished trade: wait for the wallet to say how it ended.
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const o = baw('market-order', 'list', '--orderId', order.data.orderId).data?.list?.[0];
  if (!o || o.status === 'PENDING') continue;
  if (o.status === 'FINISHED') finish(`Finished: ${o.fromTokenQty} ${o.fromTokenName} into ${o.toTokenName}.\nhttps://bscscan.com/tx/${o.txHash}`);
  stop(`The order ended as ${o.status}` + (o.txHash ? `: https://bscscan.com/tx/${o.txHash}` : ' with no transaction.') + ' Nothing more was sent.');
}
console.log(`Still processing after two minutes. Check it with: baw market-order list --orderId ${order.data.orderId} --json`);
