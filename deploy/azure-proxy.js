const http = require('http');
const https = require('https');

const AZURE_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';

if (!AZURE_KEY || !AZURE_ENDPOINT) {
  console.error('Missing AZURE_OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT');
  process.exit(1);
}

const PORT = parseInt(process.env.PROXY_PORT || '8787');

function stripModel(obj) {
  const { model, ...rest } = obj;
  return rest;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    return sendJson(res, 404, { error: { message: 'Not found', type: 'proxy_error' } });
  }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const model = body.model || 'gpt-5-mini';

      if (body.stream) {
        return sendJson(res, 400, { error: { message: 'Streaming not supported by Azure proxy', type: 'proxy_error' } });
      }

      const parsed = new URL(
        `${AZURE_ENDPOINT}/openai/deployments/${model}/chat/completions?api-version=${API_VERSION}`
      );

      const azureBody = {
        ...stripModel(body),
        max_completion_tokens: body.max_completion_tokens || body.max_tokens || 1024,
        temperature: body.temperature ?? 0.7,
        stream: false,
      };
      delete azureBody.max_tokens;

      const { status, data } = await new Promise((resolve, reject) => {
        const opts = {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: { 'api-key': AZURE_KEY, 'Content-Type': 'application/json' },
          timeout: 60000,
        };
        const r = https.request(opts, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve({ status: r.statusCode, data: d }));
        });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('Azure timeout')); });
        r.write(JSON.stringify(azureBody));
        r.end();
      });

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      sendJson(res, 502, { error: { message: `Azure proxy error: ${e.message}`, type: 'proxy_error' } });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Azure proxy listening on 0.0.0.0:${PORT}`);
});
