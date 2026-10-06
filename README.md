# Stockyard

The home for stock memes on BNB Chain: meme coins whose liquidity pool is quoted in a tokenized
stock instead of BNB. Built by a member of the 牛马 NIUMA community for
[BNB Hack: Tokenized Stocks Edition](https://www.bnbchain.org/en/hackathons/tokenized-stocks).

An on-chain scan on 6 October 2026 found 202,703 PancakeSwap v2 pools that pair a coin with a
tokenized stock. 3,549 of them held stock that day, $15.8M in total, and 55 of those coins were
worth $100K or more. Some pay their holders in stock. Until now there was no tool built for them.

## What it does

| Page | What you get |
| --- | --- |
| `public/index.html` · League | Every stock meme, ranked by how much real stock sits in its pool, by company. |
| `public/coin.html` · Coin | Why a coin's price moved (meme leg vs stock leg), the stock behind it (token price against the real share, 52-week range), a real Binance quote for selling into the stock or into cash, the trade itself with a dry run first, and live trades through the pool. |
| `public/payslip.html` · 牛马工资条 | Paste a wallet, print a payslip of every payout it has received in stock tokens, with dates, and the stock memes behind them. Save it as an image. Then put the pay to work: swap part of each stock line back into the coin behind it, or gather small lines into one stock, with a Binance quote and a dry run first. |
| `skills/stockyard-stock-memes` | A skill in the Binance Skills Hub format that hands execution to Binance Agentic Wallet. |
| `mcp/server.mjs` | The same data as four MCP tools for any agent. |

## Status

Work in progress during the hackathon build window.

- Working: the league, coin page and payslip on live data, in English and 中文, covering bStocks,
  pre-IPO and Ondo stock tokens; the server rescans PancakeSwap for new pools at start and every
  five minutes. If Binance cannot be reached, the pages still load from BNB Chain and say what is missing.
- Built, waiting on a first live trade: sell-and-keep-the-stock on the coin page and reinvest on
  the payslip. Both use one wallet flow: the server prepares the approval and swap through
  Binance's aggregator and dry-runs them on the Transaction API; the user's own wallet signs.
  The server never holds a key.
- Next: a data agent on BNB Agent Studio with b402 pay-per-call.

Binance Web3 API modules in use: RWA Data, Market, Trading, Transaction, Wallet.

## Run it

Needs Node 22 or newer and no packages.

```bash
node server/dev.mjs
```

Then open http://localhost:4173. The server serves the pages in `public/` and the `/api` routes
in `server/routes.mjs`, which keep the Binance key on the server.

For anything that calls the Binance Web3 API, copy `.env.example` to `.env` and add a key and
secret from the [developer portal](https://web3.binance.com/en/dev-portal). Then check it:

```bash
node scripts/first-call.mjs
node scripts/probe.mjs
```

`GET /api/health` reports whether the server can reach Binance from where it runs.

Binance checks the caller's location, so run these from a region its
[restricted list](https://web3.binance.com/en/dev-docs/web3-api-prohibited-regions) allows.

## How the league finds every stock meme

1. `data/bsc-stock-tokens.csv` is Binance's list of tokenized stocks on BNB Chain.
2. `node scripts/scan-pairs.mjs` walks PancakeSwap v2's pair list through Multicall3 and keeps
   every pool where one side is on that list. The first run checks the newest 900,000 pairs and
   takes about 25 minutes on public nodes; later runs only check new pairs.
3. `server/league.mjs` prices each stock from its deepest USDT pool, then reads every pool's
   balances, the coin's supply and its burned amount to get price and market cap.

The full scan output is too large for the repo, so `data/pools.bin` carries a packed copy of every
pool found (45 bytes each). A fresh checkout starts from that and catches up by itself.
`node scripts/pack-pools.mjs` refreshes it.

## Data sources

BNB Chain through public nodes and Multicall3 (pools, balances, supplies, prices), the Binance Web3
API (logos, volume, holders, hourly history, trades, quotes, dry runs, wallet balances and payout
history, stock profiles) and GoPlus (coin tax).

## Notes

- Pool liquidity belongs to liquidity providers. It does not back a coin's price.
- Nothing here is financial advice.
- `dx/LOG.md` is the running log behind the Developer Experience Report.
