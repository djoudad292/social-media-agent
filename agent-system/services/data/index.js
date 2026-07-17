const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { exec } = require('child_process');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const app = express();

const TMP = '/tmp/agent-data';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

app.use(express.json({ limit: '10mb' }));

const config = require(path.join(__dirname, '..', '..', 'shared', 'config'));
const db = require(path.join(__dirname, '..', '..', 'shared', 'db'));
const redis = require(path.join(__dirname, '..', '..', 'shared', 'redis'));
const azure = require(path.join(__dirname, '..', '..', 'shared', 'azure-proxy'));

const PORT = config.port.data;
const APP_NAME = 'data';

// ── Helpers ──────────────────────────────────────────────

const httpAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

function safeStr(v, d = '') {
  if (v === null || v === undefined) return d;
  if (typeof v === 'string') return v || d;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.join(', ');
  return d;
}

function truncate(str, max) {
  if (!str || typeof str !== 'string') return '';
  return str.length <= max ? str : str.slice(0, max);
}

function generateRequestId() {
  return crypto.randomBytes(4).toString('hex');
}

function log(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, service: APP_NAME, msg, ...meta };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ── Facebook rate limiter ─────────────────────────────────

const fbRateLimit = {
  tokens: 50,
  refillRate: 1,
  refillInterval: 1000,
  lastRefill: Date.now(),

  async acquire() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(50, this.tokens + Math.floor(elapsed / this.refillInterval) * this.refillRate);
    this.lastRefill = now;
    if (this.tokens <= 0) {
      const wait = this.refillInterval;
      log('warn', 'Facebook rate limit hit, waiting', { wait });
      await new Promise(r => setTimeout(r, wait));
      return this.acquire();
    }
    this.tokens--;
    return true;
  }
};

// ── TTS + Reel composition helpers ────────────────────────

function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: opts.timeout || 30000, maxBuffer: 50 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(err.message));
        else resolve(stdout || stderr || '');
      }
    );
  });
}

async function generateReelScript(topic, caption) {
  const prompt =
    `You are a voiceover scriptwriter for a short tech reel. ` +
    `Write a SHORT conversational speech (max 4 short sentences) about: ${topic}. ` +
    `Rules:\n` +
    `- Engaging, energetic, like a TikTok voiceover\n` +
    `- Each sentence ends with "..." to add a dramatic pause\n` +
    `- Maximum 80 words total\n` +
    `- Ask a question or give a surprising fact to hook viewers\n` +
    `- Do NOT use hashtags\n` +
    `- Do NOT repeat this caption word-for-word: "${caption}"\n` +
    `- Speak directly to the viewer (use "you")\n` +
    `\n` +
    `Example format:\n` +
    `Did you know AI can now run entirely on your phone? ... ` +
    `No cloud, no internet, just pure on-device power. ... ` +
    `Sounds futuristic? ... It is already here.`;
  let script = caption.length > 10 ? `${caption.slice(0, 60)}... like and follow!` : `Check this out... ${topic}... mind blown.`;
  try {
    const gen = await azure.generateContent(prompt, { maxTokens: 500 });
    if (gen && gen.length > 10) script = gen;
  } catch (e) {
    log('warn', 'Script gen failed, using default', { error: e.message });
  }
  return script;
}

function scriptToSegments(script) {
  return script.split(/\.\.\./g).map(s => s.trim()).filter(Boolean);
}

async function generateTTSWithPauses(script) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  if (!config.speech.key) throw new Error('AZURE_SPEECH_KEY not configured');
  const segments = scriptToSegments(script);
  if (segments.length === 0) throw new Error('No speech segments');
  let ssmlBody = '';
  for (let i = 0; i < segments.length; i++) {
    const esc = segments[i]
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    ssmlBody += `<prosody rate='+5%'>${esc}</prosody>`;
    if (i < segments.length - 1) ssmlBody += `<break time='600ms'/>`;
  }
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='en-US-JennyNeural'>${ssmlBody}</voice></speak>`;
  const res = await fetch(
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
  if (!res.ok) throw new Error(`TTS API returned ${res.status}`);
  const audioBuffer = Buffer.from(await res.arrayBuffer());
  return { audioBuffer, segments };
}

async function getAudioDuration(audioPath) {
  const out = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${audioPath}`,
    { timeout: 10000 }
  );
  return parseFloat(out.trim()) || 0;
}

