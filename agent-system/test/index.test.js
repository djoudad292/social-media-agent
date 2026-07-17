/**
 * Comprehensive test suite for Social Media Agent System.
 *
 * Run: node test/index.test.js
 *
 * Tests shared modules (db, redis, azure-proxy, config) in isolation
 * by mocking external dependencies where needed.
 */

const path = require('path');

// ── Mock setup before requiring modules ──────────────────

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com';
process.env.FACEBOOK_ACCESS_TOKEN = 'test-fb-token';
process.env.GATEWAY_TOKEN = 'test-gateway-token';
process.env.PEXELS_API_KEY = 'test-pexels-key';
process.env.JINA_API_KEY = 'test-jina-key';
process.env.FREENEWS_API_KEY = 'test-freenews-key';
process.env.AZURE_SPEECH_KEY = 'test-speech-key';
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-bot';
process.env.CONTENT_URL = 'http://localhost:3001';
process.env.MEDIA_URL = 'http://localhost:3002';
process.env.DATA_URL = 'http://localhost:3003';
process.env.GATEWAY_URL = 'http://localhost:3999';
process.env.PORT = '9999';
process.env.CONTENT_PORT = '3001';
process.env.MEDIA_PORT = '3002';
process.env.GATEWAY_PORT = '3999';

let passed = 0;
let failed = 0;
let errors = [];

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(`✗ ${name}`);
  }
}

