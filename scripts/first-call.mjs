// First signed call to the Binance Web3 API, timed and logged for the Developer Experience Report.
// Usage, with the keys in stockyard/.env:  node stockyard/scripts/first-call.mjs [path]
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bw3 } from '../server/binance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(root + '.env');

const log = (line) => {
  mkdirSync(root + 'dx', { recursive: true });
  appendFileSync(root + 'dx/LOG.md', `- ${new Date().toISOString()} ${line}\n`);
};

const path = process.argv[2] || '/api/v1/dex/market/rwa/platforms';
const t0 = performance.now();
try {
  const data = await bw3(path);
  const ms = Math.round(performance.now() - t0);
  console.log(`OK in ${ms} ms: ${path}`);
  console.log(JSON.stringify(data).slice(0, 600));
  log(`call OK ${path} in ${ms} ms`);
} catch (err) {
  const ms = Math.round(performance.now() - t0);
  console.error(`FAILED in ${ms} ms: ${path}\n${err.cause?.code || ''} ${err.message}`);
  log(`call FAILED ${path} in ${ms} ms: ${err.cause?.code || ''} ${err.message}`);
  process.exitCode = 1;
}