async function generateSRT(segments, totalDuration) {
  if (segments.length === 0 || totalDuration <= 0) return '';
  const totalChars = segments.reduce((s, seg) => s + seg.length, 0);
  const minSegmentDuration = 1.5;
  const maxSegmentDuration = 8;
  let entries = [];
  let currentTime = 0;
  for (let i = 0; i < segments.length; i++) {
    const ratio = totalChars > 0 ? segments[i].length / totalChars : 1 / segments.length;
    let segDuration = Math.min(maxSegmentDuration, Math.max(minSegmentDuration, totalDuration * ratio));
    if (i === segments.length - 1) segDuration = Math.max(segDuration, totalDuration - currentTime);
    const start = currentTime;
    const end = Math.min(currentTime + segDuration, totalDuration);
    if (end > start) {
      entries.push({ index: i + 1, start, end, text: segments[i] });
    }
    currentTime = end;
  }
  return entries.map(e => {
    const s = fmtTime(e.start);
    const en = fmtTime(e.end);
    const t = e.text.length > 70 ? e.text.slice(0, 67) + '...' : e.text;
    return `${e.index}\n${s} --> ${en}\n${t}\n`;
  }).join('\n');

  function fmtTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const ms = Math.floor((s - Math.floor(s)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(Math.floor(s))},${pad(ms, 3)}`;
  }
  function pad(n, w = 2) { return String(n).padStart(w, '0'); }
}

async function searchBackgroundMusic(topic) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  if (!config.pixabay.key) {
    log('warn', 'No Pixabay key, skipping background music');
    return null;
  }
  const words = topic.split(' ').slice(0, 2).map(w => encodeURIComponent(w)).join('+');
  const musicQueries = [
    words.length > 3 ? `upbeat+${words}` : '',
    'upbeat+technology+background',
    'corporate+ambient+music',
    'inspiring+background+music',
  ].filter(Boolean);
  for (const q of musicQueries) {
    try {
      const res = await fetch(
        `https://pixabay.com/api/videos/?key=${config.pixabay.key}&q=${q}&video_type=film&per_page=5`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const hits = data?.hits || [];
      const hit = hits.find(h => h.duration >= 10 && h.duration <= 40) || hits[0];
      if (!hit) continue;
      const vf = hit.videos?.medium || hit.videos?.small;
      if (!vf?.url) continue;
      const vr = await fetch(vf.url, { signal: AbortSignal.timeout(20000) });
      if (!vr.ok) continue;
      const rawBuf = Buffer.from(await vr.arrayBuffer());
      const musicVideoPath = `${TMP}/music_${Date.now()}.mp4`;
      const musicAudioPath = `${TMP}/music_${Date.now()}.mp3`;
      try {
        fs.writeFileSync(musicVideoPath, rawBuf);
        try {
          await execAsync(
            `ffmpeg -i ${musicVideoPath} -vn -c:a libmp3lame -q:a 8 ${musicAudioPath}`,
            { timeout: 15000 }
          );
        } catch {
          await execAsync(
            `ffmpeg -i ${musicVideoPath} -vn -c:a copy ${musicAudioPath}`,
            { timeout: 15000 }
          );
        }
        const audioStat = fs.statSync(musicAudioPath);
        if (!audioStat || audioStat.size < 2000) {
          log('warn', 'Extracted audio too small, skipping', { query: q, size: audioStat?.size });
          continue;
        }
        const durOut = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${musicAudioPath}`,
          { timeout: 5000 }
        );
        const audioDur = parseFloat(durOut.trim()) || 0;
        if (audioDur < 2) {
          log('warn', 'Extracted audio too short, skipping', { query: q, duration: audioDur });
          continue;
        }
        const audioBuf = fs.readFileSync(musicAudioPath);
        log('info', 'Background music fetched', { query: q, duration: hit.duration, audioDuration: audioDur, tags: hit.tags });
        return audioBuf;
      } finally {
        try { fs.unlinkSync(musicVideoPath); } catch {}
        try { fs.unlinkSync(musicAudioPath); } catch {}
      }
    } catch (e) {
      log('warn', 'Music search query failed', { query: q, error: e.message });
    }
  }
  log('warn', 'No background music found from any query');
  return null;
}

function findHookText(script) {
  if (!script || script.length < 5) return '';
  const sentences = script.split(/\.\.\./g).map(s => s.trim()).filter(Boolean);
  const first = sentences[0] || script;
  const clean = first
    .replace(/^(Did you know|Have you heard|Imagine|Think about|What if|Here.s why|The truth is)[,\s]*/i, '')
    .replace(/[.!?]$/, '')
    .trim();
  if (clean.length < 5 || clean.length > 60) return '';
  return clean;
}

async function composeReelFull(videoBuffers, voiceoverBuffer, musicBuffer, hookText) {
  if (!Array.isArray(videoBuffers)) videoBuffers = [videoBuffers];
  if (videoBuffers.length === 0) throw new Error('No video buffers');
  const now = Date.now();
  const clipPaths = videoBuffers.map((buf, i) => {
    const p = `${TMP}/clip_${now}_${i}.mp4`;
    fs.writeFileSync(p, buf);
    return p;
  });
  const voicePath = `${TMP}/voice_${now}.mp3`;
  fs.writeFileSync(voicePath, voiceoverBuffer);
  const musicPath = (musicBuffer && musicBuffer.length > 1000)
    ? (() => { const p = `${TMP}/music_${now}.mp3`; fs.writeFileSync(p, musicBuffer); return p; })()
    : null;
  const outputPath = `${TMP}/reel_${now}_out.mp4`;

  try {
    const hasMultipleClips = clipPaths.length >= 2;
    const hasMusic = !!musicPath;
    const hasHook = !!hookText && hookText.length >= 3;

    if (!hasHook && !hasMultipleClips) {
      // Simple path: voiceover only, no hook, single clip → -c:v copy
      let cmd;
      if (hasMusic) {
        cmd =
          `ffmpeg -i ${clipPaths[0]} -i ${voicePath} -stream_loop -1 -i ${musicPath} ` +
          `-filter_complex "[1:a]volume=1.0[a1];[2:a]volume=0.12[a2];[a1][a2]amix=inputs=2:duration=first[audio]" ` +
          `-c:v copy -map 0:v -map "[audio]" -shortest -movflags +faststart -y ${outputPath}`;
      } else {
        cmd =
          `ffmpeg -i ${clipPaths[0]} -i ${voicePath} -c:v copy -c:a aac ` +
          `-map 0:v:0 -map 1:a:0 -shortest -movflags +faststart -y ${outputPath}`;
      }
      await execAsync(cmd, { timeout: 120000 });
      return fs.readFileSync(outputPath);
    }

    // Complex path: hook text and/or multi-clip → needs re-encode
    const inputs = clipPaths.map(p => `-i ${p}`).join(' ');
    // safe hook text: alphanumeric + common punctuation (no quotes to avoid shell escaping)
    const safeHook = hookText.replace(/[^a-zA-Z0-9 .,!?-]/g, '').substring(0, 55);
    const voiceIdx = clipPaths.length;
    const musicIdx = clipPaths.length + 1;

    let vFilter = '';
    if (hasMultipleClips) {
      if (hasHook) {
        vFilter = `[0:v]drawtext=text='${safeHook}':enable='between(t,0,3)':fontfile=/usr/share/fonts/dejavu/DejaVuSans.ttf:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8:x=(w-text_w)/2:y=h*0.15[v0];[v0][1:v]xfade=offset=4.5:duration=0.5:transition=fade[video]`;
      } else {
        vFilter = `[0:v]trim=0:4.5,setpts=PTS-STARTPTS[v0];[1:v]trim=0:15,setpts=PTS-STARTPTS[v1];[v0][v1]xfade=offset=4.5:duration=0.5:transition=fade,setpts=PTS-STARTPTS[video]`;
      }
    } else {
      vFilter = `[0:v]drawtext=text='${safeHook}':enable='between(t,0,3)':fontfile=/usr/share/fonts/dejavu/DejaVuSans.ttf:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8:x=(w-text_w)/2:y=h*0.15[video]`;
    }

    if (hasMusic) {
      const aFilter = `[${voiceIdx}:a]volume=1.0[a1];[${musicIdx}:a]volume=0.12,aloop=loop=-1:size=0[a2];[a1][a2]amix=inputs=2:duration=first[audio]`;
      const cmd =
        `ffmpeg ${inputs} -i ${voicePath} -i ${musicPath} ` +
        `-filter_complex "${vFilter};${aFilter}" ` +
        `-map "[video]" -map "[audio]" ` +
        `-c:v libx264 -preset ultrafast -crf 28 -c:a aac ` +
        `-shortest -movflags +faststart -y ${outputPath}`;
      await execAsync(cmd, { timeout: 180000 });
    } else {
      // No music: video through filter, audio mapped directly
      const cmd =
        `ffmpeg ${inputs} -i ${voicePath} ` +
        `-filter_complex "${vFilter}" ` +
        `-map "[video]" -map ${voiceIdx}:a ` +
        `-c:v libx264 -preset ultrafast -crf 28 -c:a aac ` +
        `-shortest -movflags +faststart -y ${outputPath}`;
      await execAsync(cmd, { timeout: 180000 });
    }
    return fs.readFileSync(outputPath);

    await execAsync(cmd, { timeout: 180000 });
    return fs.readFileSync(outputPath);
  } finally {
    for (const p of clipPaths) try { fs.unlinkSync(p); } catch {}
    try { fs.unlinkSync(voicePath); } catch {}
    if (musicPath) try { fs.unlinkSync(musicPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

// ── Facebook API ─────────────────────────────────────────

function fbRequest(endpoint, body) {
  return new Promise((resolve) => {
    const b = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const u = new URL(`https://graph.facebook.com/v21.0${endpoint}`);
    const req = https.request(u, {
      method: 'POST',
      agent: httpAgent,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(b),
      },
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          let parsed;
          try { parsed = JSON.parse(d); } catch { parsed = { raw: d }; }
          resolve({ httpStatus: res.statusCode, error: parsed.error?.message || parsed.error || d });
          return;
        }
        if (!d.trim()) {
          resolve({ httpStatus: res.statusCode, error: 'empty response' });
          return;
        }
        try { resolve(JSON.parse(d)); }
        catch (e) { resolve({ parseError: e.message, raw: d }); }
      });
    });
    req.on('error', e => resolve({ netError: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ timeout: true }); });
    req.write(b);
    req.end();
  });
}

