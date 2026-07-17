const Redis = require('ioredis');
const config = require('./config');

let redis = null;
let connecting = false;
let connectPromise = null;

function getRedis() {
  if (!redis) {
    if (!connecting) {
      connecting = true;
      redis = new Redis(config.redis.url || 'redis://localhost:6379', {
        retryStrategy: (t) => Math.min(t * 50, 2000),
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableReadyCheck: true,
      });
      redis.on('error', (err) => {
        if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOTFOUND') {
          console.error('[redis] error:', err.message);
        }
      });
    }
  }
  return redis;
}

async function connect() {
  if (connectPromise) return connectPromise;
  if (!config.redis.url) {
    console.warn('[redis] REDIS_URL not set, skipping connect');
    return false;
  }
  connectPromise = (async () => {
    try {
      await getRedis().connect();
      return true;
    } catch (e) {
      console.error('[redis] connect failed:', e.message);
      redis = null;
      connecting = false;
      connectPromise = null;
      return false;
    }
  })();
  return connectPromise;
}

async function heartbeat(name) {
  try {
    await getRedis().setex(`heartbeat:${name}`, 180,
      JSON.stringify({ status: 'alive', time: new Date().toISOString() }));
  } catch (e) {
    console.error('[redis] heartbeat failed:', e.message);
  }
}

async function getHeartbeats() {
  try {
    const r = getRedis();
    const keys = await r.keys('heartbeat:*');
    if (!keys.length) return {};
    const vals = await r.mget(keys);
    const result = {};
    keys.forEach((k, i) => {
      try { result[k.replace('heartbeat:', '')] = JSON.parse(vals[i]); } catch {}
    });
    return result;
  } catch (e) {
    console.error('[redis] getHeartbeats failed:', e.message);
    return {};
  }
}

async function acquireLock(name, ttlMs = 30000) {
  try {
    const r = getRedis();
    const key = `lock:${name}`;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ok = await r.set(key, id, 'PX', ttlMs, 'NX');
    if (ok === 'OK') return id;
    return null;
  } catch (e) {
    console.error('[redis] acquireLock failed:', e.message);
    return null;
  }
}

async function releaseLock(name, id) {
  try {
    const r = getRedis();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await r.eval(script, 1, `lock:${name}`, id);
  } catch (e) {
    console.error('[redis] releaseLock failed:', e.message);
  }
}

module.exports = { getRedis, connect, heartbeat, getHeartbeats, acquireLock, releaseLock };
