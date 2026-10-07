// A coin's own links (website, X, Telegram) as its team has set them on DexScreener, plus the logo
// shown there. Asked for thirty coins at a time and kept for half an hour.
import './net.mjs';

const cache = new Map();
// These are strings a coin's team typed in. Only plain https links are ever passed on.
const https = (u) => (typeof u === 'string' && /^https:\/\/[^\s<>"'`]+$/i.test(u) ? u : null);

export async function links(addresses) {
  const want = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const stale = want.filter((a) => !(cache.get(a)?.at > Date.now() - 1800000));
  for (let i = 0; i < stale.length; i += 30) {
    const batch = stale.slice(i, i + 30);
    try {
      const res = await fetch('https://api.dexscreener.com/tokens/v1/bsc/' + batch.join(','), { signal: AbortSignal.timeout(15000) });
      const pairs = res.ok ? await res.json() : null;
      if (!Array.isArray(pairs)) continue;
      const found = new Map();
      for (const p of pairs) {
        const a = p.baseToken?.address?.toLowerCase(), info = p.info || {};
        if (!a) continue;
        const social = (type) => https((info.socials || []).find((s) => s.type === type)?.url);
        const v = { website: https(info.websites?.[0]?.url), x: social('twitter'), telegram: social('telegram'), dex: https(p.url), logo: https(info.imageUrl) };
        // A coin can have several pairs; keep the one that carries the most links.
        const score = (x) => [x.website, x.x, x.telegram, x.logo].filter(Boolean).length;
        if (!found.has(a) || score(v) > score(found.get(a))) found.set(a, v);
      }
      for (const a of batch) cache.set(a, { at: Date.now(), value: found.get(a) || null });
    } catch { /* ask again next time */ }
  }
  return new Map(want.map((a) => [a, cache.get(a)?.value || null]));
}
