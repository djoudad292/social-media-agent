const express = require('express');
const path = require('path');
const { URLSearchParams } = require('url');
const app = express();

app.use(express.json({ limit: '5mb' }));

const config = require(path.join(__dirname, '..', '..', 'shared', 'config'));
const db = require(path.join(__dirname, '..', '..', 'shared', 'db'));
const redis = require(path.join(__dirname, '..', '..', 'shared', 'redis'));

const SIDECAR_PORT = config.port.gateway;

function log(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, service: 'gateway', msg, ...meta };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

async function getFetch() {
  return globalThis.fetch || (await import('node-fetch')).default;
}

async function call(u, b = null, m = 'GET') {
  try {
    const f = await getFetch();
    const o = {
      method: m,
      headers: {
        'Content-Type': 'application/json',
        'x-agent-token': config.gatewayToken || '',
      },
      signal: AbortSignal.timeout(60000),
    };
    if (b) o.body = JSON.stringify(b);
    const r = await f(u, o);
    return await r.json();
  } catch (e) {
    return { error: e.message, unreachable: true };
  }
}

// ── Health ───────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true, service: 'gateway', ts: new Date().toISOString() }));

// ── Status ───────────────────────────────────────────────

app.get('/api/status', async (req, res) => {
  const h = await redis.getHeartbeats();
  const s = {};
  for (const [n, u] of Object.entries(config.services)) {
    if (!u) { s[n] = 'no_url'; continue; }
    try {
      const f = await getFetch();
      const r = await f(`${u}/health`, { signal: AbortSignal.timeout(5000) });
      s[n] = r.ok ? 'alive' : 'error';
    } catch {
      s[n] = 'down';
    }
  }
  res.json({ services: s, heartbeats: h });
});

// ── Proxy routes ─────────────────────────────────────────

const routes = {
  'content/generate': ['POST', 'content'],
  'content/research': ['POST', 'content'],
  'media/reel': ['POST', 'media'],
  'media/tts': ['POST', 'media'],
  'data/scrape': ['POST', 'data'],
  'data/analytics': ['POST', 'data'],
  'data/leads/hunt': ['POST', 'data'],
  'data/strategy': ['POST', 'data'],
  'memory/posts': ['GET', 'data', 'posts'],
  'memory/analytics': ['GET', 'data', 'analytics'],
  'memory/trending': ['GET', 'data', 'trending'],
  'memory/pause': ['GET', 'data', 'pause'],
};

for (const [route, [method, svc]] of Object.entries(routes)) {
  const svcUrl = config.services[svc];
  if (method === 'POST') {
    app.post(`/api/${route}`, async (req, res) => {
      if (!svcUrl) return res.json({ error: `${svc} service not configured` });
      res.json(await call(`${svcUrl}/${route}`, req.body, 'POST'));
    });
  } else if (method === 'GET') {
    app.get(`/api/${route}`, async (req, res) => {
      if (!svcUrl) return res.json({ error: `${svc} service not configured` });
      const qs = new URLSearchParams(req.query).toString();
      res.json(await call(`${svcUrl}/${route}${qs ? '?' + qs : ''}`));
    });
  }
}

// ── Direct Facebook post fallback ────────────────────────

app.post('/api/facebook/post', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const f = await getFetch();
    const r = await f(`https://graph.facebook.com/v21.0/me/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: config.facebook.accessToken || '',
        message,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.id) {
      await db.savePost({
        content: message, type: 'post', status: 'posted', facebook_post_id: d.id,
      });
      res.json({ success: true, post_url: `https://facebook.com/${d.id}` });
    } else {
      res.status(500).json({ error: 'Facebook error', raw: d });
    }
  } catch (e) {
    log('error', 'Facebook post failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Startup ──────────────────────────────────────────────

async function start() {
  await redis.connect();
  setInterval(() => redis.heartbeat('gateway'), 60000);
  app.listen(SIDECAR_PORT, '0.0.0.0', () => log('info', 'Gateway sidecar started', { port: SIDECAR_PORT }));
}

function shutdown(signal) {
  log('info', 'Shutdown received', { signal });
  try { redis.getRedis().quit(); } catch {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection', { reason: reason?.message || reason });
});
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

start();
