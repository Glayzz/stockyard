// Tries a list of Binance Web3 API calls and prints a short result for each, with latency.
// Usage: node stockyard/scripts/probe.mjs
import { fileURLToPath } from 'node:url';
import { bw3 } from '../server/binance.mjs';

process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));

const NIUMA = '0xc01a2E136F92772EeCAB15EB054E8f6FA06b7777';
const SPYB = '0x7138b48df7D98D7e3cc221BfE7192D0a178182D8';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const WALLET = '0xe1B0e19F8e014e760BFa6F81769Fd3587CF9d767';
const chain = { binanceChainId: '56' };
const amount = '100000' + '0'.repeat(18);

const calls = [
  ['rwa tokens bstock', '/api/v1/dex/market/rwa/tokens', { params: { ...chain, platformId: 'bstock' } }],
  ['rwa price SPYB', '/api/v1/dex/market/rwa/price', { params: { ...chain, tokenContractAddresses: SPYB } }],
  ['top liquidity SPYB', '/api/v1/dex/market/token/top-liquidity', { params: { ...chain, tokenContractAddress: SPYB } }],
  ['top liquidity NIUMA', '/api/v1/dex/market/token/top-liquidity', { params: { ...chain, tokenContractAddress: NIUMA } }],
  ['trades NIUMA', '/api/v1/dex/market/trades', { params: { ...chain, tokenContractAddress: NIUMA } }],
  ['quote NIUMA to SPYB', '/api/v1/dex/aggregator/quote', { params: { ...chain, fromTokenAddress: NIUMA, toTokenAddress: SPYB, amount, userWalletAddress: WALLET } }],
  ['quote NIUMA to USDT', '/api/v1/dex/aggregator/quote', { params: { ...chain, fromTokenAddress: NIUMA, toTokenAddress: USDT, amount, userWalletAddress: WALLET } }],
  ['balances', '/api/v1/dex/balance/token-balances-by-address', { method: 'POST', body: { address: WALLET, tokenContractAddresses: [{ binanceChainId: '56', tokenContractAddress: SPYB }] } }],
  ['holders SPYB', '/api/v1/dex/market/token/holder', { params: { ...chain, tokenContractAddress: SPYB } }],
];

for (const [name, path, opts] of calls) {
  const t0 = performance.now();
  try {
    const data = await bw3(path, opts);
    const text = JSON.stringify(data);
    console.log(`\nOK   ${name} (${Math.round(performance.now() - t0)} ms, ${Array.isArray(data) ? data.length + ' items' : typeof data})\n     ${text.slice(0, 520)}`);
  } catch (err) {
    console.log(`\nFAIL ${name} (${Math.round(performance.now() - t0)} ms): ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 250));
}
