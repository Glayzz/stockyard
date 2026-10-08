/**
 * The work this agent sells: reports on stock memes, written from Stockyard's live data.
 *
 * A stock meme is a meme coin on BNB Chain whose pool is quoted in a tokenized stock. The
 * request is read for what it is about, and one of three reports comes back as Markdown:
 *
 *   a wallet address          → that wallet's payslip: what its memes have paid it in stock
 *   a coin address or name    → that coin: price, pool, and how much of its move was the stock
 *   anything else             → the league, optionally for one stock ("league for SPY")
 *
 * No LLM is involved, so the same request always gets the same kind of answer and nothing here
 * can be talked into doing something else. The numbers come from a Stockyard server
 * (STOCKYARD_URL), which reads BNB Chain and the Binance Web3 API.
 */

const BASE = (process.env.STOCKYARD_URL ?? "https://stockyardbnb.duckdns.org").replace(/\/$/, "");

type Json = Record<string, any>;

async function get(path: string, signal?: AbortSignal): Promise<Json> {
  const res = await fetch(BASE + path, { signal: signal ?? AbortSignal.timeout(60_000) });
  const body = (await res.json()) as Json;
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Stockyard answered ${res.status}`), { status: res.status });
  return body;
}

const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toPrecision(3)}` : "$0";
const num = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n >= 100 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(2) : n.toFixed(4);
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Coin names are on-chain strings; keep them from breaking a Markdown table. */
const cell = (s: unknown) => String(s ?? "").replace(/[|\r\n]/g, " ").slice(0, 40);
const stamp = () => `Written by the Stockyard agent on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from BNB Chain and the Binance Web3 API. Figures are estimates, not advice.`;

function payslipReport(d: Json): string {
  const out = [`# 牛马工资条 · Payslip for ${d.wallet}`, ""];
  if (d.paid) {
    out.push(`**Paid in real stock: ${d.paid.atLeast ? "at least " : ""}${usd(d.paid.usd)}**, in ${d.paid.count} payouts since ${day(d.paid.since)}.`);
    out.push(`It holds ${usd(d.total)} of tokenized stock today.`);
  } else if (d.total > 0) {
    out.push(`This wallet holds ${usd(d.total)} of tokenized stock, but no payouts were found. Stock a wallet bought itself is not pay.`);
  } else {
    out.push("This wallet holds no tokenized stock yet.");
  }
  if (d.employerCount) out.push(`Stock memes it holds that trade against its stock: ${d.employers.slice(0, 5).map((e: Json) => cell(e.coin)).join(", ")}${d.employerCount > 5 ? ` and ${d.employerCount - 5} more` : ""}.`);
  if (d.lines.length) {
    out.push("", "| Stock | Shares | Value | Payouts |", "| --- | ---: | ---: | --- |");
    for (const l of d.lines.slice(0, 12)) out.push(`| ${cell(l.name)} (${l.sym}) | ${num(l.shares)} | ${usd(l.value)} | ${l.paid ? `${l.paid.count}${l.paid.more ? "+" : ""} since ${day(l.paid.first)}` : "none found"} |`);
    if (d.lines.length > 12) out.push(`| and ${d.lines.length - 12} more | | | |`);
  }
  if (d.recent.length) {
    out.push("", "## Latest payouts");
    for (const p of d.recent) out.push(`- ${day(p.time)}: +${num(p.shares)} ${cell(p.name)} shares (${usd(p.value)}), [transaction](https://bscscan.com/tx/${p.hash})`);
  }
  if (!d.history) out.push("", "Payout history could not be read just now, so this shows balances only.");
  out.push("", "A payout is stock sent to the wallet by a coin's own distribution call.", "", stamp());
  return out.join("\n");
}

function coinReport(d: Json): string {
  const c = d.coin, s = d.stock;
  // Split the last 24 hours of hourly closes into the coin's move and the stock's move.
  const move = (series: number[][]) => {
    if (!series || series.length < 2) return null;
    const cut = Date.now() / 1000 - 86400, before = series.filter((p) => p[0] < cut).pop() ?? series[0];
    return series[series.length - 1][1] / before[1] - 1;
  };
  const coin24 = move(d.series.coin), stock24 = move(d.series.stock);
  const out = [`# ${cell(c.symbol)} · a stock meme trading against ${s.name}`, "", `Contract \`${c.address}\` · pool \`${d.pool.pair}\``, ""];
  out.push("| | |", "| --- | ---: |", `| Price | ${usd(c.price)} |`, `| Market cap | ${usd(c.mcap)} |`);
  if (c.vol24 != null) out.push(`| 24h volume | ${usd(c.vol24)} |`);
  if (c.holders) out.push(`| Holders | ${Number(c.holders).toLocaleString("en-US")} |`);
  out.push(`| ${s.name} in its pool | ${num(d.pool.shares)} shares (${usd(d.pool.stockUsd)}) |`);
  if (coin24 != null && stock24 != null) {
    const meme = (1 + coin24) / (1 + stock24) - 1;
    out.push("", "## Why the price moved in the last 24 hours", `In dollars the coin moved ${pct(coin24)}. The ${s.name} token moved ${pct(stock24)}, so the meme itself moved ${pct(meme)} against the stock.`);
  }
  if (s.tokenPrice && s.refPrice) out.push("", `## The stock behind it`, `The ${s.name} token trades at ${usd(s.tokenPrice)} on BNB Chain against a reference price of ${usd(s.refPrice)} for the real share, a gap of ${pct(s.tokenPrice / s.refPrice - 1)}.`);
  if (d.trades?.length) {
    const through = d.trades.filter((t: Json) => t.shares != null);
    const inn = through.filter((t: Json) => t.buy).reduce((a: number, t: Json) => a + t.shares, 0), outShares = through.filter((t: Json) => !t.buy).reduce((a: number, t: Json) => a + t.shares, 0);
    out.push("", "## Recent flow", `In its last ${d.trades.length} trades, buyers brought ${num(inn)} shares into the pool and sellers took ${num(outShares)} out.`);
  }
  out.push("", "Pool liquidity belongs to liquidity providers; it does not back the coin's price.", "", stamp());
  return out.join("\n");
}

function leagueReport(d: Json, want: string): string {
  const title = want && d.memes.length ? `# The ${d.memes[0].stock} league` : "# The stock meme league";
  const out = [title, "", `${usd(d.totals.stockUsd)} of tokenized US stock sits in meme coin pools on BNB Chain, across ${Number(d.totals.holdingStock).toLocaleString("en-US")} pools. Coins worth $100K or more, ranked by the stock in their pool:`, ""];
  if (!d.memes.length) out.push(`No coin worth $100K or more trades against ${want}.`);
  else {
    out.push("| # | Coin | Stock | Stock in pool | Market cap | Contract |", "| ---: | --- | --- | ---: | ---: | --- |");
    d.memes.forEach((m: Json, i: number) => out.push(`| ${i + 1} | ${cell(m.coin)} | ${m.stock} | ${usd(m.stockUsdInPool)} | ${usd(m.marketCapUsd)} | \`${m.address}\` |`));
  }
  out.push("", "Pool liquidity belongs to liquidity providers; it does not back a coin's price.", "", stamp());
  return out.join("\n");
}

/** Read the request and write the matching report. */
export async function stockyardWork(prompt: string, signal?: AbortSignal): Promise<string> {
  const text = String(prompt ?? "");
  const address = text.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
  if (address) {
    // An address is a coin if Stockyard knows a stock pool for it, and a wallet otherwise.
    try {
      return coinReport(await get(`/api/coin?a=${address}`, signal));
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
    return payslipReport(await get(`/api/payslip?w=${address}`, signal));
  }

  const league = await get("/api/memes?limit=100", signal);
  const words = text.toLowerCase().split(/[^\p{L}\p{N}&$]+/u).filter(Boolean);
  // A listed coin named in the request gets its own report.
  const named = league.memes.find((m: Json) => words.includes(String(m.coin).toLowerCase()));
  if (named) return coinReport(await get(`/api/coin?a=${named.address}`, signal));

  // Otherwise the league, for one stock if the request names its ticker or company.
  const stock = league.memes.find((m: Json) => words.includes(String(m.stockTicker).toLowerCase()) || text.toLowerCase().includes(String(m.stock).toLowerCase()));
  if (stock) return leagueReport(await get(`/api/memes?stock=${encodeURIComponent(stock.stockTicker)}&limit=20`, signal), stock.stock);
  return leagueReport({ ...league, memes: league.memes.slice(0, 20) }, "");
}
