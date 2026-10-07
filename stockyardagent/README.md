# The Stockyard agent

Stockyard as an agent other agents can find, ask and hire. It was scaffolded with
[BNB Agent Studio](https://docs.bnbchain.org/developer-kit/bnbchain-studio/) (`bag init`) and then
given one job: write reports on stock memes from Stockyard's live data.

| Part | What it is |
| --- | --- |
| Identity | ERC-8004 agent **365431** on BNB Chain mainnet, wallet `0x1E8316cE99376E8E1F5E6b6482243e4d47DADdc3`, registered in [this transaction](https://bscscan.com/tx/0x1d978538d858f22bf1c51e3b678f11eb3eac0e2e50bc2642358f3182f6a4c65a) with gas paid by BNB Chain's sponsor relay. Its registration points at the agent card in this folder. |
| Runtime | Agent Studio's runtime (`app/agent/`), serving an A2A agent card and an MCP endpoint. |
| The work | `app/agent/src/stockyardWork.ts`: a wallet's stock payslip, a coin's breakdown, or the league, as Markdown. Fixed code, no LLM, so it cannot be talked into anything else. |
| Free to try | The MCP tool `stock_meme_report`. |
| Paid | ERC-8183 jobs at $0.10 once the rail is switched on (`payments.erc8183.enabled`). It is off until the agent has durable storage for deliverables. |

The agent reads its numbers from a Stockyard server (`STOCKYARD_URL`, default `http://localhost:4173`).

## Run it

```bash
npm install --global @bnbagent/studio-cli
cd stockyardagent && corepack pnpm install
cd app/agent && bag wallet new --generate-password   # your own wallet; ours is not in the repo
corepack pnpm exec tsc -p tsconfig.json
node --env-file=../../.studio/.env.local dist/dualMain.js
```

Then the agent card is at `http://localhost:9000/.well-known/agent-card.json` and MCP at
`http://localhost:9000/mcp`. `bag dev` does the same in one step where `tsx` works; on our Windows
machine it did not, which is why the compiled form is shown.

`.studio/` holds the encrypted keystore and its password and is never committed.
