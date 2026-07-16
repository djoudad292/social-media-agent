const Redis = require('ioredis');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

// Keep supabase client for media service Storage
const supabase = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });

let redis;
function r() {
  if (!redis) {
    redis = new Redis(config.redis.url, { retryStrategy: (t) => Math.min(t * 50, 2000), maxRetriesPerRequest: 3, lazyConnect: true });
    redis.on('error', () => {});
  }
  return redis;
}

async function initDatabase() {
  try {
    await r().connect();
    // Ensure queue key exists
    const exists = await r().exists('queue:next_id');
    if (!exists) await r().set('queue:next_id', 0);
    if (!await r().exists('pause:state')) await r().set('pause:state', JSON.stringify({ paused: false }));
    if (!await r().exists('post:next_id')) await r().set('post:next_id', 0);
    console.log('Redis storage ready');
  } catch (e) { console.error('Redis init error:', e.message); }
}

// Posts
async function savePost(post) {
  const id = await r().incr('post:next_id');
  const p = { id, ...post, created_at: new Date().toISOString() };
  await r().lpush('posts:all', JSON.stringify(p));
  return p;
}
async function getPosts(limit = 20) {
  const items = await r().lrange('posts:all', 0, limit - 1);
  return items.map(i => JSON.parse(i));
}
async function getRecentPosts(days = 7) {
  const all = await getPosts(1000);
  const since = Date.now() - days * 86400000;
  return all.filter(p => new Date(p.created_at).getTime() > since);
}

// Trending
async function saveTrending(trends) {
  if (!trends.length) return;
  for (const t of trends) {
    await r().lpush('trending:all', JSON.stringify({ ...t, fetched_at: new Date().toISOString() }));
  }
  await r().ltrim('trending:all', 0, 99);
}
async function getLatestTrends(limit = 20) {
  const items = await r().lrange('trending:all', 0, limit - 1);
  return items.map(i => JSON.parse(i));
}

// Analytics
async function saveAnalytics(data) {
  await r().lpush('analytics:all', JSON.stringify(data));
  await r().ltrim('analytics:all', 0, 365);
}
async function getAnalytics(days = 28) {
  const all = await r().lrange('analytics:all', 0, 365);
  return all.map(i => JSON.parse(i)).filter(a => {
    const d = new Date(a.date).getTime();
    return Date.now() - d < days * 86400000;
  });
}

// Pause state
async function getPauseState() {
  try {
    const v = await r().get('pause:state');
    return v ? JSON.parse(v) : { paused: false };
  } catch { return { paused: false }; }
}
async function setPauseState(paused, expiresAt = null) {
  await r().set('pause:state', JSON.stringify({ paused, expires_at: expiresAt, updated_at: new Date().toISOString() }));
}

// Leads
async function saveLead(lead) {
  const l = { ...lead, created_at: new Date().toISOString() };
  await r().lpush('leads:all', JSON.stringify(l));
  return l;
}

// Strategy
async function saveStrategy(week, plan) {
  await r().set(`strategy:${week}`, JSON.stringify({ week, plan, updated_at: new Date().toISOString() }));
}
async function getStrategy(week) {
  const v = await r().get(`strategy:${week}`);
  return v ? JSON.parse(v) : null;
}

// Content queue
async function addToQueue(item) {
  const id = await r().incr('queue:next_id');
  const q = { id, content: item.content, topic: item.topic, type: item.type || 'post', platform: item.platform || 'facebook', status: 'scheduled', scheduled_for: item.scheduled_for, tone: item.tone || 'casual', metadata: item.metadata || {}, created_at: new Date().toISOString() };
  await r().lpush('queue:items', JSON.stringify(q));
  return q;
}
async function getQueue(opts = {}) {
  const all = await r().lrange('queue:items', 0, -1);
  let items = all.map(i => JSON.parse(i));
  if (opts.status) items = items.filter(i => i.status === opts.status);
  if (opts.platform) items = items.filter(i => i.platform === opts.platform);
  items.sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
  if (opts.limit) items = items.slice(0, opts.limit);
  return items;
}
async function getDueItems() {
  const all = await r().lrange('queue:items', 0, -1);
  const now = new Date();
  return all.map(i => JSON.parse(i)).filter(i => i.status === 'scheduled' && new Date(i.scheduled_for) <= now).sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for)).slice(0, 10);
}
async function markPosted(id, postResult) {
  const all = await r().lrange('queue:items', 0, -1);
  for (const raw of all) {
    const item = JSON.parse(raw);
    if (item.id === id) {
      item.status = 'posted';
      item.posted_at = new Date().toISOString();
      item.result = postResult;
      // Store updated item back
      const index = all.indexOf(raw);
      await r().lset('queue:items', index, JSON.stringify(item));
      break;
    }
  }
}
async function removeFromQueue(id) {
  const all = await r().lrange('queue:items', 0, -1);
  for (const raw of all) {
    const item = JSON.parse(raw);
    if (item.id === id) {
      await r().lrem('queue:items', 1, raw);
      break;
    }
  }
}
async function queueStats() {
  try {
    const all = await r().lrange('queue:items', 0, -1);
    const items = all.map(i => JSON.parse(i));
    const stats = { scheduled: 0, posted: 0, failed: 0, total: items.length, by_platform: {} };
    for (const r of items) {
      if (r.status === 'scheduled') stats.scheduled++;
      if (r.status === 'posted') stats.posted++;
      if (r.status === 'failed') stats.failed++;
      stats.by_platform[r.platform] = (stats.by_platform[r.platform] || 0) + 1;
    }
    return stats;
  } catch { return { scheduled: 0, posted: 0, failed: 0, total: 0, by_platform: {} }; }
}

module.exports = { supabase, savePost, getPosts, getRecentPosts, saveTrending, getLatestTrends,
  saveAnalytics, getAnalytics, getPauseState, setPauseState, saveLead, saveStrategy, getStrategy,
  addToQueue, getQueue, getDueItems, markPosted, removeFromQueue, queueStats, initDatabase };