async function fbFeedPost(message) {
  await fbRateLimit.acquire();
  return fbRequest('/me/feed', {
    access_token: config.facebook.accessToken || '',
    message: truncate(message, 5000),
  });
}

async function fbVideoPost(fileUrl, description) {
  await fbRateLimit.acquire();
  return fbRequest('/me/videos', {
    access_token: config.facebook.accessToken || '',
    file_url: fileUrl,
    description: truncate(description, 5000),
  });
}

function getISOWeeks(now = new Date()) {
  const d = new Date(now);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const firstThursday = d.valueOf();
  d.setMonth(0, 1);
  if (d.getDay() !== 4) {
    d.setMonth(0, 1 + ((4 - d.getDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.ceil((firstThursday - d) / 604800000);
  return `${now.getFullYear()}-W${String(Math.min(weekNum, 53)).padStart(2, '0')}`;
}

// ── Auth middleware ──────────────────────────────────────

const PUBLIC_PATHS = new Set([
  '/health', '/debug/fb',
  '/api/telegram/webhook', '/api/telegram/webhook-info',
  '/api/telegram/set-webhook',
]);

app.use((req, res, next) => {
  req.id = generateRequestId();
  if (PUBLIC_PATHS.has(req.path)) return next();
  const t = req.headers['x-agent-token'];
  if (config.gatewayToken && t !== config.gatewayToken) {
    log('warn', 'Unauthorized request', { path: req.path, rid: req.id });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Health ───────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true, service: 'data', ts: new Date().toISOString() }));

// ── Debug ────────────────────────────────────────────────

app.get('/debug/fb', async (req, res) => {
  try {
    const t = config.facebook.accessToken || '';
    const [me, permCheck] = await Promise.all([
      fbRequest('/me', { access_token: t }),
      fbRequest('/me/permissions', { access_token: t }),
    ]);
    const igCheck = await fbRequest('/me/accounts', {
      access_token: t,
      fields: 'id,name,instagram_business_account{id,username,profile_pic}',
    });
    const targetPage = (igCheck?.data || []).find(p => p.id === config.facebook.pageId);
    const igAccount = targetPage?.instagram_business_account || null;
    const granted = (permCheck?.data || []).filter(p => p.status === 'granted').map(p => p.permission);
    res.json({
      tokenLength: t.length,
      tokenEnd: t.slice(-10),
      fbTest: me,
      instagram: {
        linked: !!igAccount,
        account: igAccount,
        targetPage: targetPage || null,
        allPages: (igCheck?.data || []).map(p => ({
          id: p.id, name: p.name,
          ig: p.instagram_business_account?.username || null,
        })),
      },
      permissions: granted,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ── Data routes ──────────────────────────────────────────

app.post('/data/scrape', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const trends = [];
    const rr = await fetch(
      'https://www.reddit.com/r/technology/hot.json?limit=10',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }
    );
    if (rr.ok) {
      try {
        const rd = await rr.json();
        if (rd?.data?.children) {
          rd.data.children.forEach(c => {
            const d = c.data;
            trends.push({
              source: 'reddit', title: d.title,
              url: `https://reddit.com${d.permalink}`,
              score: d.score,
              summary: truncate(d.selftext || '', 300),
            });
          });
        }
      } catch (e) {
        log('error', 'Reddit parse failed', { error: e.message, rid: req.id });
      }
    }

    const hr = await fetch(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      { signal: AbortSignal.timeout(10000) }
    );
    let ids = [];
    try { if (hr.ok) ids = await hr.json(); } catch (e) {
      log('error', 'HN fetch failed', { error: e.message, rid: req.id });
    }
    for (const id of ids.slice(0, 10)) {
      try {
        const ir = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!ir.ok) continue;
        const it = await ir.json();
        if (it?.title) {
          trends.push({
            source: 'hackernews', title: it.title,
            url: it.url || `https://news.ycombinator.com/item?id=${id}`,
            score: it.score, summary: '',
          });
        }
      } catch (e) {
        log('error', 'HN item fetch failed', { id, error: e.message, rid: req.id });
      }
    }

    if (trends.length) await db.saveTrending(trends);
    res.json({ trends_count: trends.length, trends });
  } catch (e) {
    log('error', 'Scrape failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/data/analytics', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const token = config.facebook.accessToken || '';
    if (!token) return res.status(400).json({ error: 'Facebook token not configured' });
    const url = `https://graph.facebook.com/v21.0/${config.facebook.pageId}/insights` +
      `?metric=page_impressions,page_engaged_users,page_fans` +
      `&period=days_28&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (d?.data) {
      const a = { date: new Date().toISOString().split('T')[0], raw_data: d };
      d.data.forEach(i => {
        const v = i.values?.[0]?.value || 0;
        if (i.name === 'page_impressions') a.impressions = v;
        if (i.name === 'page_engaged_users') a.engaged_users = v;
        if (i.name === 'page_fans') a.followers = v;
      });
      await db.saveAnalytics(a);
      res.json(a);
    } else {
      res.status(500).json({ error: 'Facebook API error', raw: d });
    }
  } catch (e) {
    log('error', 'Analytics failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/data/leads/hunt', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const q = truncate(safeStr(req.body.niche, 'startups hiring AI developers 2026'), 200);
    const wr = await fetch(`https://s.jina.ai/${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${config.jina.key}` }, signal: AbortSignal.timeout(30000),
    });
    const wt = await wr.text();
    const lt = await azure.generateContent(
      `Extract up to 5 leads from this. JSON array: company, need, contact, email, source_url.\n${truncate(wt, 4000)}`,
      { maxTokens: 1000, temperature: 0.3 }
    );
    let leads = [];
    try {
      const m = lt.match(/\[[\s\S]*?\]/);
      if (m) leads = JSON.parse(m[0]);
    } catch (e) {
      log('error', 'Lead parse failed', { error: e.message, rid: req.id });
    }
    const saved = [];
    for (const l of leads.slice(0, 5)) {
      try {
        saved.push(await db.saveLead({
          company: l.company || 'Unknown',
          contact: l.contact || l.company,
          email: l.email || '',
          score: 0.5, source: 'web',
          notes: l.need || '', status: 'new',
        }));
      } catch (e) {
        log('error', 'Lead save failed', { error: e.message, rid: req.id });
      }
    }
    res.json({ leads: saved.length ? saved : leads });
  } catch (e) {
    log('error', 'Lead hunt failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/data/strategy', async (req, res) => {
  try {
    const week = safeStr(req.body.week) || getISOWeeks();
    const pt = await azure.generateContent(
      'Create a 7-day content plan for tech page "djaouad tech".' +
      ' Mix: 40% educational, 20% engaging, 20% social proof,' +
      ' 10% promotional, 10% personal.' +
      ' JSON array: day, type(post/reel/challenge), topic, description.',
      { maxTokens: 1500 }
    );
    let plan = [];
    try {
      const m = pt.match(/\[[\s\S]*?\]/s);
      if (m) plan = JSON.parse(m[0]);
    } catch (e) {
      log('error', 'Strategy parse failed', { error: e.message, rid: req.id });
      plan = [{ raw: pt }];
    }
    await db.saveStrategy(week, plan);
    res.json({ week, plan });
  } catch (e) {
    log('error', 'Strategy gen failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.get('/data/memory/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 1000);
    const days = parseInt(req.query.days, 10) || 0;
    const handlers = {
      posts: () => days > 0 ? db.getRecentPosts(days) : db.getPosts(limit),
      analytics: () => db.getAnalytics(days || 28),
      trending: () => db.getLatestTrends(limit),
      pause: () => db.getPauseState(),
    };
    if (handlers[type]) {
      res.json(await handlers[type]());
    } else {
      res.status(400).json({ error: 'Unknown type' });
    }
  } catch (e) {
    log('error', 'Memory fetch failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

// ── Content generation (bypass content service) ──────────

app.post('/api/content/generate', async (req, res) => {
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
    log('error', 'Content generate failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/content/research', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const query = truncate(safeStr(req.body.query, 'AI tech'), 200);
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
      `Summarize: ${truncate(wt, 3000)}`, { maxTokens: 500 }
    );
    results.push({ title: 'Web Research', summary, source: 'web' });
    if (results.length) await db.saveTrending(results.filter(r => r.title));
    res.json({ results });
  } catch (e) {
    log('error', 'Research failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/content/write', async (req, res) => {
  try {
    const { prompt, systemPrompt, maxTokens } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const mt = Math.max(50, Math.min(parseInt(maxTokens, 10) || 1024, 16000));
    const content = await azure.generateContent(prompt, {
      systemPrompt: systemPrompt || 'Tech writer.',
      maxTokens: mt,
    });
    res.json({ content });
  } catch (e) {
    log('error', 'Write failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/content/researched', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const q = truncate(safeStr(req.body.query, 'trending AI technology 2026'), 200);
    const nr = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&apiKey=${config.freenews.key}&pageSize=5`,
      { signal: AbortSignal.timeout(15000) }
    );
    const nd = nr.ok ? await nr.json() : { articles: [] };
    const articles = (nd?.articles || []).slice(0, 5);
    const wr = await fetch(
      `https://s.jina.ai/${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${config.jina.key}` }, signal: AbortSignal.timeout(30000) }
    );
    const wt = wr.ok ? await wr.text() : '';
    const sources = [
      ...articles.map(a => `- ${safeStr(a.title)}: ${safeStr(a.description) || '(no summary)'}`),
      `- Web research: ${truncate(wt, 1000)}`,
    ].join('\n');
    const content = await azure.generateContent(
      `Write a genuine, evidence-based Facebook post about: ${q}\n\n` +
      `Use these real sources to write something substantive (200-400 words):\n${sources}\n\n` +
      `Include 3-5 relevant hashtags and end with a CTA. Focus on real examples, avoid hype.`,
      { systemPrompt: 'Tech writer. Evidence-based, conversational, no buzzwords.', maxTokens: 1200 }
    );
    res.json({
      content,
      sources: articles.map(a => ({ title: safeStr(a.title), url: safeStr(a.url) })),
    });
  } catch (e) {
    log('error', 'Researched write failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

// ── Facebook Thread ──────────────────────────────────────

app.post('/api/facebook/thread', async (req, res) => {
  try {
    const topic = truncate(safeStr(req.body.topic, 'AI tech trends'), 200);
    const count = Math.min(Math.max(parseInt(req.body.count, 10) || 3, 2), 5);
    const raw = await azure.generateContent(
      `Write ${count} connected Facebook posts about: ${topic}. ` +
      `Each post 2-4 sentences. First introduces the topic, last ends with CTA. ` +
      `They should read as a connected thread. Return as JSON array of strings.`,
      { systemPrompt: 'Tech writer. Thread specialist.', maxTokens: 1500 }
    );
    let posts = [];
    try {
      const m = raw.match(/\[[\s\S]*?\]/s);
      if (m) posts = JSON.parse(m[0]);
    } catch (e) {
      log('error', 'Thread parse failed', { error: e.message, rid: req.id });
    }
    if (!posts.length) {
      posts = raw.split(/\n\s*(?=\d+\/|\*\*?\d+)/)
        .filter(p => p.trim().length > 20)
        .slice(0, count);
    }
    const results = [];
    for (let i = 0; i < Math.min(posts.length, count); i++) {
      const msg = `${posts[i].trim()}\n\n${i + 1}/${Math.min(posts.length, count)}`;
      const fbRes = await fbFeedPost(msg);
      results.push({
        part: i + 1,
        id: fbRes.id || null,
        url: fbRes.id ? `https://facebook.com/${fbRes.id}` : null,
        error: fbRes.error || null,
      });
      if (i < posts.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
    try {
      if (results.some(r => r.id)) {
        await db.savePost({
          content: `Thread (${count} parts) about: ${topic}`,
          type: 'thread', status: 'posted',
          facebook_post_id: results[0].id,
        });
      }
    } catch (e) {
      log('error', 'Thread savePost failed', { error: e.message, rid: req.id });
    }
    res.json({
      success: results.some(r => r.id),
      count: results.length,
      results,
      posts,
    });
  } catch (e) {
    log('error', 'Thread failed', { error: e.message, rid: req.id });
    res.json({ error: e.message });
  }
});

// ── Facebook Post (direct) ───────────────────────────────

app.post('/data/facebook/post', async (req, res) => {
  try {
    const message = safeStr(req.body.message);
    if (!message) return res.status(400).json({ error: 'Message required' });
    const d = await fbFeedPost(message);
    if (d.id) {
      await db.savePost({
        content: message, type: 'post', status: 'posted',
        facebook_post_id: d.id,
      });
      res.json({ success: true, post_url: `https://facebook.com/${d.id}` });
    } else {
      res.status(500).json({ error: 'Facebook error', raw: d });
    }
  } catch (e) {
    log('error', 'Direct post failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

// ── Gateway proxy routes ─────────────────────────────────

async function getFetch() {
  return globalThis.fetch || (await import('node-fetch')).default;
}

async function proxyCall(u, b = null, m = 'GET') {
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

const proxyRoutes = {
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

for (const [route, [method, svc]] of Object.entries(proxyRoutes)) {
  const svcUrl = config.services[svc];
  if (method === 'POST') {
    app.post(`/api/${route}`, async (req, res) => {
      if (!svcUrl) return res.json({ error: `${svc} service not configured` });
      res.json(await proxyCall(`${svcUrl}/${route}`, req.body, 'POST'));
    });
  } else if (method === 'GET') {
    app.get(`/api/${route}`, async (req, res) => {
      if (!svcUrl) return res.json({ error: `${svc} service not configured` });
      const qs = new URLSearchParams(req.query).toString();
      res.json(await proxyCall(`${svcUrl}/${route}${qs ? '?' + qs : ''}`));
    });
  }
}

app.post('/api/facebook/post', async (req, res) => {
  try {
    const message = safeStr(req.body.message, 'test');
    const fbRes = await fbFeedPost(message);
    if (fbRes.id) {
      try {
        await db.savePost({
          content: message, type: 'post', status: 'posted',
          facebook_post_id: fbRes.id,
        });
      } catch (e) {
        log('error', 'savePost failed', { error: e.message, rid: req.id });
      }
      res.json({ success: true, post_url: `https://facebook.com/${fbRes.id}` });
    } else {
      res.status(500).json({ error: 'Facebook error', raw: fbRes });
    }
  } catch (e) {
    log('error', 'API facebook post failed', { error: e.message, rid: req.id });
    res.json({ error: e.message });
  }
});

// ── Telegram Bot ─────────────────────────────────────────

const tgBotToken = config.telegram.botToken || '';

function sanitizeMarkdown(text) {
  return (text || '')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/`/g, '\\`');
}

function tgApi(method, payload = {}) {
  return new Promise((resolve) => {
    if (!tgBotToken) return resolve({ ok: false, error: 'no bot token' });
    const body = JSON.stringify(payload);
    const u = new URL(`https://api.telegram.org/bot${tgBotToken}/${method}`);
    const req = https.request(u, {
      method: 'POST',
      agent: httpAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

function tgSendMessage(chatId, text) {
  const sanitized = sanitizeMarkdown(text);
  return tgApi('sendMessage', { chat_id: chatId, text: sanitized, parse_mode: 'Markdown' });
}

function tgSendAction(chatId) {
  return tgApi('sendChatAction', { chat_id: chatId, action: 'typing' });
}

app.post('/api/telegram/webhook', async (req, res) => {
  res.json({ ok: true });
  if (!tgBotToken) return;
  const msg = req.body?.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  tgSendAction(chatId);
  const parts = text.split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(' ');

  try {
    switch (cmd) {
      case '/start':
      case '/help':
        await tgSendMessage(chatId,
          '*Social Media Engine*\n\n' +
          '`/status` — System + queue status\n' +
          '`/queue` — Scheduled items\n' +
          '`/schedule <topic>` — Schedule a post\n' +
          '`/post <message>` — Post to Facebook now\n' +
          '`/generate <topic>` — Generate content via AI\n' +
          '`/autopilot on|off` — Toggle auto-pilot\n' +
          '`/pause [hours]` — Pause auto-pilot\n' +
          '`/stats` — Queue statistics\n' +
          '`/cancel <id>` — Remove from queue\n' +
          '`/scrape` — Fetch latest trends'
        );
        break;

      case '/status': {
        const [stats, pause, q] = await Promise.all([
          db.queueStats().catch(() => ({})),
          db.getPauseState().catch(() => ({})),
          db.getQueue({ limit: 3 }).catch(() => []),
        ]);
        await tgSendMessage(chatId,
          '*System Status*\n\n' +
          `Auto-pilot: ${autoPilotInterval ? 'ON' : 'OFF'}\n` +
          `Paused: ${pause.paused ? 'Yes' : 'No'}\n` +
          `Scheduled: ${stats.scheduled || 0}\n` +
          `Posted: ${stats.posted || 0}\n` +
          `Failed: ${stats.failed || 0}\n\n` +
          `*Next ${Math.min(3, q.length)} scheduled:*\n` +
          (q.slice(0, 3)
            .map(i => `#${i.id} — ${i.topic || 'untitled'} (${new Date(i.scheduled_for).toLocaleString()})`)
            .join('\n') || 'None')
        );
        break;
      }

      case '/queue': {
        const status = arg || 'scheduled';
        const items = await db.getQueue({ status, limit: 15 }).catch(() => []);
        if (!items.length) {
          await tgSendMessage(chatId, `No items with status "${status}".`);
          break;
        }
        const lines = items.map(i =>
          `#${i.id} [${i.platform}] ${i.topic || 'untitled'} — ${new Date(i.scheduled_for).toLocaleString()}`
        );
        for (let i = 0; i < lines.length; i += 15) {
          await tgSendMessage(chatId, `*Queue (${status})*\n${lines.slice(i, i + 15).join('\n')}`);
        }
        break;
      }

      case '/schedule': {
        if (!arg) {
          await tgSendMessage(chatId, 'Usage: `/schedule <topic>`');
          break;
        }
        const sched = new Date(Date.now() + 6 * 3600000);
        const item = await db.addToQueue({
          content: '', topic: truncate(arg, 500),
          type: 'post', platform: 'facebook',
          scheduled_for: sched.toISOString(), tone: 'casual',
        });
        await tgSendMessage(chatId,
          `*Scheduled #${item.id}*\nTopic: ${arg}\nTime: ${sched.toLocaleString()}`
        );
        break;
      }

      case '/post': {
        if (!arg) {
          await tgSendMessage(chatId, 'Usage: `/post <message>`');
          break;
        }
        const fbRes = await fbFeedPost(arg);
        if (fbRes.id) {
          try {
            await db.savePost({
              content: arg, type: 'post', status: 'posted',
              facebook_post_id: fbRes.id,
            });
          } catch (e) {
            log('error', 'savePost after telegram post failed', { error: e.message, rid: req.id });
          }
          await tgSendMessage(chatId, `*Posted!*\nhttps://facebook.com/${fbRes.id}`);
        } else {
          const errText = safeStr(fbRes.error) || JSON.stringify(fbRes);
          await tgSendMessage(chatId, `Facebook error: ${errText}`);
        }
        break;
      }

      case '/generate': {
        if (!arg) {
          await tgSendMessage(chatId, 'Usage: `/generate <topic>`');
          break;
        }
        await tgSendMessage(chatId, `Generating content about: ${arg}...`);
        const content = await azure.generateContent(
          `Write a social media post about: ${arg}. Under 200 words.`,
          { maxTokens: 500 }
        );
        const item = await db.addToQueue({
          content, topic: arg, type: 'post', platform: 'facebook',
          scheduled_for: new Date(Date.now() + 3600000).toISOString(),
          tone: 'casual',
        });
        const preview = content ? content.slice(0, 1000) : '(empty)';
        await tgSendMessage(chatId, `*Generated & Scheduled #${item.id}*\n\n${preview}`);
        break;
      }

      case '/autopilot': {
        if (arg === 'on') {
          if (autoPilotInterval) {
            await tgSendMessage(chatId, 'Auto-pilot already running.');
          } else {
            startAutoPilot();
            await tgSendMessage(chatId, 'Auto-pilot started.');
          }
        } else if (arg === 'off') {
          stopAutoPilot();
          await tgSendMessage(chatId, 'Auto-pilot stopped.');
        } else {
          await tgSendMessage(chatId, 'Usage: `/autopilot on|off`');
        }
        break;
      }

      case '/pause': {
        const hours = parseInt(arg, 10) || 0;
        const expiresAt = hours > 0
          ? new Date(Date.now() + hours * 3600000).toISOString()
          : null;
        await db.setPauseState(true, expiresAt);
        if (hours > 0) {
          await tgSendMessage(chatId, `Paused for ${hours}h (until ${new Date(expiresAt).toLocaleString()})`);
        } else {
          await tgSendMessage(chatId, 'Paused indefinitely. `/autopilot on` to resume.');
        }
        break;
      }

      case '/stats': {
        const stats = await db.queueStats().catch(() => ({}));
        await tgSendMessage(chatId,
          '*Queue Statistics*\n\n' +
          `Scheduled: ${stats.scheduled || 0}\n` +
          `Posted: ${stats.posted || 0}\n` +
          `Failed: ${stats.failed || 0}\n\n` +
          '*By platform:*\n' +
          Object.entries(stats.by_platform || {})
            .map(([p, c]) => `${p}: ${c}`).join('\n') || 'None'
        );
        break;
      }

      case '/cancel': {
        if (!arg || isNaN(parseInt(arg, 10))) {
          await tgSendMessage(chatId, 'Usage: `/cancel <id>`');
          break;
        }
        await db.removeFromQueue(parseInt(arg, 10));
        await tgSendMessage(chatId, `Cancelled item #${arg}.`);
        break;
      }

      case '/scrape': {
        await tgSendMessage(chatId, 'Scraping trends...');
        const fetch = globalThis.fetch || (await import('node-fetch')).default;
        const r = await fetch(`http://localhost:${PORT}/data/scrape`, {
          method: 'POST', signal: AbortSignal.timeout(60000),
        });
        const d = await r.json();
        const top = (d.trends || []).slice(0, 3).map(t => t.title).join('\n');
        await tgSendMessage(chatId, `Scraped ${d.trends_count || 0} trends.\nTop:\n${top}`);
        break;
      }

      default:
        if (text.startsWith('/')) {
          await tgSendMessage(chatId, `Unknown command: ${cmd}\nTry /help`);
        }
    }
  } catch (e) {
    await tgSendMessage(chatId, `Error: ${sanitizeMarkdown(e.message)}`);
  }
});

app.post('/api/telegram/set-webhook', async (req, res) => {
  try {
    if (!tgBotToken) return res.status(400).json({ error: 'no bot token' });
    const url = safeStr(req.body.url) ||
      `${config.services.data || 'https://agent-data-1qw0.onrender.com'}/api/telegram/webhook`;
    const result = await tgApi('setWebhook', {
      url, allowed_updates: ['message'], drop_pending_updates: true,
    });
    res.json(result);
  } catch (e) {
    log('error', 'Set webhook failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/telegram/webhook-info', async (req, res) => {
  try {
    if (!tgBotToken) return res.status(400).json({ error: 'no bot token' });
    const result = await tgApi('getWebhookInfo');
    res.json(result);
  } catch (e) {
    log('error', 'Webhook info failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

// ── Scheduler Engine ─────────────────────────────────────

app.post('/api/scheduler/schedule', async (req, res) => {
  try {
    const { content, topic, type, platform, scheduled_for, tone } = req.body;
    if (!scheduled_for) return res.status(400).json({ error: 'scheduled_for required' });
    const schedDate = new Date(scheduled_for);
    if (isNaN(schedDate.getTime())) return res.status(400).json({ error: 'invalid scheduled_for date' });
    if (!content && !topic) return res.status(400).json({ error: 'content or topic required' });
    let finalContent = safeStr(content);
    if (!finalContent && topic) {
      const p = {
        post: `Write a ${tone || 'casual'} post about: ${topic}. Under 200 words.`,
        reel: `Write a 15s reel script about: ${topic}.`,
        thread: `Write 3-5 post thread about: ${topic}.`,
        idea: `Generate 5 content ideas about ${topic}.`,
      };
      finalContent = await azure.generateContent(p[type] || p.post);
    }
    const item = await db.addToQueue({
      content: truncate(finalContent, 10000), topic: truncate(topic, 500),
      type: type || 'post', platform: platform || 'facebook',
      scheduled_for: schedDate.toISOString(),
      tone: tone || 'casual',
    });
    res.json({ success: true, item });
  } catch (e) {
    log('error', 'Schedule failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scheduler/queue', async (req, res) => {
  try {
    const items = await db.getQueue({
      status: req.query.status,
      platform: req.query.platform,
      limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500),
    });
    res.json({ items });
  } catch (e) {
    log('error', 'Queue fetch failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/scheduler/queue/:id', async (req, res) => {
  try {
    await db.removeFromQueue(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (e) {
    log('error', 'Queue delete failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scheduler/stats', async (req, res) => {
  try {
    res.json(await db.queueStats());
  } catch (e) {
    log('error', 'Queue stats failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/scheduler/tick', async (req, res) => {
  const rid = req.id;
  // Acquire distributed lock to prevent concurrent ticks (duplicate posts)
  const lockId = await redis.acquireLock('scheduler:tick', 120000);
  if (!lockId) {
    log('warn', 'Tick lock not acquired, another tick in progress', { rid });
    return res.json({ processed: 0, note: 'locked' });
  }
  try {
    const due = await db.getDueItems();
    const results = [];
    for (const item of due) {
      try {
        let contentToPost = safeStr(item.content);
        if (!contentToPost && item.topic) {
          contentToPost = await azure.generateContent(
            `Write a ${item.tone || 'casual'} social media post about: ${item.topic}. Under 200 words.`,
            { maxTokens: 500 }
          );
        }
        let postResult;
        if (!contentToPost) {
          postResult = { error: 'empty content' };
        } else if (item.platform === 'facebook' && item.type === 'reel') {
          const fetch = globalThis.fetch || (await import('node-fetch')).default;
          const topic = item.topic || 'AI technology';
          const caption = contentToPost.length > 5 ? contentToPost : `Reel about ${topic}! #Tech #AI`;
          const pr = await fetch(
            `https://api.pexels.com/videos/search?query=${encodeURIComponent(topic)}&per_page=3&orientation=portrait&size=small`,
            { headers: { Authorization: config.pexels.key }, signal: AbortSignal.timeout(15000) }
          );
          const pd = await pr.json();
          const pexelVideos = (pd?.videos || []).slice(0, 2);
          if (pexelVideos.length === 0) {
            postResult = { error: 'No stock video found' };
          } else {
            const vbs = [];
            for (const pv of pexelVideos) {
              const vf = pv.video_files.find(f => f.quality === 'hd' && f.width <= 1080) || pv.video_files[0];
              if (!vf?.link) continue;
              try {
                const vr = await fetch(vf.link, { signal: AbortSignal.timeout(30000) });
                const buf = Buffer.from(await vr.arrayBuffer());
                if (buf.length <= 100 * 1024 * 1024) vbs.push(buf);
              } catch {}
              if (vbs.length >= 2) break;
            }
            if (vbs.length === 0) {
              postResult = { error: 'No videos could be downloaded' };
            } else {
              try {
                const speechScript = await generateReelScript(topic, caption);
                const { audioBuffer } = await generateTTSWithPauses(speechScript);
                const musicBuffer = await searchBackgroundMusic(topic);
                const hookText = findHookText(speechScript);
                const finalVideo = await composeReelFull(vbs, audioBuffer, musicBuffer, hookText);
                const fn = `reels/${Date.now()}.mp4`;
                const vu = await db.uploadToSupabase('media', fn, finalVideo, 'video/mp4');
                if (!vu) throw new Error('Upload returned empty URL');
                postResult = await fbVideoPost(vu, caption);
              } catch (e) {
                log('error', 'TTS reel failed, falling back to silent', { error: e.message, rid });
                const fn = `reels/${Date.now()}.mp4`;
                const vu = await db.uploadToSupabase('media', fn, vbs[0], 'video/mp4');
                if (!vu) throw new Error('Upload returned empty URL');
                postResult = await fbVideoPost(vu, caption);
              }
            }
          }
        } else if (item.platform === 'facebook') {
          postResult = await fbFeedPost(contentToPost);
        } else {
          postResult = { error: `Platform ${item.platform} not implemented` };
        }
        if (postResult && postResult.id) {
          const marked = await db.markPosted(item.id, postResult);
          if (marked) {
            results.push({ id: item.id, status: 'posted', post_url: `https://facebook.com/${postResult.id}` });
            log('info', 'Posted', { id: item.id, type: item.type, rid });
          } else {
            log('warn', 'Item already marked', { id: item.id, rid });
            results.push({ id: item.id, status: 'already_posted' });
          }
        } else {
          await db.removeFromQueue(item.id);
          results.push({ id: item.id, status: 'failed', error: postResult });
          log('error', 'Post failed', { id: item.id, error: postResult, rid });
        }
      } catch (e) {
        log('error', 'Tick item error', { id: item.id, error: e.message, rid });
        results.push({ id: item.id, status: 'error', error: e.message });
      }
    }
    res.json({ processed: results.length, results });
  } catch (e) {
    log('error', 'Tick failed', { error: e.message, rid });
    res.status(500).json({ error: e.message });
  } finally {
    await redis.releaseLock('scheduler:tick', lockId);
  }
});

// ── Reel posting ─────────────────────────────────────────

app.post('/api/reel/post', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const topic = truncate(safeStr(req.body.topic, 'AI technology'), 200);
    const fallbackCaption = `Reel about ${topic}! What do you think? Drop a comment below! #Tech #Innovation #AI`;
    let content = fallbackCaption;
    try {
      const gen = await azure.generateContent(
        `Write a 1-2 sentence Facebook reel caption about: ${topic}. Include 3-5 relevant hashtags.`,
        { maxTokens: 500 }
      );
      if (gen && gen.length > 5) content = gen;
    } catch (e) {
      log('error', 'Reel caption gen failed', { error: e.message, rid: req.id });
    }
    const pr = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(topic)}&per_page=3&orientation=portrait&size=small`,
      { headers: { Authorization: config.pexels.key }, signal: AbortSignal.timeout(15000) }
    );
    const pd = await pr.json();
    const pexelVideos = (pd?.videos || []).slice(0, 2);
    if (pexelVideos.length === 0) {
      res.status(404).json({ error: 'No stock video found' });
      return;
    }
    const vbs = [];
    for (const pv of pexelVideos) {
      const vf = pv.video_files.find(f => f.quality === 'hd' && f.width <= 1080) || pv.video_files[0];
      if (!vf?.link) continue;
      try {
        const vr = await fetch(vf.link, { signal: AbortSignal.timeout(30000) });
        const buf = Buffer.from(await vr.arrayBuffer());
        if (buf.length <= 100 * 1024 * 1024) vbs.push(buf);
      } catch {}
      if (vbs.length >= 2) break;
    }
    if (vbs.length === 0) {
      return res.status(400).json({ error: 'No videos could be downloaded' });
    }
    try {
      const speechScript = await generateReelScript(topic, content);
      const { audioBuffer } = await generateTTSWithPauses(speechScript);
      const musicBuffer = await searchBackgroundMusic(topic);
      const hookText = findHookText(speechScript);
      const finalVideo = await composeReelFull(vbs, audioBuffer, musicBuffer, hookText);
      const fn = `reels/${Date.now()}.mp4`;
      const vu = await db.uploadToSupabase('media', fn, finalVideo, 'video/mp4');
      if (!vu) throw new Error('Upload returned empty URL');
      const fbRes = await fbVideoPost(vu, content);
      if (fbRes.id) {
        try { await db.savePost({ content, topic, type: 'reel', status: 'posted', facebook_post_id: fbRes.id }); }
        catch (e) { log('error', 'Reel savePost failed', { error: e.message, rid: req.id }); }
        res.json({ success: true, reel_url: `https://facebook.com/${fbRes.id}`, caption: content, has_voiceover: true, has_music: !!musicBuffer, has_hook: !!hookText });
      } else {
        res.json({ error: 'Facebook video error', raw: fbRes, video_url: vu });
      }
    } catch (e) {
      log('error', 'TTS reel failed, falling back to silent', { error: e.message, rid: req.id });
      const fn = `reels/${Date.now()}.mp4`;
      const vu = await db.uploadToSupabase('media', fn, vbs[0], 'video/mp4');
      if (!vu) throw new Error('Upload returned empty URL');
      const fbRes = await fbVideoPost(vu, content);
      if (fbRes.id) {
        try { await db.savePost({ content, topic, type: 'reel', status: 'posted', facebook_post_id: fbRes.id }); }
        catch (e) { log('error', 'Reel savePost failed', { error: e.message, rid: req.id }); }
        res.json({ success: true, reel_url: `https://facebook.com/${fbRes.id}`, caption: content, has_voiceover: false });
      } else {
        res.json({ error: 'Facebook video error', raw: fbRes, video_url: vu });
      }
    }
  } catch (e) {
    log('error', 'Reel post failed', { error: e.message, rid: req.id });
    res.json({ error: e.message });
  }
});

// ── Auto-Pilot Engine ────────────────────────────────────

let autoPilotInterval = null;
let tickInterval = null;
let scrapeInterval = null;
const AUTOPILOT_INTERVAL = 3600000;

async function autoPilotCycle() {
  try {
    const pause = await db.getPauseState();
    if (pause.paused) {
      if (!pause.expires_at) return;
      if (new Date(pause.expires_at) > new Date()) return;
      await db.setPauseState(false);
    }
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    try {
      const r = await fetch(`http://localhost:${PORT}/data/scrape`, { method: 'POST', signal: AbortSignal.timeout(30000) });
      if (!r.ok) log('error', 'Auto-pilot scrape failed', { status: r.status });
    } catch (e) {
      log('error', 'Auto-pilot scrape error', { error: e.message });
    }
    const trending = await db.getLatestTrends(10);
    const trendTopics = trending.map(t => t.title).filter(Boolean);
    const now = new Date();
    const week = getISOWeeks(now);
    let strategy = await db.getStrategy(week);
    if (!strategy) {
      const trendContext = trendTopics.length
        ? `\nTrending topics right now:\n${trendTopics.map(t => `- ${t}`).join('\n')}`
        : '';
      const pt = await azure.generateContent(
        `Create a 7-day content plan for tech page "djaouad tech" based on these current trends:${trendContext}` +
        '\n\nMix: education 40%, engagement 20%, social proof 20%, promo 10%, personal 10%.' +
        ' Each item must reference a real trend or news topic.' +
        ' JSON array: day, type(post/reel/thread), topic, description.',
        { maxTokens: 1500 }
      );
      let plan = [];
      try {
        const m = pt.match(/\[[\s\S]*?\]/s);
        if (m) plan = JSON.parse(m[0]);
      } catch (e) {
        log('error', 'Auto-pilot strategy parse failed', { error: e.message });
        plan = trendTopics.slice(0, 7).map((t, i) => ({
          day: i + 1, type: 'post', topic: t, description: 'Post about this trend',
        }));
      }
      await db.saveStrategy(week, plan);
      strategy = { plan };
    }
    if (!strategy || !strategy.plan) return;
    const queue = await db.getQueue({ status: 'scheduled', limit: 20 });
    if (queue.length >= 5) return;
    const processedTopics = new Set(queue.map(i => i.topic));
    for (const day of strategy.plan.slice(0, 7)) {
      const topic = day.topic
        || (trendTopics.length ? trendTopics[Math.floor(Math.random() * trendTopics.length)] : 'AI tech');
      if (processedTopics.has(topic)) continue;
      processedTopics.add(topic);
      let content = '';
      try {
        const nr = await fetch(
          `https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&apiKey=${config.freenews.key}&pageSize=3`,
          { signal: AbortSignal.timeout(10000) }
        );
        const nd = nr.ok ? await nr.json() : {};
        const articles = (nd?.articles || []).slice(0, 3);
        const wr = await fetch(
          `https://s.jina.ai/${encodeURIComponent(topic)}`,
          { headers: { Authorization: `Bearer ${config.jina.key}` }, signal: AbortSignal.timeout(15000) }
        );
        const wt = wr.ok ? await wr.text() : '';
        const sources = [
          ...articles.map(a => `- ${safeStr(a.title)}: ${safeStr(a.description) || ''}`),
          `- Web: ${truncate(wt, 800)}`,
        ].join('\n');
        if (day.type === 'reel') {
          content = await azure.generateContent(
            `Write a 15-second reel script about: ${topic}\n\nUse these real sources:\n${sources}\n\n` +
            `Script format: 3-4 short visual scenes with voiceover cues. Under 250 characters total. 3-5 hashtags.`,
            { systemPrompt: 'Short-form video scriptwriter.', maxTokens: 500 }
          );
        } else {
          content = await azure.generateContent(
            `Write a genuine, evidence-based Facebook post about: ${topic}\n\nUse these real sources:\n${sources}\n\n` +
            `200-400 words. 3-5 hashtags. CTA at end. Real examples only, no generic fluff.`,
            { systemPrompt: 'Tech writer. Evidence-based.', maxTokens: 1200 }
          );
        }
      } catch (e) {
        log('error', 'Auto-pilot research failed', { topic, error: e.message });
        content = '';
      }
      const hour = 8 + Math.floor(Math.random() * 12);
      const sched = new Date();
      sched.setHours(hour, 0, 0, 0);
      if (sched <= now) sched.setDate(sched.getDate() + 1);
      try {
        await db.addToQueue({
          content, topic, type: day.type || 'post',
          platform: 'facebook',
          scheduled_for: sched.toISOString(),
          tone: 'evidence-based',
        });
      } catch (e) {
        log('error', 'Auto-pilot addToQueue failed', { error: e.message });
      }
    }
  } catch (e) {
    log('error', 'Auto-pilot cycle error', { error: e.message });
  }
}

function startAutoPilot() {
  if (autoPilotInterval) return;
  autoPilotInterval = setInterval(autoPilotCycle, AUTOPILOT_INTERVAL);
  autoPilotCycle();
  log('info', 'Auto-pilot started', { interval: AUTOPILOT_INTERVAL });
}

function stopAutoPilot() {
  if (autoPilotInterval) {
    clearInterval(autoPilotInterval);
    autoPilotInterval = null;
    log('info', 'Auto-pilot stopped');
  }
}

app.post('/api/autopilot/start', async (req, res) => {
  try {
    if (autoPilotInterval) return res.json({ success: true, status: 'already_running' });
    startAutoPilot();
    res.json({ success: true, status: 'started', interval_ms: AUTOPILOT_INTERVAL });
  } catch (e) {
    log('error', 'Autopilot start failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/autopilot/stop', async (req, res) => {
  try {
    stopAutoPilot();
    res.json({ success: true, status: 'stopped' });
  } catch (e) {
    log('error', 'Autopilot stop failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/autopilot/status', async (req, res) => {
  try {
    const pause = await db.getPauseState();
    res.json({
      running: !!autoPilotInterval,
      paused: pause.paused,
      expires_at: pause.expires_at,
    });
  } catch (e) {
    log('error', 'Autopilot status failed', { error: e.message, rid: req.id });
    res.status(500).json({ error: e.message });
  }
});

// ── Auto intervals ───────────────────────────────────────

scrapeInterval = setInterval(async () => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const r = await fetch(`http://localhost:${PORT}/data/scrape`, { method: 'POST', signal: AbortSignal.timeout(60000) });
    if (r.ok) log('info', 'Auto scrape OK');
  } catch (e) {
    log('error', 'Auto scrape failed', { error: e.message });
  }
}, 7200000);

tickInterval = setInterval(async () => {
  try {
    const pause = await db.getPauseState();
    if (pause.paused) {
      if (!pause.expires_at) return;
      if (new Date(pause.expires_at) > new Date()) return;
    }
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    await fetch(`http://localhost:${PORT}/api/scheduler/tick`, { method: 'POST', signal: AbortSignal.timeout(120000) });
  } catch (e) {
    log('error', 'Auto tick failed', { error: e.message });
  }
}, 900000);

// ── Startup ──────────────────────────────────────────────

async function start() {
  await redis.connect();
  setInterval(() => redis.heartbeat(APP_NAME), 60000);
  await db.initDatabase();
  startAutoPilot();
  app.listen(PORT, '0.0.0.0', () => log('info', `Data service started`, { port: PORT }));
}

// ── Graceful shutdown ────────────────────────────────────

function shutdown(signal) {
  log('info', 'Shutdown received', { signal });
  stopAutoPilot();
  if (scrapeInterval) clearInterval(scrapeInterval);
  if (tickInterval) clearInterval(tickInterval);
  try { redis.getRedis().quit(); } catch {}
  log('info', 'Shutdown complete');
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
