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

module.exports = { supabase, savePost, getPosts, getRecentPosts, saveTrending, getLatestTrends, saveAnalytics, getAnalytics, getPauseState, setPauseState, saveLead, saveStrategy, addToQueue, getQueue, getDueItems, markPosted, removeFromQueue, queueStats };
