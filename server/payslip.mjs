// A wallet's payslip: the stock tokens it holds, the stock memes behind them, and the payouts it
// has actually received, taken from Binance's Wallet API transaction history.
import { league, stocks } from './league.mjs';
import { bw3 } from './binance.mjs';
import { multicallAll, addrWord, toNum } from './chain.mjs';

// The call stock-paying tax tokens use to send holders their share. Incoming stock transfers made
// through it are payouts; anything else (a swap, a plain transfer) is not counted as pay.
const PAYOUT_METHOD = '0x84da2c7b';
const HISTORY_LINES = 6, HISTORY_PAGES = 2, HISTORY_AT_ONCE = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();

// What the wallet holds of every stock token, in one on-chain read. With 534 stock tokens the
// Wallet API's 20-per-call balance endpoint would take 27 calls, so it is kept for payout history.
async function stockLines(wallet, lg) {
  const bal = await multicallAll(stocks.map((s) => [s.address, '70a08231' + addrWord(wallet)]));
  return stocks.map((s, i) => {
    const shares = bal[i] ? toNum(bal[i]) : 0, price = lg.stocks[s.symbol]?.price || 0;
    return {
      sym: s.symbol, name: s.name, nameZh: s.nameZh, address: s.address, shares,
      raw: bal[i] ? BigInt('0x' + bal[i].slice(0, 64)).toString() : '0', price, value: shares * price, via: [],
    };
  }).filter((l) => l.value >= 0.01).sort((a, b) => b.value - a.value);
}

// Which stock memes this wallet holds, read on-chain for every coin with a real pool against a
// stock the wallet has. Coins paired with a stock it holds none of cannot be behind this payslip.
async function heldCoins(wallet, lg, lines) {
  const mine = new Set(lines.map((l) => l.sym));
  const coins = [...new Map(lg.rows.filter((r) => r.stockUsd >= 1000 && mine.has(r.sym)).map((r) => [r.address, r])).values()];
  const bal = await multicallAll(coins.map((r) => [r.address, '70a08231' + addrWord(wallet)]));
  return coins.map((r, i) => ({ coin: r.coin, address: r.address, sym: r.sym, decimals: r.decimals ?? 18, bal: bal[i] ? toNum(bal[i]) : 0, value: (bal[i] ? toNum(bal[i]) : 0) * r.price }))
    .filter((e) => e.bal > 0).sort((a, b) => b.value - a.value);
}

// Incoming payouts of one stock token, newest first, up to HISTORY_PAGES pages of 100.
async function payouts(wallet, stock) {
  const out = [];
  let cursor, more = false;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params = { address: wallet, chains: '56', tokenContractAddress: stock, limit: '100' };
    if (cursor) params.cursor = cursor;
    const data = await bw3('/api/v1/dex/post-transaction/transactions-by-address', { params });
    const list = data?.[0]?.transactionList || [];
    for (const t of list) {
      const mine = (t.to || []).find((x) => x.address.toLowerCase() === wallet);
      if (mine && t.methodId === PAYOUT_METHOD && t.txStatus === 'success')
        out.push({ time: Number(t.txTime), shares: Number(mine.amount), payer: t.from?.[0]?.address?.toLowerCase() || null, hash: t.txHash });
    }
    cursor = data?.[0]?.cursor;
    more = Boolean(cursor) && list.length === 100;
    if (!more) break;
    await sleep(220);
  }
  return { list: out, more };
}

// Payout history for the largest lines, a few at a time. Returns false if Binance could not be
// asked, in which case the payslip still prints, without it.
async function addHistory(wallet, lines, recent) {
  const todo = lines.slice(0, HISTORY_LINES);
  let ok = true;
  await Promise.all(Array.from({ length: Math.min(HISTORY_AT_ONCE, todo.length) }, async () => {
    while (ok && todo.length) {
      const line = todo.shift();
      try {
        const { list, more } = await payouts(wallet, line.address);
        if (!list.length) continue;
        line.paid = {
          shares: list.reduce((a, p) => a + p.shares, 0), count: list.length, first: list[list.length - 1].time, last: list[0].time,
          payers: [...new Set(list.map((p) => p.payer))].length, more,
        };
        recent.push(...list.slice(0, 6).map((p) => ({ ...p, sym: line.sym, name: line.name, nameZh: line.nameZh, value: p.shares * line.price })));
      } catch { ok = false; }
    }
  }));
  return ok;
}

export async function payslip(input) {
  const wallet = input.toLowerCase();
  const hit = cache.get(wallet);
  if (hit && Date.now() - hit.at < 120000) return hit.value;

  const lg = await league();
  const lines = await stockLines(wallet, lg);

  // The chain read for coins and Binance's history do not depend on each other, so they run together.
  const recent = [];
  const [employers, history] = await Promise.all([heldCoins(wallet, lg, lines), addHistory(wallet, lines, recent)]);
  for (const l of lines) l.via = employers.filter((e) => e.sym === l.sym).slice(0, 3).map((e) => ({ coin: e.coin, address: e.address, decimals: e.decimals, bal: e.bal }));
  recent.sort((a, b) => b.time - a.time);
  const paidLines = lines.filter((l) => l.paid);

  const value = {
    wallet, source: 'BNB Chain', history,
    lines, employers: employers.slice(0, 40).map((e) => ({ coin: e.coin, address: e.address, sym: e.sym })), employerCount: employers.length,
    total: lines.reduce((a, l) => a + l.value, 0),
    paid: paidLines.length ? {
      usd: paidLines.reduce((a, l) => a + l.paid.shares * l.price, 0), count: paidLines.reduce((a, l) => a + l.paid.count, 0),
      since: Math.min(...paidLines.map((l) => l.paid.first)), atLeast: paidLines.some((l) => l.paid.more) || lines.length > HISTORY_LINES,
    } : null,
    recent: recent.slice(0, 6),
  };
  cache.set(wallet, { at: Date.now(), value });
  return value;
}