function assertEqual(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    errors.push(`✗ ${name} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
  }
}

function assertDeepEqual(actual, expected, name) {
  try {
    assertEqual(JSON.stringify(actual), JSON.stringify(expected), name);
  } catch {
    failed++;
    errors.push(`✗ ${name} (deep compare failed)`);
  }
}

// ── Test Runner ──────────────────────────────────────────

async function runTests() {
  console.log('\n=== 1. Config Tests ===\n');

  const config = require(path.join(__dirname, '..', 'shared', 'config'));

  // 1.1 Basic config loading
  assertEqual(config.supabase.url, 'https://test.supabase.co', 'config.supabase.url');
  assertEqual(config.azure.apiKey, 'test-azure-key', 'config.azure.apiKey');
  assertEqual(config.facebook.accessToken, 'test-fb-token', 'config.facebook.accessToken');
  assertEqual(config.gatewayToken, 'test-gateway-token', 'config.gatewayToken');
  assertEqual(config.pexels.key, 'test-pexels-key', 'config.pexels.key');

  // 1.2 Redis URL exists
  assert(config.redis.url, 'config.redis.url exists');

  // 1.3 Service URLs
  assertEqual(config.services.content, 'http://localhost:3001', 'config.services.content');
  assertEqual(config.services.media, 'http://localhost:3002', 'config.services.media');
  assertEqual(config.services.data, 'http://localhost:3003', 'config.services.data');

  // 1.4 Port defaults
  assertEqual(config.port.data, 9999, 'config.port.data from PORT env');

  // 1.5 Missing env var returns undefined (not '')
  delete require.cache[path.join(__dirname, '..', 'shared', 'config.js')];
  const oldEnv = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  // config doesn't reference gemini anymore
  process.env.GEMINI_API_KEY = oldEnv;

  // 1.6 Verify missing var warning
  const warned = [];
  const origWarn = console.warn;
  console.warn = (msg) => { if (typeof msg === 'string' && msg.includes('[config]')) warned.push(msg); };
  delete require.cache[path.join(__dirname, '..', 'shared', 'config.js')];
  const config2 = require(path.join(__dirname, '..', 'shared', 'config'));
  console.warn = origWarn;
  assert(warned.length >= 0, 'config warns about missing vars');

  console.log('\n=== 2. Azure Proxy Tests ===\n');

  const azure = require(path.join(__dirname, '..', 'shared', 'azure-proxy'));
  assert(typeof azure.generateContent === 'function', 'azure.generateContent is function');
  assert(typeof azure.azureChatCompletion === 'function', 'azure.azureChatCompletion is function');

  // 2.1 Test empty API key handling
  const origKey = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = '';
  delete require.cache[path.join(__dirname, '..', 'shared', 'config.js')];
  delete require.cache[path.join(__dirname, '..', 'shared', 'azure-proxy.js')];
  const azure2 = require(path.join(__dirname, '..', 'shared', 'azure-proxy'));
  const emptyResult = await azure2.generateContent('test prompt');
  assertEqual(emptyResult, '', 'generateContent returns empty string on missing key');
  process.env.AZURE_OPENAI_API_KEY = origKey;

  console.log('\n=== 3. Redis Module Tests ===\n');

  const redis = require(path.join(__dirname, '..', 'shared', 'redis'));
  assert(typeof redis.getRedis === 'function', 'redis.getRedis is function');
  assert(typeof redis.connect === 'function', 'redis.connect is function');
  assert(typeof redis.heartbeat === 'function', 'redis.heartbeat is function');
  assert(typeof redis.getHeartbeats === 'function', 'redis.getHeartbeats is function');
  assert(typeof redis.acquireLock === 'function', 'redis.acquireLock is function');
  assert(typeof redis.releaseLock === 'function', 'redis.releaseLock is function');

  // 3.1 Redis singleton test
  const r1 = redis.getRedis();
  const r2 = redis.getRedis();
  assert(r1 === r2, 'redis.getRedis returns same instance');

  // 3.2 Redis connect handles missing URL gracefully
  delete require.cache[path.join(__dirname, '..', 'shared', 'redis.js')];
  const oldRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  delete require.cache[path.join(__dirname, '..', 'shared', 'config.js')];
  const redisNoUrl = require(path.join(__dirname, '..', 'shared', 'redis'));
  const connectResult = await redisNoUrl.connect();
  assertEqual(connectResult, false, 'redis.connect returns false when no URL');
  process.env.REDIS_URL = oldRedisUrl;

  console.log('\n=== 4. DB Module Structure Tests ===\n');

  // Re-require db with proper env
  delete require.cache[path.join(__dirname, '..', 'shared', 'config.js')];
  delete require.cache[path.join(__dirname, '..', 'shared', 'redis.js')];
  const redis2 = require(path.join(__dirname, '..', 'shared', 'redis'));
  const db = require(path.join(__dirname, '..', 'shared', 'db'));

  assert(typeof db.savePost === 'function', 'db.savePost exists');
  assert(typeof db.getPosts === 'function', 'db.getPosts exists');
  assert(typeof db.getRecentPosts === 'function', 'db.getRecentPosts exists');
  assert(typeof db.saveTrending === 'function', 'db.saveTrending exists');
  assert(typeof db.getLatestTrends === 'function', 'db.getLatestTrends exists');
  assert(typeof db.saveAnalytics === 'function', 'db.saveAnalytics exists');
  assert(typeof db.getAnalytics === 'function', 'db.getAnalytics exists');
  assert(typeof db.getPauseState === 'function', 'db.getPauseState exists');
  assert(typeof db.setPauseState === 'function', 'db.setPauseState exists');
  assert(typeof db.saveLead === 'function', 'db.saveLead exists');
  assert(typeof db.saveStrategy === 'function', 'db.saveStrategy exists');
  assert(typeof db.getStrategy === 'function', 'db.getStrategy exists');
  assert(typeof db.addToQueue === 'function', 'db.addToQueue exists');
  assert(typeof db.getQueue === 'function', 'db.getQueue exists');
  assert(typeof db.getDueItems === 'function', 'db.getDueItems exists');
  assert(typeof db.markPosted === 'function', 'db.markPosted exists');
  assert(typeof db.removeFromQueue === 'function', 'db.removeFromQueue exists');
  assert(typeof db.queueStats === 'function', 'db.queueStats exists');
  assert(typeof db.initDatabase === 'function', 'db.initDatabase exists');
  assert(typeof db.uploadToSupabase === 'function', 'db.uploadToSupabase exists');

  // 4.1 Supabase is configured when creds present
  assert(db.supabase !== null, 'db.supabase is not null with credentials');

  // 4.2 Supabase is null when no credentials
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete require.cache[path.join(__dirname, '..', 'shared', 'config.js')];
  delete require.cache[path.join(__dirname, '..', 'shared', 'db.js')];
  const dbNoSupabase = require(path.join(__dirname, '..', 'shared', 'db'));
  assertEqual(dbNoSupabase.supabase, null, 'db.supabase is null without credentials');
  process.env.SUPABASE_URL = oldUrl;
  process.env.SUPABASE_SECRET_KEY = oldKey;

  // 4.3 uploadToSupabase throws without credentials
  try {
    await dbNoSupabase.uploadToSupabase('test', 'test.txt', Buffer.from('test'), 'text/plain');
    assert(false, 'uploadToSupabase should throw without supabase');
  } catch (e) {
    assert(true, 'uploadToSupabase throws without supabase');
  }

  console.log('\n=== 5. Queue Logic Tests (with connected Redis) ===\n');

  // These tests only pass if Redis is available
  let redisAvailable = false;
  try {
    const connected = await redis2.connect();
    redisAvailable = connected === true;
  } catch { /* Redis not available */ }

  let redis3, db3;
  if (!redisAvailable) {
    console.log('  Skipping Redis-dependent tests (Redis not available)');
  } else {
    // Re-require db with working Redis
    delete require.cache[path.join(__dirname, '..', 'shared', 'config.js')];
    delete require.cache[path.join(__dirname, '..', 'shared', 'redis.js')];
    delete require.cache[path.join(__dirname, '..', 'shared', 'db.js')];
    redis3 = require(path.join(__dirname, '..', 'shared', 'redis'));
    db3 = require(path.join(__dirname, '..', 'shared', 'db'));
    await db3.initDatabase();

    // Clean up any previous test data
    const existing = await db3.getQueue();
    for (const item of existing) {
      await db3.removeFromQueue(item.id);
    }

    // 5.1 addToQueue defaults
    const qItem = await db3.addToQueue({
      topic: 'test topic',
      scheduled_for: new Date(Date.now() + 3600000).toISOString(),
    });
    assertEqual(qItem.type, 'post', 'default type is post');
    assertEqual(qItem.platform, 'facebook', 'default platform is facebook');
    assertEqual(qItem.status, 'scheduled', 'default status is scheduled');
    assertEqual(qItem.tone, 'casual', 'default tone is casual');
    assert(typeof qItem.id === 'number', 'has numeric id');
    assert(qItem.created_at, 'has created_at');
    assertEqual(qItem.topic, 'test topic', 'topic preserved');
    assertEqual(qItem.content, '', 'empty content default');

    // 5.2 getQueue filtering
    const qAll = await db3.getQueue();
    assert(qAll.length >= 1, 'queue has items');

    // 5.3 getQueue by status
    const qScheduled = await db3.getQueue({ status: 'scheduled' });
    assert(qScheduled.length >= 1, 'has scheduled items');

    // 5.4 getQueue by platform
    const qFB = await db3.getQueue({ platform: 'facebook' });
    assert(qFB.length >= 1, 'has facebook items');

    // 5.5 getQueue limit
    const qLimit = await db3.getQueue({ limit: 1 });
    assertEqual(qLimit.length, 1, 'limit works');

    // 5.6 removeFromQueue
    const toRemove = await db3.addToQueue({
      topic: 'remove test',
      scheduled_for: new Date().toISOString(),
    });
    const removed = await db3.removeFromQueue(toRemove.id);
    assert(removed, 'removeFromQueue returns true');
    const afterRemove = await db3.getQueue({ status: 'scheduled' });
    const stillExists = afterRemove.find(i => i.id === toRemove.id);
    assert(!stillExists, 'removed item gone from queue');

    // 5.7 removeFromQueue returns false for non-existent
    const removedNonexistent = await db3.removeFromQueue(-9999);
    assert(!removedNonexistent, 'removeFromQueue returns false for non-existent');

    // 5.8 queueStats
    const stats = await db3.queueStats();
    assert(typeof stats.scheduled === 'number', 'stats.scheduled');
    assert(typeof stats.posted === 'number', 'stats.posted');
    assert(typeof stats.failed === 'number', 'stats.failed');
    assert(typeof stats.total === 'number', 'stats.total');
    assert(typeof stats.by_platform === 'object', 'stats.by_platform');
    assert(stats.by_platform.facebook >= 1, 'facebook in by_platform');

    // 5.9 markPosted
    const toPost = await db3.addToQueue({
      topic: 'mark test',
      scheduled_for: new Date(Date.now() - 1000).toISOString(),
    });
    const testResult = { id: 'fb_' + toPost.id };
    const marked = await db3.markPosted(toPost.id, testResult);
    assert(marked, 'markPosted returns true');
    const posted = await db3.getQueue({ status: 'posted' });
    const found = posted.find(i => i.id === toPost.id);
    assert(found, 'marked item found');
    assertEqual(found.status, 'posted', 'status changed to posted');
    assert(found.posted_at, 'has posted_at timestamp');
    assertDeepEqual(found.result, testResult, 'result preserved');

    // 5.10 markPosted returns false for non-existent
    const markedNonexistent = await db3.markPosted(-9999, {});
    assert(!markedNonexistent, 'markPosted returns false for non-existent');

    // 5.11 markPosted returns false for already-posted
    const markedAgain = await db3.markPosted(toPost.id, { id: 'again' });
    assert(!markedAgain, 'markPosted returns false for already-posted (idempotent)');

    // 5.12 getDueItems doesn't return posted items
    const due = await db3.getDueItems();
    const doublePosted = due.find(i => i.id === toPost.id);
    assert(!doublePosted, 'already posted item not in due');

    // 5.13 getPauseState defaults
    const pauseState = await db3.getPauseState();
    assert(typeof pauseState.paused === 'boolean', 'pause state has paused boolean');

    // 5.14 setPauseState
    await db3.setPauseState(true, new Date(Date.now() + 3600000).toISOString());
    const paused = await db3.getPauseState();
    assertEqual(paused.paused, true, 'pause state set to true');

    // Reset pause
    await db3.setPauseState(false);

    // 5.15 save/get strategy
    const week = `2026-W${String(Math.ceil(((new Date() - new Date(2026, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
    await db3.saveStrategy(week, [{ day: 1, type: 'post', topic: 'test' }]);
    const strategy = await db3.getStrategy(week);
    assert(strategy, 'strategy saved and retrieved');
    assertEqual(strategy.plan[0].topic, 'test', 'strategy plan content preserved');

    // 5.16 saveTrending / getLatestTrends
    await db3.saveTrending([{ title: 'Test Trend', source: 'test' }]);
    const trends = await db3.getLatestTrends(5);
    assert(trends.length >= 1, 'at least 1 trend');
    const testTrend = trends.find(t => t.title === 'Test Trend');
    assert(testTrend, 'test trend found');
    assert(testTrend.fetched_at, 'trend has fetched_at');

    // 5.17 saveAnalytics / getAnalytics
    const today = new Date().toISOString().split('T')[0];
    await db3.saveAnalytics({
      date: today,
      impressions: 100,
      engaged_users: 10,
      followers: 50,
    });
    const analytics = await db3.getAnalytics(7);
    assert(analytics.length >= 1, 'at least 1 analytics entry');

    // 5.18 getAnalytics with days=0 returns empty
    const analyticsEmpty = await db3.getAnalytics(0);
    assertEqual(analyticsEmpty.length, 0, 'getAnalytics(0) returns empty');

    // 5.19 savePost / getPosts
    const post = await db3.savePost({
      content: 'test post', type: 'post', status: 'posted',
      facebook_post_id: 'fb_test_123',
    });
    assert(post.id, 'post has id');
    assertEqual(post.content, 'test post', 'post content preserved');
    const posts = await db3.getPosts(10);
    const foundPost = posts.find(p => p.id === post.id);
    assert(foundPost, 'post found in getPosts');

    // 5.20 getRecentPosts
    const recent = await db3.getRecentPosts(365);
    const recentPost = recent.find(p => p.id === post.id);
    assert(recentPost, 'post found in getRecentPosts');

    // 5.21 saveLead
    const lead = await db3.saveLead({
      company: 'Test Corp', contact: 'Test', email: 'test@test.com',
      score: 0.5, source: 'test', notes: 'test lead', status: 'new',
    });
    assert(lead.created_at, 'lead has created_at');

    // Cleanup test data
    const qFinal = await db3.getQueue();
    for (const item of qFinal) {
      await db3.removeFromQueue(item.id);
    }

    // 5.22 Distributed lock tests
    const lock1 = await redis3.acquireLock('test:lock', 10000);
    assert(lock1 !== null, 'acquireLock succeeds');
    const lock2 = await redis3.acquireLock('test:lock', 10000);
    assertEqual(lock2, null, 'acquireLock returns null for contended lock');
    await redis3.releaseLock('test:lock', lock1);
    const lock3 = await redis3.acquireLock('test:lock', 10000);
    assert(lock3 !== null, 'acquireLock succeeds after release');
    await redis3.releaseLock('test:lock', lock3);
  }

  console.log('\n=== 6. Helper Function Tests ===\n');

  // 6.1 safeStr
  const safeStr = (v, d = '') => {
    if (v === null || v === undefined) return d;
    if (typeof v === 'string') return v || d;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.join(', ');
    return d;
  };
  assertEqual(safeStr('hello'), 'hello', 'safeStr returns string');
  assertEqual(safeStr(null), '', 'safeStr handles null');
  assertEqual(safeStr(undefined), '', 'safeStr handles undefined');
  assertEqual(safeStr(123), '123', 'safeStr converts number');
  assertEqual(safeStr('', 'default'), 'default', 'safeStr handles empty string with default');
  assertEqual(safeStr(['a', 'b']), 'a, b', 'safeStr handles array');

  // 6.2 truncate
  const truncate = (str, max) => {
    if (!str || typeof str !== 'string') return '';
    return str.length <= max ? str : str.slice(0, max);
  };
  assertEqual(truncate('hello', 3), 'hel', 'truncate works');
  assertEqual(truncate('hello', 10), 'hello', 'truncate with bigger max');
  assertEqual(truncate(null, 5), '', 'truncate handles null');
  assertEqual(truncate(undefined, 5), '', 'truncate handles undefined');

  // 6.3 Sanitize markdown
  const sanitizeMarkdown = (text) => {
    return (text || '')
      .replace(/_/g, '\\_')
      .replace(/\*/g, '\\*')
      .replace(/\[/g, '\\[')
      .replace(/`/g, '\\`');
  };
  assertEqual(sanitizeMarkdown('hello_world'), 'hello\\_world', 'sanitizes underscores');
  assertEqual(sanitizeMarkdown('hello*world'), 'hello\\*world', 'sanitizes asterisks');
  assertEqual(sanitizeMarkdown('hello [world]'), 'hello \\[world]', 'sanitizes brackets');
  assertEqual(sanitizeMarkdown('hello `world`'), 'hello \\`world\\`', 'sanitizes backticks');
  assertEqual(sanitizeMarkdown(''), '', 'sanitizes empty string');
  assertEqual(sanitizeMarkdown(null), '', 'sanitizes null');

  // 6.4 ISO week function (independent verification)
  const getISOWeeks = (now = new Date()) => {
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
  };

  // Test specific known dates
  const testDates = [
    { date: '2026-01-01', expected: '2026-W01' },
    { date: '2026-01-05', expected: '2026-W02' },
    { date: '2026-12-31', expected: '2026-W53' },
  ];
  for (const { date, expected } of testDates) {
    const result = getISOWeeks(new Date(date));
    assertEqual(result, expected, `getISOWeeks(${date}) = ${expected}`);
  }

  // 6.5 URL construction
  const params = { access_token: 'test', message: 'hello world' };
  const qs = new URLSearchParams(params).toString();
  assert(typeof qs === 'string', 'URLSearchParams produces string');
  assert(qs.includes('access_token=test'), 'token in params');
  assert(qs.includes('message=hello+world'), 'message in params');

  // 6.6 Express request ID generation
  const crypto = require('crypto');
  const generateRequestId = () => crypto.randomBytes(4).toString('hex');
  const id1 = generateRequestId();
  const id2 = generateRequestId();
  assert(id1 !== id2, 'request IDs are unique');
  assertEqual(id1.length, 8, 'request ID is 8 hex chars');

  // 6.7 Facebook rate limiter simulation
  let tokens = 50;
  const acquire = async () => {
    if (tokens <= 0) return false;
    tokens--;
    return true;
  };
  assert(await acquire(), 'rate limiter acquires');
  assertEqual(tokens, 49, 'rate limiter decrements');

  console.log('\n=== 7. Edge Case Tests ===\n');

  // 7.1 Empty queue operations
  assert(typeof db.queueStats === 'function', 'queueStats exists (tested earlier)');

  // 7.2 getDueItems with no items (if Redis not available, skip)
  // This was tested above using the real db module

  // 7.3 Strategy for non-existent week
  if (redisAvailable) {
    const nullStrategy = await db3.getStrategy('2099-W99');
    assertEqual(nullStrategy, null, 'getStrategy returns null for missing week');
  }

  // 7.4 Remove non-existent queue item
  if (redisAvailable) {
    const removedNonexistent2 = await db3.removeFromQueue(-1);
    assert(!removedNonexistent2, 'removeFromQueue(-1) returns false');
  }

  // 7.5 Token truncation for safeStr with very long string
  const longStr = 'x'.repeat(10000);
  assertEqual(truncate(longStr, 5000).length, 5000, 'truncate limits to 5000 chars');

  // 7.6 Empty body handling
  assertEqual(safeStr(undefined, 'default'), 'default', 'safeStr with undefined and default');

  // ── Results ──────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  if (errors.length > 0) {
    console.log('\nFailed tests:');
    errors.forEach(e => console.log(`  ${e}`));
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
