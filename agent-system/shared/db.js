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
    await supabase.from('trending_topics').insert({ source: t.source, title: t.title, url: t.url, score: t.score, summary: (t.summary || '').substring(0, 500) })
      .maybeSingle().catch(() => {});
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
  const { data } = await supabase.from('pause_state').select('*').order('updated_at', { ascending: false }).limit(1).single().catch(() => ({ data: null }));
  return data || { paused: false };
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

module.exports = { supabase, savePost, getPosts, getRecentPosts, saveTrending, getLatestTrends, saveAnalytics, getAnalytics, getPauseState, setPauseState, saveLead, saveStrategy };
