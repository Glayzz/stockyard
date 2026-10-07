// Read-only BNB Chain access over public nodes, batched through Multicall3.
// Which nodes answer depends on where the server runs: some networks and DNS filters block the
// bnbchain.org ones. Each was checked with a 500-call batched read.
const RPCS = [
  'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.bnbchain.org', 'https://bsc-dataseed1.ninicoin.io', 'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed2.bnbchain.org', 'https://bsc-dataseed2.defibit.io', 'https://rpc-bsc.48.club',
  'https://bsc-dataseed3.bnbchain.org', 'https://bsc-dataseed2.ninicoin.io', 'https://bsc.blockrazor.xyz',
];
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const restUntil = new Map();
let turn = 0;

// The next node to ask: round-robin, skipping any that failed in the last while.
function pick() {
  for (let i = 0; i < RPCS.length; i++) {
    const url = RPCS[turn++ % RPCS.length];
    if ((restUntil.get(url) || 0) <= Date.now()) return url;
  }
  return RPCS[turn++ % RPCS.length];
}

export const word = (n) => BigInt(n).toString(16).padStart(64, '0');
export const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
export const toAddr = (hex) => '0x' + hex.slice(24, 64);
export const toNum = (hex, decimals = 18) => Number(BigInt('0x' + (hex.slice(0, 64) || '0'))) / 10 ** decimals;

// ABI string return (symbol, name). Some old tokens return bytes32 instead.
export function toText(hex) {
  if (!hex) return '';
  let bytes;
  if (hex.length >= 128 && parseInt(hex.slice(0, 64), 16) === 32) bytes = hex.slice(128, 128 + parseInt(hex.slice(64, 128), 16) * 2);
  else bytes = hex.slice(0, 64).replace(/(00)+$/, '');
  try { return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes.match(/../g) || [], (b) => parseInt(b, 16))); } catch { return ''; }
}

// One JSON-RPC call, rotating through the nodes. A node that cannot be reached is rested for two
// minutes and one that throttles for twenty seconds, so later calls go straight to the ones that work.
export async function rpc(method, params, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    const url = pick();
    let pause = 300 * (i + 1);
    try {
      const r = await (await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })).json();
      if (typeof r.result === 'string') return r.result;
      last = r.error?.message || 'bad reply';
      restUntil.set(url, Date.now() + 20000);
    } catch (e) {
      last = e.cause?.code || e.message;
      restUntil.set(url, Date.now() + 120000);
      pause = 50;
    }
    await new Promise((res) => setTimeout(res, pause));
  }
  throw new Error('BNB Chain nodes failed: ' + last);
}

// Runs many read calls in one eth_call. calls is [[target, calldataHex], ...]; returns each call's
// return data as hex without 0x, or null where the call reverted.
export async function multicall(calls) {
  const n = calls.length;
  let head = '', tail = '', offset = n * 32;
  for (const [to, data] of calls) {
    const len = data.length / 2, padded = data.padEnd(Math.ceil(len / 32) * 64, '0');
    head += word(offset);
    tail += addrWord(to) + word(1) + word(96) + word(len) + padded;
    offset += 128 + padded.length / 2;
  }
  const res = (await rpc('eth_call', [{ to: MULTICALL, data: '0x82ad56cb' + word(32) + word(n) + head + tail }, 'latest'])).slice(2);
  const at = (byte) => parseInt(res.slice(byte * 2, byte * 2 + 64), 16);
  return calls.map((_, k) => {
    const elem = 64 + at(64 + k * 32), bytes = elem + at(elem + 32), len = at(bytes);
    return at(elem) === 1 && len ? res.slice((bytes + 32) * 2, (bytes + 32 + len) * 2) : null;
  });
}

// multicall for long lists, split into chunks and run a few at a time.
export async function multicallAll(calls, chunk = 500, parallel = 4) {
  const out = new Array(calls.length);
  const starts = [];
  for (let i = 0; i < calls.length; i += chunk) starts.push(i);
  // A big request can fail on a weak connection where two smaller ones get through.
  const run = async (list) => {
    try { return await multicall(list); }
    catch (err) {
      if (list.length <= 50) throw err;
      const half = Math.ceil(list.length / 2);
      return [...await run(list.slice(0, half)), ...await run(list.slice(half))];
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, starts.length) }, async () => {
    while (next < starts.length) {
      const s = starts[next++];
      const part = await run(calls.slice(s, s + chunk));
      for (let k = 0; k < part.length; k++) out[s + k] = part[k];
    }
  }));
  return out;
}
