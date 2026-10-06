---
name: stockyard-stock-memes
description: |
  Find, explain and trade stock memes on BNB Chain: meme coins whose liquidity pool is quoted in a
  tokenized stock (bStocks such as SPYB, QQQB, SPCXB) instead of BNB or USDT.
  Covers: the league of every stock meme ranked by the stock its pool holds, a coin's price move
  split into the meme's part and the stock's part, the stock payouts a wallet has received
  (its payslip), and a sell quote that ends in the stock instead of cash.

  Use this skill when users ask about:
  - Which meme coins trade against a tokenized stock, or against one stock such as SPY or SpaceX
  - Why a stock meme's dollar price moved, or how much real stock sits in its pool
  - What a wallet has been paid in stock by the memes it holds
  - Selling a stock meme and keeping the stock, or sweeping small stock balances into one stock
  - Which meme community holds the most of a stock

  NOT for tokenized stock data on its own (use binance-tokenized-securities-info), general token
  data (use query-token-info), or new launchpad tokens before they have a pool (use meme-rush).
metadata:
  author: stockyard
  version: "0.1"
---

# Stockyard Stock Memes Skill

## Overview

A stock meme is a meme coin whose main pool is `COIN/STOCK`, where `STOCK` is a tokenized share on
BNB Chain. Stockyard reads PancakeSwap v2's pair list on-chain, keeps every pool that contains a
stock token from Binance's list, and prices them from the contracts. Binance's Web3 API adds
24h volume, holders, hourly history, trades, quotes and wallet payout history.

This skill reads from a Stockyard server and hands execution to **binance-agentic-wallet**.
It never signs anything itself.

| API | Function | Use case |
| --- | --- | --- |
| League | Stock memes, ranked | Discovery, "who holds the most S&P" |
| Coin | One stock meme in detail | "Why did it move", pool depth, stock premium |
| Payslip | A wallet's stock payouts | "What have my memes paid me" |
| Keep-the-stock quote | Sell into stock or cash | Before any sell |

## Recommended Workflows

| User asks | Do this |
| --- | --- |
| "Which memes are paired with the S&P?" | League with `stock=SPY` |
| "Why is NIUMA down today?" | Coin, then report `fromTheMeme` and `fromTheStock` separately |
| "What have my memes paid me?" | `baw wallet address --json`, then Payslip for that address |
| "Sell my NIUMA but keep the stock" | Keep-the-stock quote, confirm, then `baw market-order swap` into the stock token |
| "Sweep my stock dust into SPY" | Payslip for the balances, then one `baw market-order swap` per small stock into the target |

## Key Concept: Two Prices in One Coin

A stock meme's dollar price is `coin per stock` times `stock in dollars`. If the coin did not trade
at all and the stock token rose 2%, the coin's dollar price rose 2%. Always report the split:

```
1 + coinInDollars = (1 + fromTheMeme) × (1 + fromTheStock)
```

> ⚠️ Outside US market hours the stock token keeps trading and can drift from the real share.
> The Coin API returns both `tokenPrice` and `refPrice` for stocks Binance covers. Mention the gap
> before a user sells into or out of the stock.

## Key Concept: Selling Passes Through the Stock

Selling a stock meme for USDT is two swaps: coin to stock, then stock to USDT. Stopping after the
first leaves the user holding the stock. That is the "keep the stock" route: one swap, one fee.

## Supported Chains

| Chain | binanceChainId |
| --- | --- |
| BNB Smart Chain | 56 |

## Setup

Set `STOCKYARD_URL` to a running Stockyard server. No API key is needed for these endpoints.

```bash
export STOCKYARD_URL=http://localhost:4173
```

The same four functions are available as MCP tools: `node mcp/server.mjs`.

## API 1: League

```bash
curl "$STOCKYARD_URL/api/memes?stock=SPY&minMcap=100000&sort=stock&limit=20"
```

| Parameter | Required | Description |
| --- | --- | --- |
| stock | No | Underlying ticker (`SPY`, `QQQ`, `SPCX`, `NVDA`, `AAPL`, `BNC`) or stock token symbol (`SPYB`) |
| minMcap | No | Smallest market cap in USD. Default `100000`. Use `0` for every coin with at least $1,000 of stock in its pool |
| sort | No | `stock` (stock held in the pool, default) or `mcap` |
| limit | No | Up to 100. Default 20 |

