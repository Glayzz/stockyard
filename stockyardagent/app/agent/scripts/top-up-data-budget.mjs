#!/usr/bin/env node
// Turns a little of the agent's BNB into U, the stablecoin it pays for data with over x402.
//
//   node scripts/top-up-data-budget.mjs 0.0012          show the price and check it; sends nothing
//   node scripts/top-up-data-budget.mjs 0.0012 --send   make the swap
//
// The price and the swap come from Binance's aggregator through a running Stockyard server
// (STOCKYARD_URL), which also checks that the swap would go through. This script signs with the
// agent's own wallet and sends one transaction. It only ever swaps BNB into U, for this wallet.
import { fileURLToPath } from 'node:url';
import '../../../../server/net.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
process.chdir(here + '..');
try { process.loadEnvFile(here + '../../../.studio/.env.local'); } catch {}
const { getWallet } = await import('@bnbagent/studio-runtime/wallet');

const BASE = (process.env.STOCKYARD_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const RPC = 'https://bsc-rpc.publicnode.com';
const BNB = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', U = '0xcE24439F2D9C6a2289F741120FE202248B666666';
// The Studio tools want this much BNB left in the wallet before they will send anything.
const KEEP = 0.002;

const rpc = async (method, params) => {
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })).json();
  if (r.error) throw new Error(r.error.message);
  return r.result;
};

const amount = process.argv[2], send = process.argv.includes('--send');
if (!/^0\.\d+$/.test(amount || '')) { console.log('Usage: node scripts/top-up-data-budget.mjs <BNB to swap, e.g. 0.0012> [--send]'); process.exit(1); }
const wei = BigInt(Math.round(Number(amount) * 1e9)) * 10n ** 9n;

const wallet = getWallet(), me = wallet.address;
const held = Number(BigInt(await rpc('eth_getBalance', [me, 'latest']))) / 1e18;
console.log(`Agent wallet ${me} holds ${held.toFixed(6)} BNB.`);
if (held - Number(amount) < KEEP) console.log(`Note: this leaves ${(held - Number(amount)).toFixed(6)} BNB, under the ${KEEP} BNB the Studio tools ask for before sending a transaction.`);

const res = await fetch(BASE + '/api/swap/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: me, from: BNB, to: U, amount: wei.toString(), slippage: 1 }) });
const plan = await res.json();
if (!res.ok) { console.log('Could not prepare the swap:', plan.error); process.exit(1); }
console.log(`${amount} BNB would give about ${(Number(plan.quote.toAmount) / 1e18).toFixed(4)} U through ${plan.quote.vendor} (price impact ${(plan.quote.priceImpact * 100).toFixed(2)}%).`);
if (!plan.wallet.enough) { console.log('The wallet does not hold that much BNB.'); process.exit(1); }
if (!plan.dryRun?.ok) { console.log('The swap would fail right now, so nothing was sent:', plan.dryRun?.reason || plan.dryRun?.status); process.exit(1); }
console.log('Checked: the swap would go through.');
if (!send) { console.log('Nothing was sent. Add --send to make this swap.'); process.exit(0); }

// The prepared transaction must spend exactly what was asked for and nothing else.
if (BigInt(plan.swapTx.value) !== wei) { console.log('The prepared swap spends a different amount than asked. Stopping.'); process.exit(1); }
const [nonce, gasPrice] = await Promise.all([rpc('eth_getTransactionCount', [me, 'pending']), rpc('eth_gasPrice', [])]);
const signed = await wallet.signTransaction({ to: plan.swapTx.to, data: plan.swapTx.data, value: wei, gas: BigInt(Math.ceil(Number(plan.swapTx.gas || 450000) * 1.3)), gasPrice: BigInt(gasPrice), nonce: parseInt(nonce, 16), chainId: 56 });
const hash = await rpc('eth_sendRawTransaction', [signed.rawTransaction]);
console.log('Sent:', 'https://bscscan.com/tx/' + hash);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const receipt = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
  if (!receipt) continue;
  if (receipt.status !== '0x1') { console.log('The swap failed on-chain. Only the network fee was spent.'); process.exit(1); }
  const u = Number(BigInt(await rpc('eth_call', [{ to: U, data: '0x70a08231' + me.slice(2).toLowerCase().padStart(64, '0') }, 'latest']))) / 1e18;
  const bnb = Number(BigInt(await rpc('eth_getBalance', [me, 'latest']))) / 1e18;
  console.log(`Done. The agent wallet now holds ${u.toFixed(4)} U and ${bnb.toFixed(6)} BNB.`);
  process.exit(0);
}
console.log('Still waiting for it to confirm. Check the link above.');
