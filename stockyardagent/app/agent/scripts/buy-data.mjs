#!/usr/bin/env node
// The agent buys one answer from Stockyard's paid data over x402, paying from its own wallet.
//
//   node scripts/buy-data.mjs            show balances, the price and what would happen; sends nothing
//   node scripts/buy-data.mjs --send     if the wallet is short of U, swap a little BNB into U first,
//                                        then pay for one call
//
// It can be run from any folder. The payment is signed by the agent's wallet and settled by
// Binance's B402, which also pays the gas. The only address it will pay is the one in Stockyard's
// own .env (B402_PAY_TO), and never more than five cents a call.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../../../server/net.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
process.chdir(here + '..');
try { process.loadEnvFile(here + '../../../.studio/.env.local'); } catch {}
const { getWallet } = await import('@bnbagent/studio-runtime/wallet');
const { fetchWithPayment } = await import('@bnbagent/studio-runtime/x402');

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const send = process.argv.includes('--send');
const url = arg('url', 'http://localhost:4173/x402/league?stock=SPY');
const topUp = arg('bnb', '0.0012');
const origin = new URL(url).origin;
const RPC = 'https://bsc-rpc.publicnode.com';
const BNB = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', U = '0xcE24439F2D9C6a2289F741120FE202248B666666';
// The receiving address this project set up with B402. Anything else in a 402 is refused.
const payTo = process.env.STOCKYARD_PAY_TO || readFileSync(here + '../../../../.env', 'utf8').match(/^B402_PAY_TO=(0x[0-9a-fA-F]{40})/m)?.[1];

const rpc = async (method, params) => {
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })).json();
  if (r.error) throw new Error(r.error.message);
  return r.result;
};
const wallet = getWallet(), me = wallet.address;
const balances = async () => {
  const [bnb, u] = await Promise.all([rpc('eth_getBalance', [me, 'latest']), rpc('eth_call', [{ to: U, data: '0x70a08231' + me.slice(2).toLowerCase().padStart(64, '0') }, 'latest'])]);
  return { bnb: Number(BigInt(bnb)) / 1e18, u: Number(BigInt(u)) / 1e18 };
};
const stop = (msg) => { console.log(msg); process.exit(1); };
// A preview ending as planned is not a failure.
const finish = (msg) => { console.log(msg); process.exit(0); };

if (!payTo) stop('No receiving address found. Set B402_PAY_TO in stockyard/.env.');
let held = await balances();
console.log(`Agent wallet ${me}: ${held.bnb.toFixed(6)} BNB, ${held.u.toFixed(4)} U.`);

// What does the call cost? Ask without paying and read the 402.
const first = await fetch(url);
if (first.status !== 402) stop(`Expected a 402 from ${url}, got ${first.status}.`);
const offer = (await first.json()).accepts.find((a) => a.asset.toLowerCase() === U.toLowerCase() && a.extra?.assetTransferMethod === 'eip3009');
if (!offer) stop('This resource does not take U.');
if (offer.payTo.toLowerCase() !== payTo.toLowerCase()) stop(`The 402 asks to pay ${offer.payTo}, not this project's address. Stopping.`);
const price = Number(offer.amount) / 1e18;
console.log(`${new URL(url).pathname} costs ${price} U, paid to ${offer.payTo}.`);

