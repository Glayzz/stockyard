#!/usr/bin/env node
// Sends a little BNB from the Stockyard agent's wallet to its owner's Binance Agentic Wallet, so
// that wallet has something to trade with.
//
//   node scripts/fund-agentic-wallet.mjs            show both balances and what would be sent
//   node scripts/fund-agentic-wallet.mjs --send     send it (0.0016 BNB unless --bnb=… says otherwise)
//
// It can be run from any folder. It only ever pays the BNB Chain address that `baw wallet address`
// reports for the Agentic Wallet signed in on this machine, never more than 0.002 BNB, and it
// leaves the agent enough BNB for its own network fees.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../../../../server/net.mjs';

// Anything unexpected ends in one plain line instead of a stack trace.
process.on('uncaughtException', (err) => {
  console.log(`Stopped before finishing: ${String(err.message || err)}. Check the lines above for anything already sent, then run it again.`);
  process.exit(1);
});

const here = fileURLToPath(new URL('.', import.meta.url));
process.chdir(here + '..');
try { process.loadEnvFile(here + '../../../.studio/.env.local'); } catch {}
const { getWallet } = await import('@bnbagent/studio-runtime/wallet');

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const send = process.argv.includes('--send');
const stop = (msg) => { console.log(msg); process.exit(1); };
const finish = (msg) => { console.log(msg); process.exit(0); };
const MOST = 0.002, KEEP = 0.0003;
const NODES = ['https://bsc-rpc.publicnode.com', 'https://binance.llamarpc.com', 'https://bsc.drpc.org', 'https://bsc-dataseed.bnbchain.org'];

// One call to BNB Chain, on the first node that answers.
async function rpc(method, params) {
  let last = 'no node answered';
  for (const node of NODES) {
    try {
      const r = await (await fetch(node, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json();
      if (r.error) { last = r.error.message; continue; }
      return r.result;
    } catch (e) { last = e.cause?.code || e.message; }
  }
  throw new Error('BNB Chain did not answer: ' + last);
}
const bnbOf = async (address) => Number(BigInt(await rpc('eth_getBalance', [address, 'latest']))) / 1e18;

// The receiving address is read from Binance's own CLI, not typed in. On Windows baw is a .cmd
// file, which only a shell can start; the words given to it here are fixed.
function baw(words) {
  const r = process.platform === 'win32'
    ? spawnSync(`baw ${words} --json`, { encoding: 'utf8', shell: true, timeout: 120000 })
    : spawnSync('baw', [...words.split(' '), '--json'], { encoding: 'utf8', timeout: 120000 });
  try { return JSON.parse(r.stdout); } catch { stop('Could not read an answer from baw. Is it installed and signed in?'); }
}
if (baw('wallet status').data?.status !== 'CONNECTED') stop('Agentic Wallet is not signed in on this machine. Run `baw auth signin --json` first.');
const to = baw('wallet address').data?.addresses?.find((a) => a.binanceChainId === '56')?.address;
if (!/^0x[0-9a-fA-F]{40}$/.test(to || '')) stop('Agentic Wallet gave no BNB Chain address.');

const wallet = getWallet(), me = wallet.address;
const amount = arg('bnb', '0.0016');
if (!/^\d+(\.\d+)?$/.test(amount) || !(Number(amount) > 0)) stop('--bnb must be a number.');
if (Number(amount) > MOST) stop(`This script sends at most ${MOST} BNB.`);

const [mine, theirs] = await Promise.all([bnbOf(me), bnbOf(to)]);
console.log(`Stockyard agent wallet ${me}: ${mine.toFixed(6)} BNB`);
console.log(`Your Agentic Wallet    ${to}: ${theirs.toFixed(6)} BNB`);
console.log(`Would send ${amount} BNB from the agent to the Agentic Wallet, leaving the agent ${(mine - Number(amount)).toFixed(6)} BNB.`);
if (mine - Number(amount) < KEEP) stop(`Not enough: the agent keeps at least ${KEEP} BNB for its own network fees. Try a smaller --bnb.`);
if (!send) finish('Nothing was sent. Add --send to send it.');

const wei = BigInt(Math.round(Number(amount) * 1e9)) * 10n ** 9n;
const value = '0x' + wei.toString(16);
const [nonce, gasPrice, gas] = await Promise.all([
  rpc('eth_getTransactionCount', [me, 'pending']), rpc('eth_gasPrice', []),
  rpc('eth_estimateGas', [{ from: me, to, value }]).catch(() => '0x5208'),
]);
const signed = await wallet.signTransaction({ to, value: wei, gas: BigInt(Math.ceil(parseInt(gas, 16) * 1.2)), gasPrice: BigInt(gasPrice), nonce: parseInt(nonce, 16), chainId: 56 });
const hash = await rpc('eth_sendRawTransaction', [signed.rawTransaction]);
console.log('Sent: https://bscscan.com/tx/' + hash);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const receipt = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
  if (!receipt) continue;
  if (receipt.status !== '0x1') stop('The transfer failed on-chain. Only the network fee was spent.');
  finish(`Arrived. Agent wallet ${(await bnbOf(me)).toFixed(6)} BNB, Agentic Wallet ${(await bnbOf(to)).toFixed(6)} BNB.`);
}
console.log('Not confirmed yet. Check the link above in a minute before running this again.');
