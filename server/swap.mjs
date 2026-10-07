// Prepares a swap for the user's own wallet to sign: a Binance aggregator quote, the approval if
// one is needed, the swap transaction, and a dry run through Binance's Transaction API.
// Nothing here can move funds. The server never holds a wallet key.
import { bw3 } from './binance.mjs';
import { multicall, addrWord, rpc } from './chain.mjs';

const CHAIN = '56';
// How Binance's aggregator names BNB itself, as opposed to a token.
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const simulate = (from, tx) => bw3('/api/v1/dex/pre-transaction/simulate', {
  method: 'POST', body: { binanceChainId: CHAIN, evmTx: { from, to: tx.to, value: String(tx.value || '0'), data: tx.data } },
});

export async function prepare({ wallet, from, to, amount, slippage = '3' }) {
  const base = { binanceChainId: CHAIN, fromTokenAddress: from, toTokenAddress: to, amount, userWalletAddress: wallet };
  const [best] = await bw3('/api/v1/dex/aggregator/quote', { params: base });
  if (!best) throw Object.assign(new Error('No route for this pair'), { status: 404 });
  const need = BigInt(amount), swapCall = bw3('/api/v1/dex/aggregator/swap', { params: { ...base, slippagePercent: String(slippage), quoteId: best.quoteId } });

  let have, allowance, approveTx = null, swap;
  if (from.toLowerCase() === NATIVE) {
    // Spending BNB itself needs no allowance; the amount rides along as the transaction's value.
    const [held, s] = await Promise.all([rpc('eth_getBalance', [wallet, 'latest']), swapCall]);
    have = BigInt(held); allowance = need; swap = s;
  } else {
    // Three things at once, so the user is not kept waiting: what the wallet holds and has already
    // allowed the router to spend, the allowance transaction in case it is needed, and the swap.
    const [[bal, allowed], [a], s] = await Promise.all([
      multicall([[from, '70a08231' + addrWord(wallet)], [from, 'dd62ed3e' + addrWord(wallet) + addrWord(best.approveTarget)]]),
      bw3('/api/v1/dex/aggregator/approve-transaction', { params: { binanceChainId: CHAIN, tokenContractAddress: from, approveAmount: amount, vendor: best.vendorName } }),
      swapCall,
    ]);
    have = bal ? BigInt('0x' + bal.slice(0, 64)) : 0n; allowance = allowed ? BigInt('0x' + allowed.slice(0, 64)) : 0n; swap = s;
    if (allowance < need) approveTx = { to: from, data: a.data, value: '0', gas: a.gasLimit };
  }
  const t = swap.tx || {};
  const swapTx = { to: t.to, data: t.data, value: String(t.value || '0'), gas: t.gas || t.gasLimit || best.estimateGasFee };

  // The dry run only means something once the wallet has the tokens and the approval.
  let dryRun = null;
  if (have >= need) {
    try {
      const sim = await simulate(wallet, approveTx || swapTx);
      dryRun = { of: approveTx ? 'approval' : 'swap', ok: !sim.failReason && !/fail|revert/i.test(String(sim.status)), status: sim.status, reason: sim.failReason || null, changes: sim.balanceChanges || null };
    } catch (err) { dryRun = { of: approveTx ? 'approval' : 'swap', ok: false, status: 'error', reason: err.message, changes: null }; }
  }

  return {
    mode: swap.executionMode,
    quote: {
      vendor: best.vendorName, fromAmount: best.fromTokenAmount, toAmount: swap.routerResult?.toTokenAmount || best.toTokenAmount,
      priceImpact: Number(best.priceImpactPercent), feeUsd: Number(best.tradeFee), hops: String(swap.routerResult?.router || best.router || '').split('--'),
      spender: best.approveTarget,
    },
    wallet: { balance: Number(have) / 1e18, enough: have >= need, needsApproval: allowance < need },
    approveTx, swapTx, dryRun, slippage: Number(slippage),
  };
}

export const status = (hash) => bw3('/api/v1/dex/aggregator/history', { params: { binanceChainId: CHAIN, txHash: hash } });
