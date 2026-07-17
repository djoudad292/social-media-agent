const https = require('https');
const config = require('./config');

const httpAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });

function azureChatCompletion(messages, options = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = config.azure.apiKey;
    if (!apiKey) return reject(new Error('AZURE_OPENAI_API_KEY not set'));
    const endpoint = config.azure.endpoint || 'https://openclaw-ai2-5c86d.openai.azure.com';
    const model = options.model || config.azure.gpt5Mini || 'gpt-5-mini';
    const apiVersion = config.azure.apiVersion || '2025-01-01-preview';
    const maxTokens = parseInt(options.maxTokens, 10) || 1024;

    const url = new URL(
      `${endpoint}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`
    );
    const body = JSON.stringify({
      messages,
      max_completion_tokens: maxTokens,
      stream: false,
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
  try {
    const content = await azureChatCompletion([
      {
        role: 'system',
        content: options.systemPrompt ||
          'You are a tech social media manager. Write concise, engaging posts without filler.',
      },
      { role: 'user', content: String(prompt) },
    ], options);
    return content || '';
  } catch (e) {
    console.error('[azure] generateContent failed:', e.message);
    return '';
  }
}

module.exports = { azureChatCompletion, generateContent };
