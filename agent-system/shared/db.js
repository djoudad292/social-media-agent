const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const redis = require('./redis');

const supabase = config.supabase.url && config.supabase.serviceKey
  ? createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
    })
  : null;

const MAX_POSTS = 200;
const MAX_TRENDING = 100;
const MAX_QUEUE = 500;

// ── Retry helper ─────────────────────────────────────────

async function withRetry(fn, label, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.error(`[db] ${label} attempt ${i + 1} failed: ${e.message}, retrying...`);
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

// ── Init ─────────────────────────────────────────────────

async function initDatabase() {
  try {
    await redis.connect();
    const r = redis.getRedis();
    const exists = await r.exists('queue:next_id');
    if (!exists) await r.set('queue:next_id', 0);
    if (!await r.exists('pause:state')) {
      await r.set('pause:state', JSON.stringify({ paused: false }));
    }
    if (!await r.exists('post:next_id')) await r.set('post:next_id', 0);
  } catch (e) {
    console.error('[db] init error:', e.message);
  }
}

// ── Posts ────────────────────────────────────────────────

async function savePost(post) {
  const r = redis.getRedis();
  const id = await r.incr('post:next_id');
  const p = { ...post, id, created_at: new Date().toISOString() };
  await r.pipeline()
    .lpush('posts:all', JSON.stringify(p))
    .ltrim('posts:all', 0, MAX_POSTS - 1)
    .exec();
  return p;
}

async function getPosts(limit = 20) {
  const r = redis.getRedis();
  const items = await r.lrange('posts:all', 0, limit - 1);
  return items.map(i => JSON.parse(i));
}

async function getRecentPosts(days = 7) {
  const all = await getPosts(1000);
  const since = Date.now() - days * 86400000;
  return all.filter(p => {
    try { return new Date(p.created_at).getTime() > since; }
    catch { return false; }
  });
}

// ── Trending ─────────────────────────────────────────────

async function saveTrending(trends) {
  if (!trends || !trends.length) return;
  const r = redis.getRedis();
  const pipeline = r.pipeline();
  for (const t of trends) {
    pipeline.lpush('trending:all',
      JSON.stringify({ ...t, fetched_at: new Date().toISOString() }));
  }
  pipeline.ltrim('trending:all', 0, MAX_TRENDING - 1);
  await pipeline.exec();
}

async function getLatestTrends(limit = 20) {
  const r = redis.getRedis();
  const items = await r.lrange('trending:all', 0, limit - 1);
  return items.map(i => JSON.parse(i));
}

// ── Analytics ────────────────────────────────────────────

async function saveAnalytics(data) {
  const r = redis.getRedis();
  await r.lpush('analytics:all', JSON.stringify(data));
  await r.ltrim('analytics:all', 0, 365);
}

async function getAnalytics(days = 28) {
  if (days <= 0) return [];
  const r = redis.getRedis();
  const all = await r.lrange('analytics:all', 0, 365);
  return all.map(i => JSON.parse(i)).filter(a => {
    try {
      const d = new Date(a.date).getTime();
      return !isNaN(d) && Date.now() - d < days * 86400000;
    } catch { return false; }
  });
}

// ── Pause ────────────────────────────────────────────────

async function getPauseState() {
  try {
    const r = redis.getRedis();
    const v = await r.get('pause:state');
    return v ? JSON.parse(v) : { paused: false };
  } catch {
    return { paused: false };
  }
}

async function setPauseState(paused, expiresAt = null) {
  const r = redis.getRedis();
  await r.set('pause:state', JSON.stringify({
    paused,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }));
}

// ── Leads ────────────────────────────────────────────────

async function saveLead(lead) {
  const r = redis.getRedis();
  const l = { ...lead, created_at: new Date().toISOString() };
  await r.lpush('leads:all', JSON.stringify(l));
  return l;
}

// ── Strategy ─────────────────────────────────────────────

async function saveStrategy(week, plan) {
  const r = redis.getRedis();
  await r.set(`strategy:${week}`,
    JSON.stringify({ week, plan, updated_at: new Date().toISOString() }));
}

async function getStrategy(week) {
  const r = redis.getRedis();
  const v = await r.get(`strategy:${week}`);
  return v ? JSON.parse(v) : null;
}

// ── Queue ────────────────────────────────────────────────

async function addToQueue(item) {
  const r = redis.getRedis();
  const id = await r.incr('queue:next_id');
  const q = {
    id,
    content: item.content || '',
    topic: item.topic || '',
    type: item.type || 'post',
    platform: item.platform || 'facebook',
    status: 'scheduled',
    scheduled_for: item.scheduled_for,
    tone: item.tone || 'casual',
    metadata: item.metadata || {},
    created_at: new Date().toISOString(),
  };
  await r.lpush('queue:items', JSON.stringify(q));
  await r.ltrim('queue:items', 0, MAX_QUEUE - 1);
  return q;
}

async function getQueue(opts = {}) {
  const r = redis.getRedis();
  const all = await r.lrange('queue:items', 0, -1);
  if (!all.length) return [];
  let items = all.map(i => JSON.parse(i));
  if (opts.status) items = items.filter(i => i.status === opts.status);
  if (opts.platform) items = items.filter(i => i.platform === opts.platform);
  items.sort((a, b) => {
    try { return new Date(a.scheduled_for) - new Date(b.scheduled_for); }
    catch { return 0; }
  });
  if (opts.limit) items = items.slice(0, opts.limit);
  return items;
}

async function getDueItems() {
  const r = redis.getRedis();
  const all = await r.lrange('queue:items', 0, -1);
  const now = new Date();
  return all.map(i => JSON.parse(i))
    .filter(i => i.status === 'scheduled' && new Date(i.scheduled_for) <= now)
    .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))
    .slice(0, 10);
}

