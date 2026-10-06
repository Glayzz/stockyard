// Read-only BNB Chain access over public nodes, batched through Multicall3.
const RPCS = [
  'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.bnbchain.org', 'https://bsc-dataseed2.bnbchain.org',
  'https://bsc-dataseed3.bnbchain.org', 'https://bsc-dataseed4.bnbchain.org', 'https://bsc-rpc.publicnode.com',
];
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
let turn = 0;

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

// One JSON-RPC call, rotating through the nodes and retrying with a pause when one fails or throttles.
export async function rpc(method, params, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    const url = RPCS[turn++ % RPCS.length];
    try {
      const r = await (await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })).json();
      if (typeof r.result === 'string') return r.result;
      last = r.error?.message || 'bad reply';
    } catch (e) { last = e.message; }
    await new Promise((res) => setTimeout(res, 250 * (i + 1)));
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
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, starts.length) }, async () => {
    while (next < starts.length) {
      const s = starts[next++];
      const part = await multicall(calls.slice(s, s + chunk));
      for (let k = 0; k < part.length; k++) out[s + k] = part[k];
    }
  }));
  return out;
}
