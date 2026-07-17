const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '5mb' }));

const config = require(path.join(__dirname, '..', '..', 'shared', 'config'));
const redis = require(path.join(__dirname, '..', '..', 'shared', 'redis'));
const azure = require(path.join(__dirname, '..', '..', 'shared', 'azure-proxy'));

const PORT = config.port.content;

function log(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, service: 'content', msg, ...meta };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ── Auth ─────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true, service: 'content', ts: new Date().toISOString() }));

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const t = req.headers['x-agent-token'];
  if (config.gatewayToken && t !== config.gatewayToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Content generation ───────────────────────────────────

app.post('/content/generate', async (req, res) => {
  try {
    const { topic, type, tone } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });
    const prompts = {
      post: `Write a ${tone || 'casual'} Facebook post about: ${topic}. Under 200 words. 3-5 hashtags + CTA.`,
      reel: `Write a 15s reel script about: ${topic}. Visual cues + CTA.`,
      thread: `Write 3-5 post thread about: ${topic}.`,
      idea: `Generate 5 content ideas about ${topic} for a tech page.`,
    };
    const prompt = prompts[type] || prompts.post;
    const content = await azure.generateContent(prompt);
    res.json({ content, topic, type });
  } catch (e) {
    log('error', 'Content generate failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Research ─────────────────────────────────────────────

app.post('/content/research', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const query = (req.body.query || 'AI tech').trim();
    const results = [];
    const nr = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&apiKey=${config.freenews.key}&pageSize=5`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (nr.ok) {
      const nd = await nr.json();
      if (nd?.articles) {
        results.push(...nd.articles.slice(0, 5).map(a => ({
          title: a.title, url: a.url, source: 'news', summary: a.description,
        })));
      }
    }
    const wr = await fetch(
      `https://s.jina.ai/${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${config.jina.key}` }, signal: AbortSignal.timeout(30000) }
    );
    const wt = wr.ok ? await wr.text() : '';
    const summary = await azure.generateContent(
      `Summarize: ${wt.slice(0, 3000)}`, { maxTokens: 500 }
    );
    results.push({ title: 'Web Research', summary, source: 'web' });
    const db = require(path.join(__dirname, '..', '..', 'shared', 'db'));
    if (results.length) await db.saveTrending(results.filter(r => r.title));
    res.json({ results });
  } catch (e) {
    log('error', 'Research failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Startup ──────────────────────────────────────────────

async function start() {
  await redis.connect();
  setInterval(() => redis.heartbeat('content'), 60000);
  app.listen(PORT, '0.0.0.0', () => log('info', 'Content service started', { port: PORT }));
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