async function markPosted(id, postResult) {
  const r = redis.getRedis();
  const script = `
    local items = redis.call("lrange", "queue:items", 0, -1)
    for i, raw in ipairs(items) do
      local item = cjson.decode(raw)
      if item.id == tonumber(ARGV[1]) and item.status == "scheduled" then
        item.status = "posted"
        item.posted_at = ARGV[2]
        item.result = cjson.decode(ARGV[3])
        redis.call("lset", "queue:items", i - 1, cjson.encode(item))
        return 1
      end
    end
    return 0
  `;
  try {
    const result = await r.eval(script, 0,
      String(id), new Date().toISOString(), JSON.stringify(postResult));
    return result === 1;
  } catch (e) {
    console.error('[db] markPosted lua error:', e.message);
    return false;
  }
}

async function removeFromQueue(id) {
  const r = redis.getRedis();
  const script = `
    local items = redis.call("lrange", "queue:items", 0, -1)
    for i, raw in ipairs(items) do
      local item = cjson.decode(raw)
      if item.id == tonumber(ARGV[1]) then
        redis.call("lrem", "queue:items", 0, raw)
        return 1
      end
    end
    return 0
  `;
  try {
    const result = await r.eval(script, 0, String(id));
    return result === 1;
  } catch (e) {
    console.error('[db] removeFromQueue lua error:', e.message);
    return false;
  }
}

const MAX_RETRIES = 5;

async function rescheduleItem(id, delayMs) {
  const r = redis.getRedis();
  const script = `
    local items = redis.call("lrange", "queue:items", 0, -1)
    for i, raw in ipairs(items) do
      local item = cjson.decode(raw)
      if item.id == tonumber(ARGV[1]) and item.status == "scheduled" then
        item.retryCount = (item.retryCount or 0) + 1
        if item.retryCount > tonumber(ARGV[2]) then
          redis.call("lrem", "queue:items", 0, raw)
          return -1
        end
        local sched = ARGV[3]
        if sched then
          item.scheduled_for = sched
        end
        redis.call("lset", "queue:items", i - 1, cjson.encode(item))
        return item.retryCount
      end
    end
    return 0
  `;
  try {
    const future = new Date(Date.now() + delayMs).toISOString();
    const result = await r.eval(script, 0, String(id), String(MAX_RETRIES), future);
    if (result === -1) {
      console.warn('[db] rescheduleItem exhausted retries, removed:', id);
    }
    return result;
  } catch (e) {
    console.error('[db] rescheduleItem lua error:', e.message);
    return -1;
  }
}

async function queueStats() {
  try {
    const r = redis.getRedis();
    const all = await r.lrange('queue:items', 0, -1);
    const items = all.map(i => JSON.parse(i));
    const stats = {
      scheduled: 0, posted: 0, failed: 0,
      total: items.length, by_platform: {},
    };
    for (const item of items) {
      if (item.status === 'scheduled') stats.scheduled++;
      if (item.status === 'posted') stats.posted++;
      if (item.status === 'failed') stats.failed++;
      stats.by_platform[item.platform] =
        (stats.by_platform[item.platform] || 0) + 1;
    }
    return stats;
  } catch {
    return { scheduled: 0, posted: 0, failed: 0, total: 0, by_platform: {} };
  }
}

// ── Supabase upload with retry ───────────────────────────

async function uploadToSupabase(bucket, path, buffer, contentType) {
  if (!supabase) throw new Error('Supabase not configured');
  await withRetry(async () => {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert: false });
    if (error) throw error;
  }, `upload ${bucket}/${path}`, 3, 1500);
  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);
  return publicUrl;
}

module.exports = {
  supabase,
  uploadToSupabase,
  savePost, getPosts, getRecentPosts,
  saveTrending, getLatestTrends,
  saveAnalytics, getAnalytics,
  getPauseState, setPauseState,
  saveLead,
  saveStrategy, getStrategy,
  addToQueue, getQueue, getDueItems,
  markPosted, removeFromQueue, rescheduleItem, queueStats,
  initDatabase,
};
