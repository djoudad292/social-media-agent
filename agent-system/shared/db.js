const { Pool } = require('pg');
const config = require('./config');

// Keep supabase-js client for media service Storage operations
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });

let pool;
function getPool() {
  if (!pool) {
    const pwd = process.env.SUPABASE_DATABASE_PASSWORD;
    if (!pwd) throw new Error('SUPABASE_DATABASE_PASSWORD not set');
    const ref = (config.supabase.url || '').replace('https://', '').split('.')[0];
    const connStr = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`;
    pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, max: 3 });
  }
  return pool;
}

async function q(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows;
}

async function initDatabase() {
  const pwd = process.env.SUPABASE_DATABASE_PASSWORD;
  if (!pwd) { console.warn('SUPABASE_DATABASE_PASSWORD not set'); return; }
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS content_queue (
        id SERIAL PRIMARY KEY, content TEXT, topic TEXT, type TEXT DEFAULT 'post',
        platform TEXT DEFAULT 'facebook', status TEXT DEFAULT 'scheduled',
        scheduled_for TIMESTAMPTZ NOT NULL, tone TEXT DEFAULT 'casual',
        metadata JSONB DEFAULT '{}', posted_at TIMESTAMPTZ, result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY, content TEXT, type TEXT DEFAULT 'post', status TEXT,
        facebook_post_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pause_state (
        id INTEGER PRIMARY KEY DEFAULT 1, paused BOOLEAN DEFAULT false,
        expires_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS trending_topics (
        id SERIAL PRIMARY KEY, source TEXT, title TEXT, url TEXT, score REAL,
        summary TEXT, fetched_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS analytics (
        id SERIAL PRIMARY KEY, date DATE UNIQUE, impressions INTEGER DEFAULT 0,
        engaged_users INTEGER DEFAULT 0, followers INTEGER DEFAULT 0,
        raw_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY, company TEXT, contact TEXT, email TEXT,
        score REAL DEFAULT 0, source TEXT, notes TEXT, status TEXT DEFAULT 'new',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS strategy (
        id SERIAL PRIMARY KEY, week TEXT UNIQUE, plan JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await q(`INSERT INTO pause_state (id, paused) VALUES (1, false) ON CONFLICT (id) DO NOTHING`);
    console.log('Database tables ready');
  } catch (e) { console.error('DB init error:', e.message); }
}

// Posts
async function savePost(post) {
  const rows = await q(
    `INSERT INTO posts (content, type, status, facebook_post_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [post.content, post.type || 'post', post.status, post.facebook_post_id || null]
  );
  return rows[0];
}
async function getPosts(limit = 20) {
  return q(`SELECT * FROM posts ORDER BY created_at DESC LIMIT $1`, [limit]);
}
async function getRecentPosts(days = 7) {
  return q(`SELECT * FROM posts WHERE created_at >= $1 ORDER BY created_at DESC`,
    [new Date(Date.now() - days * 86400000).toISOString()]);
}

// Trending
async function saveTrending(trends) {
  if (!trends.length) return;
  for (const t of trends) {
    try { await q(`INSERT INTO trending_topics (source,title,url,score,summary) VALUES ($1,$2,$3,$4,$5)`,
      [t.source, t.title, t.url, t.score, (t.summary || '').substring(0, 500)]); } catch {}
  }
}
async function getLatestTrends(limit = 20) {
  return q(`SELECT * FROM trending_topics ORDER BY fetched_at DESC LIMIT $1`, [limit]);
}

// Analytics
async function saveAnalytics(data) {
  await q(`INSERT INTO analytics (date,impressions,engaged_users,followers,raw_data) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (date) DO UPDATE SET impressions=$2,engaged_users=$3,followers=$4,raw_data=$5`,
    [data.date, data.impressions, data.engaged_users, data.followers, JSON.stringify(data.raw_data || {})]
  ).catch(() => {});
}
async function getAnalytics(days = 28) {
  return q(`SELECT * FROM analytics WHERE date >= $1 ORDER BY date ASC`,
    [new Date(Date.now() - days * 86400000).toISOString().split('T')[0]]);
}

// Pause state
async function getPauseState() {
  try {
    const rows = await q(`SELECT * FROM pause_state ORDER BY updated_at DESC LIMIT 1`);
    return rows[0] || { paused: false };
  } catch { return { paused: false }; }
}
async function setPauseState(paused, expiresAt = null) {
  await q(`INSERT INTO pause_state (id,paused,expires_at,updated_at) VALUES (1,$1,$2,NOW())
    ON CONFLICT (id) DO UPDATE SET paused=$1,expires_at=$2,updated_at=NOW()`,
    [paused, expiresAt]);
}

// Leads
async function saveLead(lead) {
  const rows = await q(
    `INSERT INTO leads (company,contact,email,score,source,notes,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [lead.company, lead.contact, lead.email, lead.score, lead.source, lead.notes, lead.status]
  );
  return rows[0];
}

// Strategy
async function saveStrategy(week, plan) {
  await q(`INSERT INTO strategy (week,plan,updated_at) VALUES ($1,$2,NOW())
    ON CONFLICT (week) DO UPDATE SET plan=$2,updated_at=NOW()`,
    [week, JSON.stringify(plan)]);
}
async function getStrategy(week) {
  const rows = await q(`SELECT * FROM strategy WHERE week=$1 LIMIT 1`, [week]);
  return rows[0] || null;
}

// Content queue
async function addToQueue(item) {
  const rows = await q(
    `INSERT INTO content_queue (content,topic,type,platform,scheduled_for,status,tone,metadata)
     VALUES ($1,$2,$3,$4,$5,'scheduled',$6,$7) RETURNING *`,
    [item.content, item.topic, item.type, item.platform || 'facebook',
     item.scheduled_for, item.tone || 'casual', JSON.stringify(item.metadata || {})]
  );
  return rows[0];
}
async function getQueue(opts = {}) {
  let sql = 'SELECT * FROM content_queue WHERE 1=1';
  const params = []; let i = 1;
  if (opts.status) { sql += ` AND status=$${i++}`; params.push(opts.status); }
  if (opts.platform) { sql += ` AND platform=$${i++}`; params.push(opts.platform); }
  sql += ' ORDER BY scheduled_for ASC';
  if (opts.limit) { sql += ` LIMIT $${i++}`; params.push(opts.limit); }
  return q(sql, params);
}
async function getDueItems() {
  return q(`SELECT * FROM content_queue WHERE status='scheduled' AND scheduled_for<=$1 ORDER BY scheduled_for ASC LIMIT 10`,
    [new Date().toISOString()]);
}
async function markPosted(id, postResult) {
  await q(`UPDATE content_queue SET status='posted',posted_at=NOW(),result=$2 WHERE id=$1`,
    [id, JSON.stringify(postResult)]).catch(() => {});
}
async function removeFromQueue(id) {
  await q(`DELETE FROM content_queue WHERE id=$1`, [id]).catch(() => {});
}
async function queueStats() {
  try {
    const rows = await q(`SELECT status,platform FROM content_queue`);
    const stats = { scheduled: 0, posted: 0, failed: 0, total: rows.length, by_platform: {} };
    for (const r of rows) {
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
