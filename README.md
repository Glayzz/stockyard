# Stockyard

The home for stock memes on BNB Chain: meme coins whose liquidity pool is quoted in a tokenized
stock instead of BNB. Built by a member of the 牛马 NIUMA community for
[BNB Hack: Tokenized Stocks Edition](https://www.bnbchain.org/en/hackathons/tokenized-stocks).

More than 200 of these coins exist. Their pools hold millions of dollars of bStocks, some of them
pay holders in stock, and until now there was no tool built for them.

## What it does

| Page | What you get |
| --- | --- |
| `public/index.html` · League | Every stock meme, ranked by how much real stock sits in its pool, by company. |
| `public/coin.html` · Coin | Why a coin's price moved (meme leg vs stock leg), a sell-and-keep-the-stock estimate, live trades through the pool, US market clock. |
| `public/payslip.html` · 牛马工资条 | Paste a wallet, print a payslip of the stock tokens it holds and the stock memes behind them. Save it as an image. |

## Status

Work in progress during the hackathon build window.

- Working today: the three pages above, on live data.
- In progress: moving the data layer to the Binance Web3 API. `server/binance.mjs` is the signed
  client, `server/routes.mjs` has the first routes (health, aggregator quote, wallet balances), and
  `scripts/probe.mjs` exercises RWA data, market, trading quotes and wallet balances.
- Next: real sell-and-keep-the-stock trades with simulation first, an Agentic Wallet skill, a
  data agent on BNB Agent Studio.

Sell figures on the coin page are estimates from pool reserves, not quotes. A payslip shows what a
wallet holds today; it does not yet separate stock a coin paid out from stock bought directly.

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

## Data sources

Binance Web3 API (RWA data, market, trading, wallet), DexScreener (pool discovery), GeckoTerminal
(hourly history), GoPlus (token tax and holders), public BNB Chain nodes through Multicall3.

## Notes

- Pool liquidity belongs to liquidity providers. It does not back a coin's price.
- Nothing here is financial advice.
- `dx/LOG.md` is the running log behind the Developer Experience Report.
