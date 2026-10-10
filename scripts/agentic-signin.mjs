#!/usr/bin/env node
// Signs Binance Agentic Wallet in on this machine, in one go: asks Binance's baw CLI for a pairing
// code, opens the page with the QR code, then waits for you to confirm it in the Binance app.
// Nothing is typed here and no key or password passes through this script: you approve the
// sign-in on your phone, and baw keeps its own session.
//
//   node scripts/agentic-signin.mjs
import { spawnSync, spawn } from 'node:child_process';

const stop = (msg) => { console.log(msg); process.exit(1); };
// On Windows baw is a .cmd file, which only a shell can start; the words given to it are fixed
// apart from the code id, which is checked to be one before use.
function baw(words, wait = 120000) {
  const r = process.platform === 'win32'
    ? spawnSync(`baw ${words} --json`, { encoding: 'utf8', shell: true, timeout: wait })
    : spawnSync('baw', [...words.split(' '), '--json'], { encoding: 'utf8', timeout: wait });
  try { return JSON.parse(r.stdout); } catch { stop('Could not read an answer from baw. Install it with: npm install -g @binance/agentic-wallet'); }
}
const cannotReach = (j) => /TIMEOUT|DNS|Host not found/i.test(JSON.stringify(j.error || ''));

const before = baw('wallet status');
if (cannotReach(before)) stop('Binance cannot be reached from this connection. Turn the VPN on and run this again.');
if (before.data?.status === 'CONNECTED') { console.log('Agentic Wallet is already signed in on this machine.'); process.exit(0); }

const start = baw('auth signin');
if (cannotReach(start)) stop('Binance cannot be reached from this connection. Turn the VPN on and run this again.');
if (start.data?.status === 'ALREADY_CONNECTED') { console.log('Agentic Wallet is already signed in on this machine.'); process.exit(0); }
const { pairingCode, urlForWeb, qrCodeId } = start.data || {};
if (!start.success || !/^[0-9a-f-]{36}$/i.test(qrCodeId || '') || !/^https:\/\/[\w.-]+\/[\w./?=&%-]*$/.test(urlForWeb || '')) stop('baw did not start a sign-in: ' + JSON.stringify(start.error ?? start).slice(0, 300));

console.log(`\nPairing code:  ${pairingCode}\n`);
console.log('1. A page with a QR code is opening in your browser. If it does not, open this link:');
console.log('   ' + urlForWeb);
console.log('2. In the Binance app, on the Wallet screen, tap the scan icon and scan the QR code.');
console.log(`3. Check the app shows the code ${pairingCode}, then tap Confirm.`);
console.log('\nWaiting for you to confirm (up to 5 minutes). Leave this window open…');
// Open the page in the default browser. The link was checked above to be a plain https address.
if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', urlForWeb], { stdio: 'ignore', detached: true }).unref();

const done = baw(`auth verify --qrCodeId ${qrCodeId}`, 330000);
if (!done.success) stop('\nNot signed in: ' + JSON.stringify(done.error ?? done).slice(0, 300) + '\nThe code lasts five minutes. Run this again for a new one.');
const after = baw('wallet status');
console.log(after.data?.status === 'CONNECTED' ? '\nSigned in. Agentic Wallet is connected on this machine.' : '\nThe app confirmed, but baw still says it is not connected. Run this again for a new code.');
