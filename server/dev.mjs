// Local server: the pages in public/ plus the /api routes. Usage: node server/dev.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './routes.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
try { process.loadEnvFile(join(root, '.env')); } catch {}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const send = (res, status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let body;
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 200_000) return send(res, 413, 'application/json', '{"error":"Body too large"}'); }
      try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, 'application/json', '{"error":"Body must be JSON"}'); }
    }
    const { status, json } = await handle(req.method, url.pathname, Object.fromEntries(url.searchParams), body);
    return send(res, status, 'application/json', JSON.stringify(json));
  }
  // Only files inside public/ are ever served.
  const file = normalize(join(pub, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(pub + sep)) return send(res, 403, 'text/plain', 'Forbidden');
  try {
    send(res, 200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch {
    send(res, 404, 'text/plain', 'Not found');
  }
});

const port = Number(process.argv[2] || process.env.PORT || 4173);
server.listen(port, () => console.log(`Stockyard on http://localhost:${port}`));

// Build the league once at start and keep it warm, so page loads never wait on the chain.
const warm = () => handle('GET', '/api/league', {}).then((r) => r.status !== 200 && console.log('league:', r.json.error));
warm();
setInterval(warm, 120000);
