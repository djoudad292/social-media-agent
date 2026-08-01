const https = require('https');
const crypto = require('crypto');
const config = require('./config');

const httpAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });

const TOKEN_BUDGET_LIMIT = parseInt(process.env.DAILY_TOKEN_BUDGET, 10) || 20000;

async function getDailyTokens() {
  try {
    const rc = r();
    if (!rc) return 0;
    const key = `token_budget:${new Date().toISOString().slice(0, 10)}`;
    const v = await rc.get(key);
    return parseInt(v, 10) || 0;
  } catch { return 0; }
}

async function addDailyTokens(count) {
  try {
    const rc = r();
    if (!rc) return;
    const key = `token_budget:${new Date().toISOString().slice(0, 10)}`;
    await rc.incrby(key, count);
    await rc.expire(key, 86400);
  } catch {}
}

function hashMessages(messages, maxTokens, model) {
  return crypto.createHash('md5').update(JSON.stringify({ messages, maxTokens, model })).digest('hex');
}

function r() {
  try { return require('./redis').getRedis(); } catch { return null; }
}

async function getCached(key) {
  try {
    const rc = r();
    if (!rc) return null;
    const cached = await rc.get(`gpt:cache:${key}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.expires > Date.now()) return parsed.content;
    }
  } catch {}
  return null;
}

async function setCache(key, content, tokens) {
  try {
    const rc = r();
    if (!rc) return;
    await rc.set(`gpt:cache:${key}`, JSON.stringify({ content, tokens, expires: Date.now() + 3600000 * 24 }), 'EX', 86400);
  } catch {}
}

function azureChatCompletion(messages, options = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = config.azure.apiKey;
    if (!apiKey) return reject(new Error('AZURE_OPENAI_API_KEY not set'));
    const endpoint = config.azure.endpoint || 'https://openclaw-ai2-5c86d.openai.azure.com';
    const model = options.model || config.azure.gpt5Mini || 'gpt-5-mini';
    const apiVersion = config.azure.apiVersion || '2025-01-01-preview';
    const maxTokens = parseInt(options.maxTokens, 10) || 1500;

    const url = new URL(
      `${endpoint}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`
    );
    const body = JSON.stringify({
      messages,
      max_completion_tokens: maxTokens,
      stream: false,
      reasoning_effort: options.reasoningEffort || 'low',
    });
    const req = https.request(url, {
      method: 'POST',
      agent: httpAgent,
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) {
            reject(new Error(`Azure API error: ${p.error.message}`));
            return;
          }
          const content = p.choices?.[0]?.message?.content;
          resolve(content || '');
        } catch (e) {
          reject(new Error(`Azure parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Azure timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function generateContent(prompt, options = {}) {
  const messages = [
    {
      role: 'system',
      content: options.systemPrompt ||
        'You are a tech social media manager. Write concise, engaging posts without filler.',
    },
    { role: 'user', content: String(prompt) },
  ];
  const cacheKey = hashMessages(messages, options.maxTokens, options.model);
  try {
    const cached = await getCached(cacheKey);
    if (cached) {
      console.log('[azure] cache hit for', cacheKey.slice(0, 8));
      return cached;
    }
  } catch {}
  const used = await getDailyTokens();
  if (used >= TOKEN_BUDGET_LIMIT) {
    console.warn('[azure] Daily token budget exceeded', { used, limit: TOKEN_BUDGET_LIMIT });
    return '';
  }
  try {
    const content = await azureChatCompletion(messages, options);
    if (!content) return '';
    const tokensEstimate = (JSON.stringify(messages).length + (content || '').length) / 4;
    addDailyTokens(Math.round(tokensEstimate));
    setCache(cacheKey, content, Math.round(tokensEstimate));
    return content;
  } catch (e) {
    console.error('[azure] generateContent failed:', e.message);
    return '';
  }
}

module.exports = { azureChatCompletion, generateContent, getDailyTokens, TOKEN_BUDGET_LIMIT };
