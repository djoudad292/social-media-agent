const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '50mb' }));

const config = require(path.join(__dirname, '..', '..', 'shared', 'config'));
const redis = require(path.join(__dirname, '..', '..', 'shared', 'redis'));
const azure = require(path.join(__dirname, '..', '..', 'shared', 'azure-proxy'));

const PORT = config.port.media;
const TMP = '/tmp/agent-media';

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function log(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, service: 'media', msg, ...meta };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ── Helpers ──────────────────────────────────────────────

function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: opts.timeout || 120000, maxBuffer: 50 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(err.message));
        else resolve(stdout || stderr || '');
      }
    );
  });
}

function cleanup(files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

// ── Auth ─────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true, service: 'media', ts: new Date().toISOString() }));

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const t = req.headers['x-agent-token'];
  if (config.gatewayToken && t !== config.gatewayToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Reel generation ──────────────────────────────────────

app.post('/media/reel', async (req, res) => {
  const filesToClean = [];
  try {
    const { script, topic } = req.body;
    if (!script) return res.status(400).json({ error: 'Script required' });
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const kw = topic || script.slice(0, 50);

    const pr = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(kw)}&per_page=2&orientation=portrait`,
      { headers: { Authorization: config.pexels.key }, signal: AbortSignal.timeout(15000) }
    );
    const pd = await pr.json();
    const clips = [];
    if (pd?.videos?.length) {
      for (let i = 0; i < Math.min(pd.videos.length, 2); i++) {
        const vf = pd.videos[i].video_files.find(f => f.quality === 'hd')
          || pd.videos[i].video_files[0];
        if (vf?.link) {
          const cp = `${TMP}/clip${i}.mp4`;
          try {
            await execAsync(`curl -s -L "${vf.link}" -o ${cp}`, { timeout: 30000 });
            clips.push(cp);
            filesToClean.push(cp);
          } catch (e) {
            log('error', 'Clip download failed', { error: e.message });
          }
        }
      }
    }

    const ttsPath = `${TMP}/voiceover.mp3`;
    filesToClean.push(ttsPath);
    const esc = script
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='en-US-JennyNeural'>${esc}</voice></speak>`;
    const ttsRes = await fetch(
      `https://${config.speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': config.speech.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: ssml,
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!ttsRes.ok) throw new Error(`TTS API returned ${ttsRes.status}`);
    const ttsBuffer = Buffer.from(await ttsRes.arrayBuffer());
    fs.writeFileSync(ttsPath, ttsBuffer);

    const musicPath = `${TMP}/music.wav`;
    filesToClean.push(musicPath);
    try {
      await execAsync(`sox -n ${musicPath} synth 15 sine 440 vol 0.1`, { timeout: 10000 });
    } catch (e) {
      log('error', 'Music gen failed', { error: e.message });
      fs.writeFileSync(musicPath, '');
    }

    const out = `${TMP}/reel_final.mp4`;
    filesToClean.push(out);
    const clipSrc = clips.length > 0 ? `-i ${clips[0]}` : '-f lavfi -i color=c=black:s=1080x1920:d=15';
    await execAsync(
      `ffmpeg ${clipSrc} -i ${ttsPath} -i ${musicPath} ` +
      `-filter_complex "[0:v]crop=ih*9/16:ih,scale=1080:1920[v];[1:a][2:a]amix=inputs=2:duration=first[a]" ` +
      `-map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -threads 1 -t 15 ${out} -y`,
      { timeout: 120000 }
    );

    if (!fs.existsSync(out)) throw new Error('FFmpeg output not found');

    const db = require(path.join(__dirname, '..', '..', 'shared', 'db'));
    const vb = fs.readFileSync(out);
    const fn = `reels/${Date.now()}.mp4`;
    const publicUrl = await db.uploadToSupabase('media', fn, vb, 'video/mp4');

    cleanup(filesToClean);

    res.json({ video_url: publicUrl, duration: 15 });
  } catch (e) {
    log('error', 'Reel generation failed', { error: e.message });
    cleanup(filesToClean);
    res.status(500).json({ error: e.message });
  }
});

// ── TTS (standalone) ─────────────────────────────────────

app.post('/media/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const vn = voice || 'en-US-JennyNeural';
    const esc = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${vn}'>${esc}</voice></speak>`;
    const r = await fetch(
      `https://${config.speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': config.speech.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: ssml,
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!r.ok) throw new Error(`TTS API returned ${r.status}`);
    const db = require(path.join(__dirname, '..', '..', 'shared', 'db'));
    const fn = `tts/${Date.now()}.mp3`;
    const b = Buffer.from(await r.arrayBuffer());
    const publicUrl = await db.uploadToSupabase('media', fn, b, 'audio/mpeg');
    res.json({ audio_url: publicUrl, voice: vn });
  } catch (e) {
    log('error', 'TTS failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Startup ──────────────────────────────────────────────

async function start() {
  await redis.connect();
  setInterval(() => redis.heartbeat('media'), 60000);
  app.listen(PORT, '0.0.0.0', () => log('info', 'Media service started', { port: PORT }));
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