Response: `totals` (`poolsFound`, `holdingStock`, `stockUsd`), then `memes[]`:

| Field | Meaning |
| --- | --- |
| coin, address, pool | Symbol, coin contract, pool contract |
| stock, stockTicker, stockToken | Company name, ticker, stock token contract |
| sharesInPool, stockUsdInPool | Stock tokens the pool holds, and their dollar value |
| priceUsd, marketCapUsd | From pool reserves; market cap excludes burned supply |
| volume24hUsd, change24h, holders | From Binance; `change24h` is a fraction (`0.05` is 5%) |

> Pool liquidity belongs to liquidity providers. Never describe it as backing the coin.

## API 2: Coin

```bash
curl "$STOCKYARD_URL/api/coin?a=0xc01a2E136F92772EeCAB15EB054E8f6FA06b7777"
```

Returns `coin` (price, mcap, vol24, holders, `change` for 1h/4h/24h, top10), `stock` (name,
`tokenPrice`, `refPrice`, 52-week range, description, `backed`), `pool` (shares, stockUsd),
`pools[]`, `trades[]` and `series` (hourly closes for the coin and the stock, oldest first).

A 404 means the coin has no live pool against a stock token.

## API 3: Payslip

```bash
curl "$STOCKYARD_URL/api/payslip?w=<wallet address>"
```

| Field | Meaning |
| --- | --- |
| lines[] | One per stock held: `shares`, `value`, `via` (the user's memes paired with it), `paid` |
| lines[].paid | `shares`, `count`, `first`, `last` (ms), `more` (true if history was cut off) |
| paid | Totals across stocks: `usd`, `count`, `since`, `atLeast` |
| recent[] | Latest payouts: `time`, `name`, `shares`, `value`, `payer`, `hash` |
| total | Dollar value of all stock tokens in the wallet today |

> A payout is stock sent by a coin's own distribution call. Stock the user bought is in `shares`
> but not in `paid`. When `paid.atLeast` is true, say "at least".

## API 4: Keep-the-Stock Quote

```bash
curl "$STOCKYARD_URL/api/quote?from=<coin>&to=<stock token>&amount=<smallest units>"
curl "$STOCKYARD_URL/api/quote?from=<coin>&to=0x55d398326f99059fF775485246999027B3197955&amount=<smallest units>"
```

`amount` is in the coin's smallest unit (18 decimals for most). Returns `toAmount`, `vendor`,
`hops[]`, `feeUsd` and `priceImpact`.

> ⚠️ `priceImpact` is a fraction: `0.0042` is 0.42%.

## Executing with Binance Agentic Wallet

Follow every rule in **binance-agentic-wallet**: check `baw wallet status --json` first, append
`--json`, and get an explicit yes before any command that changes state.

Sell and keep the stock:

```bash
baw market-order quote --fromTokenQty 100000 --fromToken <coin> --toToken <stock token> --binanceChainId 56 --json
# show the quote next to the cash quote, wait for the user to confirm, then:
baw market-order swap --fromTokenQty 100000 --fromToken <coin> --toToken <stock token> --binanceChainId 56 --slippage 3 --json
baw market-order list --orderId <orderId> --json   # poll until FINISHED or FAILED
```

`--fromTokenQty` is in whole coins here, unlike the Stockyard quote.

> ⚠️ Many stock memes take a tax on every trade. Add the coin's sell tax to the slippage, or the
> swap will fail. If the user did not give a slippage, say which one you are using.

> ⚠️ `baw limit-order sell` can only end in USDT, USDC or the native token. "Sell into the S&P
> when NIUMA doubles" cannot be a resting order. Say so, and offer either a limit sell to USDT or
> a price check now followed by a market swap into the stock.

## Notes

1. Coverage is PancakeSwap v2 pools against the bStocks family of tokens. A coin paired with an
   Ondo token or trading only on another DEX is not in the league yet.
2. A stock with no USDT pool of at least $500 has no price, so coins paired with it are left out.
3. The server rescans for new pools every five minutes; a coin can take that long to appear.
4. Report dollar figures as estimates. They come from pool reserves at the last refresh.
