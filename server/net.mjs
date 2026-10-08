// Two settings for outgoing HTTPS, both for networks where large packets get lost (a VPN or a
// mobile link whose real packet size is smaller than it claims). On such a link the first large
// packet of every new connection stalls for about four seconds before it is resent smaller.
//
// 1. Node 24 adds a post-quantum key share to its TLS hello, which makes the hello itself a large
//    packet. Offering only the classic key-exchange groups keeps it small, so the handshake never
//    stalls. Set STOCKYARD_TLS_GROUPS=auto to get Node's default back.
// 2. fetch closes a connection after four idle seconds, so the next request pays for a new one.
//    Keeping connections for a minute means a busy server pays that cost once, not every time.
import tls from 'node:tls';
import net from 'node:net';
import dns from 'node:dns';

// 3. When a name has several addresses, Node gives each one a quarter of a second to connect
//    before moving to the next. A far server often needs longer, and where the next address is
//    IPv6 on a machine without IPv6 the whole connection then fails ("fetch failed", ETIMEDOUT).
//    Telegram is such a name. Five seconds per address ends that.
net.setDefaultAutoSelectFamilyAttemptTimeout?.(5000);

const groups = process.env.STOCKYARD_TLS_GROUPS || 'X25519:P-256:P-384';
if (groups !== 'auto') tls.DEFAULT_ECDH_CURVE = groups;

// 4. Looking a name up can fail for a moment on a slow resolver ("getaddrinfo EAI_AGAIN": no
//    answer, try again). When this machine's resolver gives no answer, the name is asked of two
//    public resolvers instead, first directly and then over HTTPS, and a lookup that still fails
//    is tried again twice. A name that resolved is remembered for five minutes. A resolver that
//    answers "no such name" is believed: only silence is worked around.
// The machine's own lookup, kept before it is replaced below.
const osLookup = dns.lookup;
const known = new Map();
// Made only when first needed, so a process that never needs it carries nothing extra.
let publicDns = null;
const resolver = () => { if (!publicDns) { publicDns = new dns.Resolver({ timeout: 2500, tries: 2 }); publicDns.setServers(['1.1.1.1', '8.8.8.8']); } return publicDns; };
async function elsewhere(hostname) {
  try {
    const list = await new Promise((ok, no) => resolver().resolve4(hostname, (err, found) => (err ? no(err) : ok(found))));
    if (list.length) return list;
  } catch {}
  // The two resolvers again, by address over HTTPS, for networks where plain DNS to them is lost.
  for (const url of [`https://1.1.1.1/dns-query?name=${hostname}&type=A`, `https://8.8.8.8/resolve?name=${hostname}&type=A`]) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
      const list = ((await r.json()).Answer || []).filter((x) => x.type === 1).map((x) => x.data);
      if (list.length) return list;
    } catch {}
  }
  return [];
}
function lookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const key = `${hostname}|${options.family || 0}|${options.all ? 'all' : 'one'}`;
  const hit = known.get(key);
  if (hit && Date.now() - hit.at < 300000) return process.nextTick(() => callback(null, ...hit.found));
  let tries = 0;
  const done = (found) => { known.set(key, { at: Date.now(), found }); callback(null, ...found); };
  const ask = () => osLookup(hostname, options, async (err, ...found) => {
    if (!err) return done(found);
    if (err.code !== 'EAI_AGAIN' || options.family === 6) return callback(err);
    const list = await elsewhere(hostname);
    if (list.length) return done(options.all ? [list.map((address) => ({ address, family: 4 }))] : [list[0], 4]);
    if (++tries < 3) return setTimeout(ask, 800 * tries);
    callback(err);
  });
  ask();
}
// Every connection this process opens looks names up this way, whichever library opens it.
dns.lookup = lookup;

// A second pool for the Telegram bot's replies. It keeps a connection open for twenty seconds, so a
// run of taps does not pay for a new connection each time, and closes it before Telegram would.
// It stays null if the pool class cannot be found.
export let replies = null;

// Node's fetch reads its connection pool from this well-known slot. Node does not expose the pool
// class by name, so a replacement is built from the one already there; if that ever stops
// working, fetch simply keeps its defaults.
try {
  const slot = Symbol.for('undici.globalDispatcher.1');
  await fetch('data:,'); // the pool only exists once fetch has been used
  const Pool = globalThis[slot]?.constructor;
  if (Pool) {
    globalThis[slot] = new Pool({ keepAliveTimeout: 60000, keepAliveMaxTimeout: 300000, connect: { lookup } });
    replies = new Pool({ keepAliveTimeout: 20000, keepAliveMaxTimeout: 30000, connect: { lookup } });
  }
} catch {}
