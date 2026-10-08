- 2026-10-06T17:31:18.874Z call OK /api/v1/dex/market/rwa/platforms in 1224 ms
- 2026-10-06 Docs: web3.binance.com, developers.binance.com and www.binance.com reset the connection on a Nigerian home connection (curl error 35, later NXDOMAIN from the ISP resolver). Nigeria is not on the prohibited-regions list, so an eligible builder cannot open the docs or the portal without a VPN.
- 2026-10-06 Docs: with a working connection, curl and fetch get HTTP 202 with an empty body from every dev-docs page, including llms.txt and llms-full.txt. They only load in a real browser, so "feed the docs to your agent" needs a browser session.
- 2026-10-06 Docs: llms-full.txt (451k characters) has the guides but not the per-endpoint parameter tables, so parameters had to be found by trial calls.
- 2026-10-06 Portal: key created in Project 1 with Trade, Transaction, Wallet, Market and DeFi ticked. B402 Payments could not be ticked; it needs a separate application first, and a key cannot gain the permission afterwards.
- 2026-10-06 Auth: signing worked first time following the Authentication page. The /build prefix warning there is what made it work.
- 2026-10-06 First nine calls all passed: rwa/tokens 910 ms, rwa/price 444 ms, token/top-liquidity 562 and 766 ms, market/trades 1189 ms, aggregator/quote 443 and 1050 ms, balance/token-balances-by-address 461 ms, token/holder 652 ms.
- 2026-10-06 Trading: aggregator/quote routes a Flap stock meme (NIUMA) into its quote stock (SPYB) in one hop through LiquidMesh, and into USDT through SPYB in two hops. priceImpactPercent came back as 0.0042 for a 0.42% impact, so it is a fraction despite the name.
- 2026-10-06 Market: token/top-liquidity returns 15 pools for SPYB. PancakeSwap v2 has far more pools quoted in SPYB than that, so finding every stock-paired pool needed an on-chain scan of the factory's pair list. liquidityUsd and tokenAmount are null for some pools.
- 2026-10-06 RWA: rwa/tokens with platformId=bstock returned 46 items while rwa/platforms reports 87 bStock tickers on BSC; not yet clear whether that is paging or a filter.
- 2026-10-06T18:20:41.468Z call OK /api/v1/dex/market/rwa/platforms in 1098 ms
- 2026-10-06 Transaction: pre-transaction/simulate with the wrong body answers "evmParams is required for EVM chains", but the field in the schema is evmTx. The error names a field that does not exist.
- 2026-10-06 Docs: the per-endpoint parameters are only in the downloadable schema.json linked from the API reference page ("Download schema"), not in llms-full.txt. Finding that link is what unblocked swap, simulate and history.
- 2026-10-06 Transaction: broadcast-transaction needs a signed raw transaction. Browser wallets sign and send in one step, so a web app cannot use Binance's broadcast or its MEV protection for user trades.
- 2026-10-06 Trading: for 1,000 NIUMA the aggregator routed NIUMA > WBNB > BTCB > USDT > SPYB (four hops) although a direct NIUMA/SPYB pool exists; at 100,000 NIUMA it used the direct pool.
- 2026-10-06 Trading: quote reports taxRate "0" for NIUMA, while GoPlus reports a 1% buy and sell tax on the same token.
- 2026-10-06 Market: token/basic-info is a POST that takes its parameters in the query string; sending them in the body returns "Parameter binanceChainId is required".
- 2026-10-06 RWA: the keyed rwa/tokens list has 46 bStocks on BSC. Binance's public bapi list has 87, including BNCB, GMEB, DJTB and NFLXB, which have thousands of pools each. rwa/price and the underlying-* endpoints do not cover those.
- 2026-10-06 Wallet: transactions-by-address returns methodId, which made it possible to tell holder payouts (0x84da2c7b) from ordinary transfers. limit=100 works; the cursor pages further back.
- 2026-10-06 Wallet: token-balances-by-address accepts 20 tokens per call, so checking all 92 stock tokens for one wallet takes five calls.
- 2026-10-06T22:25:57.659Z call FAILED /api/v1/dex/market/rwa/platforms in 10753 ms: UND_ERR_CONNECT_TIMEOUT fetch failed
- 2026-10-06T22:32:15.549Z call FAILED /api/v1/dex/market/rwa/platforms in 10803 ms: UND_ERR_CONNECT_TIMEOUT fetch failed
- 2026-10-06 Reliability: when the connection to web3.binance.com drops, every signed call waits about 10 seconds for a connect timeout, so a page that makes ten calls hangs. Added a breaker: after one connect failure, calls fail at once and a background check every 30 seconds restores them.
- 2026-10-06 Wallet: reading one wallet's balance of 534 stock tokens through Multicall3 is a 120 KB request. On a slow uplink that alone is about 10 seconds; the Wallet API's 20-token limit would make it 27 signed calls instead.
- 2026-10-07T01:52:07.954Z call OK /api/v1/dex/market/rwa/platforms in 1309 ms
- 2026-10-07 Infra: with a VPN on (Windscribe, Germany) the Binance API works, but the VPN's DNS filter answers 0.0.0.0 for bsc-dataseed*.bnbchain.org, so five of our six chain nodes died at once. Without the VPN it is the reverse: the chain works and Binance does not. Fixed with a wider node list and resting nodes that fail.
- 2026-10-07 Trading: aggregator/quote routes a stock token into a Flap stock meme too (SPYB > NIUMA in one hop through LiquidMesh, 0.37% impact for $70). pre-transaction/simulate passed the approval for a wallet we do not control, so the dry run needs no signature.
- 2026-10-07 Wallet: transactions-by-address is the slow call, about 1 to 3 seconds per 100 rows. Twelve of them in a row made one payslip take 57 seconds; three at a time alongside the chain read brought it to 11.
- 2026-10-07 Trading: buying NIUMA with 0.064 SPYB ($50) routes through the direct pool in one swap, but 0.01 SPYB ($7.81) is routed through four swaps and USDT through three, for the same output. Small orders skip the direct stock pool.
- 2026-10-07 B402: POST /api/v2/b402/supported answered 000000000 with our existing key once the B402 application was in, with ten kinds across U, USD1, USDT and USDC. The body has to be wrapped as {"body":{}}, unlike every other endpoint.
- 2026-10-07 B402: a kind carries the token's EIP-712 name ("United Stables") but not its contract address. We matched kinds to addresses by calling name() on the four tokens listed in the docs.
- 2026-10-07 B402: verify with a payTo that is not the project's own answers invalid_exact_evm_payload_recipient_mismatch. No endpoint returns the configured payTo, so a server cannot discover its own receiving address; it has to be copied by hand from the portal.
- 2026-10-07 B402: wrote the buyer side with no SDK (Keccak-256, secp256k1 and EIP-712 in plain BigInt). Checked it against the tokens' on-chain DOMAIN_SEPARATOR values, which matched for U and USD1 with version "1".
- 2026-10-07 Docs: with the VPN that Binance needs, bnbchain.org does not resolve (the VPN's DNS filter answers 0.0.0.0), so the BNB Agent Studio docs had to be read from their GitHub source, bnb-chain/bnb-chain.github.io.
- 2026-10-07 Trading: first live trade through the app. 100 NIUMA into 0.000124 SPYB via aggregator/swap, signed in a browser wallet: https://bscscan.com/tx/0x6eb3cea632d3e97a17089c1a1576f68f2e84e560161e4cab2e3734a462b37f74 (gas 497,586, fee 0.0000249 BNB). For this small size the route went NIUMA > USDT > SPYB instead of the direct pool.
- 2026-10-07 Speed: every call from our Node server took about 4 seconds while curl took 0.4. Two causes on this network (a VPN whose real packet size is below what it reports). First, Node 24's TLS hello carries a post-quantum key share and is too big for one packet; limiting the key-exchange groups to X25519/P-256/P-384 took the handshake from 4 s to 0.35 s. Second, the first large packet on each new connection stalls about 4 s, and pre-transaction/simulate carries a 3 KB body, so each simulate stalled; keeping connections open for a minute brought preparing a trade from 8.3 s to 1.5 s.
- 2026-10-07 Trading: quote, approve-transaction and swap are small GETs and can run side by side; only simulate needs a POST with the transaction data.
- 2026-10-07 Agent Studio: `bag init` with `--llm-provider none --no-onboard` gives a working TypeScript seller in one command, and `bag wallet new --generate-password` makes a wallet without anyone typing a password. Replacing the LLM work hook with fixed code was a two-function change (dualMain.ts and mcpMain.ts each build their own).
- 2026-10-07 Agent Studio: `bag dev` runs the agent through tsx, which failed here with ERR_PACKAGE_IMPORT_NOT_DEFINED "#cjs-loader" because the project sits in a Windows app-sandboxed folder. Compiling with tsc and running `node dist/dualMain.js` with the env file worked.
- 2026-10-07 Agent Studio: the help text says ERC-8004 registry writes are gas-sponsored, and `bag doctor` asks for 0.02 BNB, but `bag erc8004 register` on mainnet refused an empty wallet and asked for about 0.002 BNB. Its error message points to the testnet faucet even though the network is mainnet.
- 2026-10-07 Agent Studio: selling over x402 from a Studio agent needs a second B402 onboarding (developers.binance.com onchainpay-x402: RSA key pair, client id, a fixed list of egress IPs), separate from the Web3 developer portal's B402 Payments that our own server uses. The two are both called B402 and are not interchangeable.
- 2026-10-07 Agent Studio: registered the agent on BNB Chain mainnet as ERC-8004 agent 365431 (https://bscscan.com/tx/0x1d978538d858f22bf1c51e3b678f11eb3eac0e2e50bc2642358f3182f6a4c65a). The transaction's gas price is 0: the MegaFuel relay paid, and the wallet's BNB did not move. The CLI still insists on about 0.002 BNB in the wallet before it will try.
- 2026-10-07 Agent Studio: on a slow link the CLI gave up waiting and logged the registration as failed, while the transaction had confirmed. `bag erc8004 show` read the agent back correctly, and the stale pending state needed `bag erc8004 clear-pending --force`. Three attempts were needed because its RPC calls time out at 10 seconds; preloading our TLS fix with NODE_OPTIONS=--import made it work.
- 2026-10-07 B402: with the project's real payTo, verify answers a correctly signed EIP-3009 payment from an empty wallet with invalid_transaction_state, not insufficient_funds. A changed signature, amount or expiry each answer invalid_exact_evm_payload_signature. So the reason for an empty wallet is not the one the error table suggests.
- 2026-10-07 B402 and Agent Studio together: `bag x402 quote <our url> --local-dev` parsed our HTTP 402, chose U as the asset and listed USD1 as an alternative, so a server built on the Web3 portal's B402 is readable by Studio's buyer.
- 2026-10-07 B402 and Agent Studio: the Studio runtime's x402 client (fetchWithPayment) produced an envelope our server accepts unchanged, and B402 verify answered isValid true for it. The first live attempt, made a second after the wallet received its U, did not settle; our best reading is that verify checks against a view of the chain a few blocks behind, so a payment made right after funding is turned down. The seller now records why a payment was refused, and the buyer waits and retries.
- 2026-10-07 B402: first settled payment. The agent (ERC-8004 id 365431) paid 0.01 U for /x402/league with the Studio runtime's fetchWithPayment; our server verified, answered and settled through B402. The settlement transaction was sent by B402's signer 0x34F7…0899, which paid the gas: https://bscscan.com/tx/0x1c6c4e13c8d063e00bb101e632f9bdd3b8a23ce71f055ae3971ad0c2bfa1f92f
- 2026-10-07 Correction to the entry above about timing: the earlier attempt never reached the payment. Our own script gave up waiting for the top-up swap to confirm on a slow node and stopped, as it was written to. The swap had confirmed. Run again, the payment settled first time.
- 2026-10-07 Trading: the agent's top-up used aggregator/quote and swap with BNB itself as the from-token, written as 0xeeee…eeee. No approve-transaction is needed for it, and the amount goes in the transaction's value.

## 8 Oct 2026 · hosting

- Moved the server from my PC in Nigeria (through a VPN in Germany) to a 2 GB AWS machine in Singapore. Same code, same key.
- Binance Web3 API from Singapore: a quote in about 0.4 s, and the whole trade plan (quote, balance and allowance, approve-transaction, swap, Transaction API check) in about 1.4 s. From my PC the same plan took many seconds.
- `/api/health` answered "binance: reachable" on the first try. No allowlist step was needed for the data and trading modules.
- The earlier servers I had were in Ohio, and Binance turns US callers away, so the region had to be chosen before anything else. This is easy to miss: nothing in the portal asks where you will host.
- HTTPS with no domain: Caddy plus the server's address under sslip.io got a Let's Encrypt certificate in about 10 seconds.
- Telegram allows one long-polling copy of a bot, so the PC copy had to be switched off (`TELEGRAM_BOT=off`) when the hosted one started.
- The x402 challenge now names the public https address as the resource, which is what B402 lists in its Bazaar after a settled call.

## 8 Oct 2026 · B402 and the address of the site

- First paid call against the hosted site failed. The agent signed, my server called B402 `verify`, and Binance answered HTTP 403 with an HTML page ("This request is blocked") from CloudFront, not the API's usual JSON with a code. Nothing was charged.
- Cause, found by sending the same unsigned test payment with different addresses in `resource.url`: any address under `sslip.io` or `nip.io` in the request body is blocked by the firewall in front of the API. `localhost`, a bare IP, a `duckdns.org` name and an ordinary domain all pass and get the normal JSON answer. So the free "IP as a domain" names that make HTTPS easy cannot be used for a B402 seller.
- This was invisible in testing on my PC, because there the resource address was `http://localhost:4173`.
- It would help if B402 said this in the docs, or answered with a JSON error. As it is, the seller sees an HTML page inside a JSON API, and the buyer sees a 502.
- While probing I also hit HTTP 429 after about ten calls in a few seconds on the same key.
- Fix on my side: give the site a real name. Also changed the server to tell the buyer "B402 could not check this payment, nothing was charged" and to keep the reason at `/x402/last`.

## 8 Oct 2026 · the fix for the B402 block, and WalletConnect

- Moved the site to a free DuckDNS name (stockyardbnb.duckdns.org). The same unsigned test payment that got the 403 page under sslip.io now gets the normal JSON answer from B402 `verify` ("invalid_exact_evm_payload_signature", which is right for a made-up signature).
- Phone trading: a phone's own browser has no wallet, so the page links into wallet apps' browsers. Binance Wallet's link format is not in the Web3 API docs; I took it from the published @binance/w3w-utils package (`bnc://app.binance.com/mp/app?appId=…&startPagePath=…&startPageQuery=…`, wrapped as `https://app.binance.com/en/download?_dp=`).
- My mobile carrier's DNS does not resolve relay.walletconnect.org (it also blocks binance.com), so WalletConnect cannot be tested from my own network without a VPN. The page now checks the relay first and says so.

## 8 Oct 2026 · first paid call on the hosted site

- The agent paid 0.01 U for https://stockyardbnb.duckdns.org/x402/league and B402 settled it: https://bscscan.com/tx/0xee59cb7866e5a705dc58c4682399441a86a0b47970784c6dfcc854410ad8ee85 (block 126496388, sent by B402's signer 0x34F7…0899, 0.01 U from the agent wallet to my receiving address). So the 403 really was the sslip.io name and nothing else: same code, same key, a different host name.
- Two tries before it failed on my side, not Binance's: my connection's DNS gave no answer for the site's name (getaddrinfo EAI_AGAIN). The script now asks a public resolver when that happens.
- The Telegram bot lost about one call in four to api.telegram.org from the AWS server until I found that Node gives each address of a name only 250 ms to connect (the server has no IPv6, Telegram has an IPv6 address). Not a Binance issue, but it cost an evening.

## 8 Oct 2026 · Agentic Wallet

- Installed the CLI with `npm install -g @binance/agentic-wallet@1.10.0` (74 packages, 14 s). `baw auth signin --json` returned a pairing code and a link (app.binance.com/uni-qr/…); scanning it in the Binance app showed the same code and my PC's IP and city, and one tap signed in. `baw wallet status` said CONNECTED straight after.
- Finding Agentic Wallet inside the Binance app was the hard part: it is not on the Wallet home screen, and the skill docs only say "create one in the Binance App". The QR sign-in from the PC is what took me to it.
- The wallet has one address for every EVM chain and a separate Solana one. `wallet balance` hides anything worth less than a cent, so a new wallet answers with an empty list.
- `wallet settings` showed the defaults: $50,000 daily limit, abnormal transactions auto-rejected, tradeAllTokens false, x402 limit $20 a day, developer mode off, signed in for 48 hours.
- `market-order quote` answered for NIUMA into SPYB, SPYB into NIUMA, USDT into SPYB and BNB into SPYB before the wallet held anything, so a quote needs no balance. Its numbers were within half a percent of the Web3 API's aggregator/quote for the same trade (0.000611 against 0.000613 SPYB for 500 NIUMA).
- On Windows `baw` is a .cmd file, so starting it from Node needs a shell; with every argument an address, a number or a fixed word that is safe, but passing JSON (x402-payment preview) that way would not be.

## 8 Oct 2026 · first trades by Agentic Wallet

- Funded the Agentic Wallet with 0.0016 BNB from the Stockyard agent's own wallet (https://bscscan.com/tx/0x963f25939aad9fe73a6a702c083959dbf6c05fd2ff049e82986fec0df1984b95), then ran two trades through `baw market-order swap` from my script.
- Trade 1, BNB into NIUMA: 0.001 BNB gave 768.237 NIUMA, finished one second after it was booked: https://bscscan.com/tx/0x3b59ff7f2343fba9ca0e0961c29af995684af7e6227b4423867bf4023f56ee49. Network fee 0.0000619 BNB, paid by the wallet itself.
- Trade 2, NIUMA into SPYB (sell the meme, keep the stock): 768.237 NIUMA gave 0.000934177 SPYB: https://bscscan.com/tx/0xf50fecf7de599312845956dcfefa1a2fe82dde14a9ff0c0e8146609b4de71b31. The wallet sent its own approval first (0x795c7344…af5c, to 0xb300000b72DEAEb607a12d5f54773D1C19c7028d); fees 0.0000033 and 0.0000444 BNB.
- Pitfall: for trade 2, `market-order swap` returned orderId 26100800001951375543, but `market-order list --orderId 26100800001951375543` kept answering an empty list. The order had finished and is listed as 26100800001951375297. For trade 1, which needed no approval, the two ids matched. The skill docs say to poll by the returned id until FINISHED, which would wait forever here. My script now falls back to the newest order for the pair.
- `tradeAllTokens` was false ("Limited Tokens" in the app) and NIUMA still traded, so either it is on the allowed list or the setting does not cover it. I could not find the list.
- Quotes agreed closely before each trade: Stockyard's aggregator quote said 772.1 NIUMA and Agentic Wallet 768.3 (got 768.2); then 0.000946746 against 0.000943614 SPYB (got 0.000934177).
- `wallet tx-history` returns the fee, the approval and the send/receive legs of each swap, which is everything a receipt needs.

## 8 Oct 2026 · checking my notes against the docs before writing the report

- Reopened the docs (VPN on) to get exact URLs. Three earlier notes hold up as documentation problems:
  - https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/trading-api#get-aggregated-quote--data-priceimpactpercent says "Estimated price impact percentage" with the example "-0.01". The value is a fraction: 0.0042 came back for a 0.42% impact. taxRate on the same page does say "Range 0–1".
  - https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api#simulate-transactions/request-body marks evmTx, solTx and tronTx all as required, while each one's own text says it is required only for its chain. The API's error for a wrong body says "evmParams is required for EVM chains", and evmParams appears nowhere in schema.json.
  - https://web3.binance.com/en/dev-docs/products/b402-api/error-codes lists insufficient_funds among the verify reasons without saying when each is returned; a correctly signed payment from an empty wallet got invalid_transaction_state.
- Two earlier notes were my own mistakes, not the docs': the reference does show token/basic-info taking its parameters in the query string, and the B402 integration guide does warn that the body must be wrapped as {"body": ...}. The B402 token addresses are also listed, on the payment methods page; it is only the `supported` response that leaves them out.
- The page that mattered most stays https://web3.binance.com/en/dev-docs/authentication.