// Top up: turn a little BNB into U through Binance's aggregator, only if the wallet is short.
if (held.u < price) {
  const wei = BigInt(Math.round(Number(topUp) * 1e9)) * 10n ** 9n;
  const res = await fetch(origin + '/api/swap/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: me, from: BNB, to: U, amount: wei.toString(), slippage: 1 }) });
  const plan = await res.json();
  if (!res.ok) stop('Could not prepare the top-up: ' + plan.error);
  console.log(`The wallet is short of U. Swapping ${topUp} BNB would give about ${(Number(plan.quote.toAmount) / 1e18).toFixed(4)} U through ${plan.quote.vendor}, leaving ${(held.bnb - Number(topUp)).toFixed(6)} BNB.`);
  if (!plan.wallet.enough) stop('The wallet does not hold that much BNB.');
  if (!plan.dryRun?.ok) stop('That swap would fail right now, so nothing was sent: ' + (plan.dryRun?.reason || plan.dryRun?.status));
  if (!send) finish('Checked: the swap would go through. Nothing was sent. Add --send to top up and pay.');
  // The prepared transaction must spend exactly the amount asked for.
  if (BigInt(plan.swapTx.value) !== wei) stop('The prepared swap spends a different amount than asked. Stopping.');
  const [nonce, gasPrice] = await Promise.all([rpc('eth_getTransactionCount', [me, 'pending']), rpc('eth_gasPrice', [])]);
  const signed = await wallet.signTransaction({ to: plan.swapTx.to, data: plan.swapTx.data, value: wei, gas: BigInt(Math.ceil(Number(plan.swapTx.gas || 450000) * 1.3)), gasPrice: BigInt(gasPrice), nonce: parseInt(nonce, 16), chainId: 56 });
  const hash = await rpc('eth_sendRawTransaction', [signed.rawTransaction]);
  console.log('Top-up sent: https://bscscan.com/tx/' + hash);
  let done = false;
  for (let i = 0; i < 120 && !done; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const receipt = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (!receipt) continue;
    if (receipt.status !== '0x1') stop('The top-up failed on-chain. Only the network fee was spent.');
    done = true;
  }
  if (!done) stop('The top-up has not confirmed yet. Run this again in a minute.');
  held = await balances();
  console.log(`Top-up done: ${held.bnb.toFixed(6)} BNB, ${held.u.toFixed(4)} U.`);
  // Binance checks a payment against its own view of the chain, which can be a few blocks
  // behind. Give the new balance a moment to be seen everywhere before paying with it.
  await new Promise((r) => setTimeout(r, 12000));
} else if (!send) {
  finish('The wallet has enough U. Nothing was sent. Add --send to pay for this call.');
}

// Pay and fetch, with the Studio runtime's own x402 client.
// The same signed payment is offered up to three times; settling it twice is not possible.
let result;
try {
  result = await fetchWithPayment(url, { maxUsd: 0.05, wallet, expectedTo: payTo, networkName: 'bsc-mainnet', asset: 'U', allowedHosts: [new URL(url).hostname], maxRetries: 3, baseDelaySeconds: 4 });
} catch (err) {
  const why = await fetch(origin + '/x402/last').then((r) => r.json()).catch(() => null);
  console.log('The payment did not go through:', String(err.message).split('(')[0].trim());
  if (why?.reason) console.log('What the seller saw:', why.step, '-', why.reason);
  held = await balances();
  stop(`Agent wallet: ${held.bnb.toFixed(6)} BNB, ${held.u.toFixed(4)} U.`);
}
if (result.statusCode !== 200 || !result.settlement?.transaction) {
  // The signed payment was offered but never settled, so no money moved. The balance below shows it.
  const why = await fetch(origin + '/x402/last').then((r) => r.json()).catch(() => null);
  console.log(`The seller answered HTTP ${result.statusCode} and the payment was not settled. Nothing was paid.`);
  console.log('What the seller said:', result.json?.error ?? (why?.reason ? `${why.step} - ${why.reason}${why.message ? ': ' + why.message : ''}` : 'no reason given'));
} else {
  console.log(`Answer: HTTP ${result.statusCode}. Paid ${result.paidUsd ?? 0} ${result.symbol ?? 'U'}.`);
  console.log('Payment settled: https://bscscan.com/tx/' + result.settlement.transaction);
  console.log(JSON.stringify(result.json ?? {}).slice(0, 400) + ' …');
}
held = await balances();
console.log(`Agent wallet now: ${held.bnb.toFixed(6)} BNB, ${held.u.toFixed(4)} U.`);
