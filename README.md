# Stockyard

The home for stock memes on BNB Chain: meme coins whose liquidity pool is quoted in a tokenized
stock instead of BNB. Built by a member of the 牛马 NIUMA community for
[BNB Hack: Tokenized Stocks Edition](https://www.bnbchain.org/en/hackathons/tokenized-stocks).

**Live: https://stockyardbnb.duckdns.org** · Telegram bot [@Stockyard_PayslipBot](https://t.me/Stockyard_PayslipBot) ·
paid data for agents at [`/x402`](https://stockyardbnb.duckdns.org/x402)

An on-chain scan on 6 October 2026 found 202,703 PancakeSwap v2 pools that pair a coin with a
tokenized stock. 3,549 of them held stock that day, $15.8M in total, and 55 of those coins were
worth $100K or more. Some pay their holders in stock. Until now there was no tool built for them.

## What it does

| Page | What you get |
| --- | --- |
| `public/index.html` · League | Every stock meme, ranked by how much real stock sits in its pool, by company. |
| `public/coin.html` · Coin | Why a coin's price moved (meme leg vs stock leg), the stock behind it (token price against the real share, 52-week range), real Binance quotes for selling into the stock or into cash and for buying with the stock or with cash, the trade itself with a dry run first, and live trades through the pool. |
| `public/payslip.html` · 牛马工资条 | Paste a wallet, print a payslip of every payout it has received in stock tokens, with dates, and the stock memes behind them. Save it as an image. Then put the pay to work: swap part of each stock line back into the coin behind it, or gather small lines into one stock, with a Binance quote and a dry run first. |
| `public/agents.html` · Agents | What an agent can do with Stockyard, each item linked to its on-chain proof: the agent's identity, a settled paid call, the agent funding itself, and a live stock trade. |
| `skills/stockyard-stock-memes` | A skill in the Binance Skills Hub format that hands execution to Binance Agentic Wallet. |
| `mcp/server.mjs` | The same data as five MCP tools for any agent. |
| `scripts/agentic-trade.mjs` | A Stockyard trade carried out by Binance Agentic Wallet: Stockyard names the trade and checks it (aggregator quote, balance, Transaction API), then the wallet signed in through Binance's `baw` CLI quotes it again and executes it. It previews by default and trades only with `--send`. |
| `server/paid.mjs` · `/x402` | The same data sold to agents per call over x402, settled through Binance's B402: one cent for the league or a coin, two for a payslip. `GET /x402` is the free catalogue. Each settled call also lists the resource in B402's Bazaar. |
| `scripts/x402-buy.mjs` | An agent paying for that data with no SDK: about 150 lines that take the 402, sign an EIP-3009 authorization and call again. The buyer needs no BNB. |
| `stockyardagent/` | The Stockyard agent, scaffolded with BNB Agent Studio: an ERC-8004 identity on BNB Chain (agent 365431), Studio's runtime with an A2A card and an MCP endpoint, and a work hook that is fixed code, not an LLM. See its own README. |
| `server/telegram.mjs` | A Telegram bot whose every screen is a picture in the site's look with buttons under it: home, the league by company, a coin's card with its own links, and a wallet's payslip. Tapping a button redraws the same message. A price check shows what a sale or a buy would give right now, and payday alerts send the updated slip. A link from the site opens the bot on a wallet. English and 中文. It holds no key and cannot trade. |

## Status

Built during the hackathon build window, 16 September to 11 October 2026, and live.

- Working: the league, coin page and payslip on live data, in English and 中文, covering bStocks,
  pre-IPO and Ondo stock tokens; the server rescans PancakeSwap for new pools at start and every
  five minutes. If Binance cannot be reached, the pages still load from BNB Chain and say what is missing.
- Traded live on BNB Chain mainnet: on 7 Oct 2026 a wallet sold 100 NIUMA through the coin page
  and received 0.000124 SPYB (tokenized S&P 500), routed by Binance's aggregator, in
  [this transaction](https://bscscan.com/tx/0x6eb3cea632d3e97a17089c1a1576f68f2e84e560161e4cab2e3734a462b37f74).
- Built on the same flow: buy-with-stock on the coin page, and reinvest on the payslip. Both use one wallet flow: one button, then the wallet asks for each signature in turn and a
  receipt prints at the end. The server prepares the approval and swap through Binance's
  aggregator and checks them on the Transaction API first; the user's own wallet signs.
  The server never holds a key.
- The Stockyard agent (`stockyardagent/`, built with BNB Agent Studio) is registered on BNB Chain
  mainnet as ERC-8004 agent **365431**, in [this transaction](https://bscscan.com/tx/0x1d978538d858f22bf1c51e3b678f11eb3eac0e2e50bc2642358f3182f6a4c65a). It writes the same reports
  as fixed code and serves them over A2A and MCP.
- Paid data over x402 is switched on and checked against Binance's B402 as far as verification:
  a correctly signed payment from an empty wallet is turned down only for lack of funds, and a
  tampered one for its signature. BNB Agent Studio's own x402 client reads our 402 and picks an
  asset.
- First settled payment: on 7 Oct 2026 the Stockyard agent paid 0.01 U for `/x402/league` from its
  own wallet, using the Studio runtime's x402 client. Binance's B402 settled it and paid the gas, in
  [this transaction](https://bscscan.com/tx/0x1c6c4e13c8d063e00bb101e632f9bdd3b8a23ce71f055ae3971ad0c2bfa1f92f). The agent had funded itself first by swapping BNB into U through
  Binance's aggregator.
- Paid on the hosted site: on 8 Oct 2026 the agent paid 0.01 U for the live
  `https://stockyardbnb.duckdns.org/x402/league`. B402 verified it, the server answered, and B402's
  own signer settled it and paid the gas, in
  [this transaction](https://bscscan.com/tx/0xee59cb7866e5a705dc58c4682399441a86a0b47970784c6dfcc854410ad8ee85):
  0.01 U from the agent's wallet to the project's receiving address.
- Traded by Binance Agentic Wallet: on 8 Oct 2026 `scripts/agentic-trade.mjs` had an Agentic Wallet,
  signed in through Binance's `baw` CLI, buy 768 NIUMA with 0.001 BNB
  ([transaction](https://bscscan.com/tx/0x3b59ff7f2343fba9ca0e0961c29af995684af7e6227b4423867bf4023f56ee49)) and then sell all of it and keep the stock, 0.000934
  SPYB ([transaction](https://bscscan.com/tx/0xf50fecf7de599312845956dcfefa1a2fe82dde14a9ff0c0e8146609b4de71b31)). For each trade Stockyard named it and checked
  it first (aggregator quote, balance, Transaction API) and the wallet quoted it again before
  executing. The wallet's BNB came from the Stockyard agent's own wallet
  ([transaction](https://bscscan.com/tx/0x963f25939aad9fe73a6a702c083959dbf6c05fd2ff049e82986fec0df1984b95)).
- Hosted since 8 Oct 2026 on one small AWS server in Singapore, set up by `deploy/setup.sh`: the
  site, the API, the paid routes and the Telegram bot in one Node process, with Caddy in front for
  HTTPS. From there a Binance quote comes back in about 0.4 s and a full trade plan (quote,
  balance, approval, swap and the Transaction API check) in about 1.4 s.
- Trading from a phone: the trade box opens the same coin, side and amount inside Binance Wallet,
  MetaMask, Trust Wallet, OKX or Bitget, or connects any other wallet through WalletConnect (a QR
  code on a computer). If the network blocks WalletConnect's relay, the page says so first.
- Next: host the agent and switch on its paid jobs.

Binance Web3 API modules in use: RWA Data, Market, Trading, Transaction, Wallet, B402 Payments.
Also used: Binance Agentic Wallet (the `baw` CLI) and BNB Agent Studio.

## Run it

Needs Node 22 or newer. The site and API run with no packages; `npm install` adds one optional
library the Telegram bot uses to draw the payslip image (without it the bot answers in text).

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

To sell data over x402, finish the B402 Payments application in the developer portal, use a key
with the B402 Payments permission, and put the receiving address from that application in `.env`
as `B402_PAY_TO`. Then try it as a buyer:

```bash
node scripts/x402-buy.mjs wallet
node scripts/x402-buy.mjs "http://localhost:4173/x402/league?stock=SPY"
```

The first command makes a throwaway buyer wallet and prints its address; send it a few cents of U
or USD1. The second pays one cent and prints the answer and the settlement transaction. The same
works against the live site: `https://stockyardbnb.duckdns.org/x402/league?stock=SPY`.

To turn on the Telegram bot, create a bot with [@BotFather](https://t.me/BotFather), put its token
in `.env` as `TELEGRAM_BOT_TOKEN` and restart the server. It uses long polling, so it works without
a public address.

Binance checks the caller's location, so run these from a region its
[restricted list](https://web3.binance.com/en/dev-docs/web3-api-prohibited-regions) allows.

## Host it

The server is one Node process with no build step, so any Node host works. `railway.json` sets it
up for Railway: start command, and `/api/health` as the health check.

On a plain Ubuntu server (ours is a 2 GB one on AWS), `deploy/setup.sh` does everything: Node 22,
the app as a service that restarts by itself, and Caddy for HTTPS. With no domain it uses the
server's address under sslip.io. Run it once with `STOCKYARD_HOST=your.domain` to use a real name;
the script remembers it and turns the address-based name into a redirect.

```bash
scp .env ubuntu@<server>:stockyard.env      # your keys, never in the repo
scp deploy/setup.sh ubuntu@<server>:setup.sh
ssh ubuntu@<server> bash setup.sh           # run it again later to update
```

A B402 seller needs a real name: Binance's firewall turns away payment checks whose resource
address is under sslip.io or nip.io. Ours is a free DuckDNS name for that reason.

- **Region matters.** Binance turns away calls from some countries, the United States and the
  Netherlands among them, so pick a region outside its
  [restricted list](https://web3.binance.com/en/dev-docs/web3-api-prohibited-regions). Singapore
  works. `/api/health` says whether Binance is reachable from where the server landed.
- **Settings to give the host:** `BINANCE_W3_API_KEY`, `BINANCE_W3_API_SECRET`, and optionally
  `B402_PAY_TO`, `TELEGRAM_BOT_TOKEN` and `PUBLIC_URL` (the site's own address, used in the links
  the bot and the paid routes hand out). The host supplies `PORT`.
- **One bot per token.** The Telegram bot polls, so run it in one place only. `TELEGRAM_BOT=off`
  in `.env` keeps a second copy, such as the one on your own machine, quiet.
- A new server shows the league from `data/league-seed.json` at once, labelled with when it was
  read, then replaces it with a fresh one built from `data/pools.bin` and `data/live.json`. The payment
  ledger and the bot's watch list are files under `data/`; give the host a volume there if they
  should survive a redeploy.

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
