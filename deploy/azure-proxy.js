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

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    return sendJson(res, 200, { ok: true, status: 'proxy-live' });
  }
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    return sendJson(res, 404, { error: { message: 'Not found', type: 'proxy_error' } });
  }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const model = body.model || 'gpt-5-mini';

      const parsed = new URL(
        `${AZURE_ENDPOINT}/openai/deployments/${model}/chat/completions?api-version=${API_VERSION}`
      );

      const azureBody = {
        messages: body.messages,
        max_completion_tokens: body.max_completion_tokens || body.max_tokens || 1024,
        stream: !!body.stream,
      };
      if (body.temperature !== undefined) {
        azureBody.temperature = body.temperature;
      }
      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'api-key': AZURE_KEY, 'Content-Type': 'application/json' },
        timeout: 120000,
      };

      const startTime = Date.now();
      const r = https.request(opts, azureRes => {
        if (body.stream) {
          res.writeHead(azureRes.statusCode, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          azureRes.pipe(res);
          azureRes.on('end', () => {
            console.log('PROXY: stream finished model=' + model + ' time=' + (Date.now() - startTime) + 'ms');
          });
        } else {
          let d = '';
          azureRes.on('data', c => d += c);
          azureRes.on('end', () => {
            console.log('PROXY: Azure responded status=' + azureRes.statusCode + ' model=' + model + ' time=' + (Date.now() - startTime) + 'ms');
            res.writeHead(azureRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(d);
          });
        }
      });
      r.on('error', e => {
        console.error('PROXY: request error', e.message);
        sendJson(res, 502, { error: { message: 'Azure proxy error: ' + e.message, type: 'proxy_error' } });
      });
      r.on('timeout', () => {
        r.destroy();
        console.error('PROXY: timeout model=' + model);
        sendJson(res, 504, { error: { message: 'Azure timeout', type: 'proxy_error' } });
      });
      r.write(JSON.stringify(azureBody));
      r.end();
    } catch (e) {
      console.error('PROXY: parse error', e.message);
      sendJson(res, 502, { error: { message: 'Azure proxy error: ' + e.message, type: 'proxy_error' } });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Azure proxy listening on 0.0.0.0:' + PORT);
});
