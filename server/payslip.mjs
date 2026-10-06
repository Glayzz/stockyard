// A wallet's payslip: the stock tokens it holds, the stock memes behind them, and the payouts it
// has actually received, taken from Binance's Wallet API transaction history.
import { league, stocks } from './league.mjs';
import { bw3 } from './binance.mjs';
import { multicallAll, addrWord, toNum } from './chain.mjs';

// The call stock-paying tax tokens use to send holders their share. Incoming stock transfers made
// through it are payouts; anything else (a swap, a plain transfer) is not counted as pay.
const PAYOUT_METHOD = '0x84da2c7b';
const HISTORY_LINES = 6, HISTORY_PAGES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();

// What the wallet holds of every stock token, in one on-chain read. With 534 stock tokens the
// Wallet API's 20-per-call balance endpoint would take 27 calls, so it is kept for payout history.
async function stockBalances(wallet, lg) {
  const bal = await multicallAll(stocks.map((s) => [s.address, '70a08231' + addrWord(wallet)]));
  const held = {};
  stocks.forEach((s, i) => { held[s.address] = { balance: bal[i] ? toNum(bal[i]) : 0, raw: bal[i] ? BigInt('0x' + bal[i].slice(0, 64)).toString() : '0', price: lg.stocks[s.symbol]?.price || 0 }; });
  return { held, source: 'BNB Chain' };
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

export async function payslip(input) {
  const wallet = input.toLowerCase();
  const hit = cache.get(wallet);
  if (hit && Date.now() - hit.at < 120000) return hit.value;

  const lg = await league();
  const { held, source } = await stockBalances(wallet, lg);

  // Which stock memes this wallet holds, read on-chain for every coin with a real pool against a
  // stock the wallet has. Coins paired with a stock it holds none of cannot be behind this payslip.
  const mine = new Set(stocks.filter((s) => held[s.address].balance > 0).map((s) => s.symbol));
  const coins = [...new Map(lg.rows.filter((r) => r.stockUsd >= 1000 && mine.has(r.sym)).map((r) => [r.address, r])).values()];
  const bal = await multicallAll(coins.map((r) => [r.address, '70a08231' + addrWord(wallet)]));
  const employers = coins.map((r, i) => ({ coin: r.coin, address: r.address, sym: r.sym, decimals: r.decimals ?? 18, logo: r.logo || null, bal: bal[i] ? toNum(bal[i]) : 0, value: (bal[i] ? toNum(bal[i]) : 0) * r.price }))
    .filter((e) => e.bal > 0).sort((a, b) => b.value - a.value);

  const lines = stocks.map((s) => {
    const h = held[s.address] || { balance: 0, raw: '0', price: 0 }, price = h.price || lg.stocks[s.symbol]?.price || 0;
    return {
      sym: s.symbol, name: s.name, nameZh: s.nameZh, address: s.address, shares: h.balance, raw: h.raw, price, value: h.balance * price,
      via: employers.filter((e) => e.sym === s.symbol).slice(0, 3).map((e) => ({ coin: e.coin, address: e.address, decimals: e.decimals, bal: e.bal })),
    };
  }).filter((l) => l.value >= 0.01).sort((a, b) => b.value - a.value);

  // Payout history for the largest lines. If Binance is unreachable the payslip still prints, without it.
  let history = true;
  const recent = [];
  for (const line of lines.slice(0, HISTORY_LINES)) {
    try {
      const { list, more } = await payouts(wallet, line.address);
      if (list.length) {
        line.paid = {
          shares: list.reduce((a, p) => a + p.shares, 0), count: list.length, first: list[list.length - 1].time, last: list[0].time,
          payers: [...new Set(list.map((p) => p.payer))].length, more,
        };
        recent.push(...list.slice(0, 6).map((p) => ({ ...p, sym: line.sym, name: line.name, nameZh: line.nameZh, value: p.shares * line.price })));
      }
      await sleep(220);
    } catch { history = false; break; }
  }
  recent.sort((a, b) => b.time - a.time);
  const paidLines = lines.filter((l) => l.paid);

  const value = {
    wallet, source, history,
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
