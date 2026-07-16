const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const supabase = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });

async function savePost(post) {
  const { data, error } = await supabase.from('posts').insert(post).select().single();
  if (error) throw error; return data;
}
async function getPosts(limit = 20) {
  const { data, error } = await supabase.from('posts').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error; return data || [];
}
async function getRecentPosts(days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase.from('posts').select('*').gte('created_at', since).order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function saveTrending(trends) {
  if (!trends.length) return;
  for (const t of trends) {
    try { await supabase.from('trending_topics').insert({ source: t.source, title: t.title, url: t.url, score: t.score, summary: (t.summary || '').substring(0, 500) }); } catch {}
  }
}
async function getLatestTrends(limit = 20) {
  const { data, error } = await supabase.from('trending_topics').select('*').order('fetched_at', { ascending: false }).limit(limit);
  if (error) throw error; return data || [];
}
async function saveAnalytics(data) {
  await supabase.from('analytics').upsert(data, { onConflict: 'date' }).catch(() => {});
}
async function getAnalytics(days = 28) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase.from('analytics').select('*').gte('date', since).order('date', { ascending: true });
  if (error) throw error; return data || [];
}
async function getPauseState() {
  try {
    const { data } = await supabase.from('pause_state').select('*').order('updated_at', { ascending: false }).limit(1).single();
    return data || { paused: false };
  } catch { return { paused: false }; }
}
async function setPauseState(paused, expiresAt = null) {
  await supabase.from('pause_state').upsert({ id: 1, paused, expires_at: expiresAt, updated_at: new Date().toISOString() }).catch(() => {});
}
async function saveLead(lead) {
  const { data, error } = await supabase.from('leads').insert(lead).select().single();
  if (error) throw error; return data;
}
async function saveStrategy(week, plan) {
  await supabase.from('strategy').upsert({ week, plan, updated_at: new Date().toISOString() }).catch(() => {});
}

async function addToQueue(item) {
  const { data, error } = await supabase.from('content_queue').insert({
    content: item.content, topic: item.topic, type: item.type,
    platform: item.platform || 'facebook',
    scheduled_for: item.scheduled_for,
    status: 'scheduled', tone: item.tone || 'casual',
    metadata: item.metadata || {}
  }).select().single();
  if (error) throw error; return data;
}
async function getQueue(opts = {}) {
  let q = supabase.from('content_queue').select('*').order('scheduled_for', { ascending: true });
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.platform) q = q.eq('platform', opts.platform);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error; return data || [];
}
async function getDueItems() {
  const { data, error } = await supabase.from('content_queue')
    .select('*').eq('status', 'scheduled').lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true }).limit(10);
  if (error) throw error; return data || [];
}
async function markPosted(id, postResult) {
  await supabase.from('content_queue').update({ status: 'posted', posted_at: new Date().toISOString(), result: postResult }).eq('id', id).catch(() => {});
}
async function removeFromQueue(id) {
  await supabase.from('content_queue').delete().eq('id', id).catch(() => {});
}
async function queueStats() {
  try {
    const { data, error, count } = await supabase.from('content_queue').select('*', { count: 'exact', head: true });
    if (error) return { scheduled: 0, posted: 0, failed: 0, total: 0, by_platform: {} };
    const all = await supabase.from('content_queue').select('status, platform');
    if (all.error) return { scheduled: count || 0, posted: 0, failed: 0, total: count || 0, by_platform: {} };
    const stats = { scheduled: 0, posted: 0, failed: 0, total: count || 0, by_platform: {} };
    for (const r of all.data || []) {
      if (r.status === 'scheduled') stats.scheduled++;
      if (r.status === 'posted') stats.posted++;
      if (r.status === 'failed') stats.failed++;
      stats.by_platform[r.platform] = (stats.by_platform[r.platform] || 0) + 1;
    }
    return stats;
  } catch { return { scheduled: 0, posted: 0, failed: 0, total: 0, by_platform: {} }; }
}

// ====== Direct PostgreSQL for table creation ======
const { Client } = require('pg');

async function initDatabase() {
  const dbPassword = process.env.SUPABASE_DATABASE_PASSWORD;
  if (!dbPassword) {
    console.warn('SUPABASE_DATABASE_PASSWORD not set, tables won\'t be auto-created');
    return;
  }
  const ref = (config.supabase.url || '').replace('https://', '').split('.')[0];
  if (!ref) { console.warn('Cannot derive project ref from SUPABASE_URL'); return; }
  const connStr = `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${ref}.supabase.co:5432/postgres`;
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(`
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
    console.log('Database tables initialized successfully');
    // Insert default pause_state row if not exists
    await client.query(`INSERT INTO pause_state (id, paused) VALUES (1, false) ON CONFLICT (id) DO NOTHING`);
    // Reload PostgREST schema cache so it can see the new tables
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    await client.end();
  } catch (e) {
    console.error('Database init error:', e.message);
    try { await client.end(); } catch {}
  }
}

module.exports = { supabase, savePost, getPosts, getRecentPosts, saveTrending, getLatestTrends, saveAnalytics, getAnalytics, getPauseState, setPauseState, saveLead, saveStrategy, addToQueue, getQueue, getDueItems, markPosted, removeFromQueue, queueStats, initDatabase };
