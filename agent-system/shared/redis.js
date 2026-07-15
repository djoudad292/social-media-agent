const Redis = require('ioredis');
const config = require('./config');

let redis = null;
function getRedis() {
  if (!redis) {
    redis = new Redis(config.redis.url, { retryStrategy: (t) => Math.min(t * 50, 2000), maxRetriesPerRequest: 3, lazyConnect: true });
    redis.on('error', () => {});
  }
  return redis;
}
async function connect() { try { await getRedis().connect(); } catch {} }
async function heartbeat(name) {
  try { await getRedis().setex(`heartbeat:${name}`, 180, JSON.stringify({ status: 'alive', time: new Date().toISOString() })); } catch {}
}
async function getHeartbeats() {
  try {
    const r = getRedis(); const keys = await r.keys('heartbeat:*'); if (!keys.length) return {};
    const vals = await r.mget(keys); const result = {};
    keys.forEach((k, i) => { try { result[k.replace('heartbeat:', '')] = JSON.parse(vals[i]); } catch {} });
    return result;
  } catch { return {}; }
}
async function pushTask(task) { try { await getRedis().lpush('task_queue', JSON.stringify(task)); } catch {} }
async function popTask() { try { const v = await getRedis().rpop('task_queue'); return v ? JSON.parse(v) : null; } catch { return null; } }

module.exports = { getRedis, connect, heartbeat, getHeartbeats, pushTask, popTask };
