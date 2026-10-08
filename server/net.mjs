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

// 3. When a name has several addresses, Node gives each one a quarter of a second to connect
//    before moving to the next. A far server often needs longer, and where the next address is
//    IPv6 on a machine without IPv6 the whole connection then fails ("fetch failed", ETIMEDOUT).
//    Telegram is such a name. Five seconds per address ends that.
net.setDefaultAutoSelectFamilyAttemptTimeout?.(5000);

const groups = process.env.STOCKYARD_TLS_GROUPS || 'X25519:P-256:P-384';
if (groups !== 'auto') tls.DEFAULT_ECDH_CURVE = groups;

// A second pool that never reuses a connection, for calls that must not be handed one that has
// gone quiet: the Telegram bot's replies. It stays null if the pool class cannot be found.
export let oneShot = null;

// Node's fetch reads its connection pool from this well-known slot. Node does not expose the pool
// class by name, so a replacement is built from the one already there; if that ever stops
// working, fetch simply keeps its defaults.
try {
  const slot = Symbol.for('undici.globalDispatcher.1');
  await fetch('data:,'); // the pool only exists once fetch has been used
  const Pool = globalThis[slot]?.constructor;
  if (Pool) {
    globalThis[slot] = new Pool({ keepAliveTimeout: 60000, keepAliveMaxTimeout: 300000 });
    oneShot = new Pool({ pipelining: 0 });
  }
} catch {}
