const https = require('https');
const config = require('./config');

function azureChatCompletion(messages, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${config.azure.endpoint}/openai/deployments/${options.model || config.azure.gpt5Mini}/chat/completions?api-version=${config.azure.apiVersion}`);
    const body = JSON.stringify({ messages, max_tokens: options.maxTokens || 1024, temperature: options.temperature ?? 0.7, stream: false });
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': config.azure.apiKey, 'Content-Length': Buffer.byteLength(body) }, timeout: 120000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { const p = JSON.parse(data); if (p.error) reject(new Error(p.error.message)); else resolve(p.choices[0].message.content); } catch (e) { reject(new Error(`Azure error: ${e.message}`)); } });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body); req.end();
  });
}

async function generateContent(prompt, options = {}) {
  return azureChatCompletion([
    { role: 'system', content: options.systemPrompt || 'You are a tech social media manager. Write concise, engaging posts without filler.' },
    { role: 'user', content: prompt },
  ], options);
}

module.exports = { azureChatCompletion, generateContent };
