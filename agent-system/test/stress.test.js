/**
 * Stress, concurrency, and recovery tests.
 * Requires Redis to be running (docker compose up -d).
 *
 * Run: node test/stress.test.js
 */

const path = require('path');

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.GATEWAY_TOKEN = 'test-token';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { passed++; }
  else { console.error(`  ✗ ${name}`); failed++; }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('\n=== Stress Tests (Requires Redis on localhost:6379) ===\n');

  const redis = require(path.join(__dirname, '..', 'shared', 'redis'));
  const db = require(path.join(__dirname, '..', 'shared', 'db'));

  const connected = await redis.connect();
  if (connected !== true) {
    console.log('  Redis not available, skipping stress tests.');
    console.log('  Start with: docker compose up -d');
    console.log(`\n=== Results: 0/0 (skipped) ===\n`);
    process.exit(0);
  }

  await db.initDatabase();

  // Clean slate
  let allItems = await db.getQueue();
  for (const item of allItems) await db.removeFromQueue(item.id);

  // ── 1. Concurrent addToQueue (race on incr) ──
  console.log('\n1. Concurrent addToQueue (100 items in parallel)...');
  const promises = [];
  const now = new Date();
  const sched = new Date(now.getTime() + 86400000).toISOString();
  for (let i = 0; i < 100; i++) {
    promises.push(db.addToQueue({ topic: `stress-${i}`, scheduled_for: sched }));
  }
  const items = await Promise.all(promises);
  const ids = items.map(i => i.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === 100, `100 unique IDs generated (got ${uniqueIds.size})`);
  assert(items.every(i => i.status === 'scheduled'), 'all items scheduled');
  console.log(`  Created ${items.length} items, ${uniqueIds.size} unique IDs`);

  // ── 2. Idempotent markPosted (prevent duplicates) ──
  console.log('\n2. Idempotent markPosted (concurrent calls)...');
  const target = items[0];
  const markPromises = [];
  for (let i = 0; i < 10; i++) {
    markPromises.push(db.markPosted(target.id, { id: `fb_${i}` }));
  }
  const results = await Promise.all(markPromises);
  const successes = results.filter(r => r === true).length;
  assert(successes === 1, `only 1 markPosted succeeded (got ${successes})`);
  console.log(`  markPosted called 10× concurrently, ${successes} succeeded`);

  // Verify the item is now posted
  const posted = await db.getQueue({ status: 'posted' });
  const found = posted.find(i => i.id === target.id);
  assert(found && found.status === 'posted', 'item is posted');
  assert(found.posted_at, 'posted_at timestamp set');

  // ── 3. getDueItems only returns scheduled items ──
  console.log('\n3. getDueItems correctness...');
  const due = await db.getDueItems();
  const allDueNotPosted = due.every(i => i.status === 'scheduled');
  assert(allDueNotPosted, 'all due items are scheduled');

  // ── 4. Distributed lock prevents concurrent access ──
  console.log('\n4. Distributed lock test...');
  const lock1 = await redis.acquireLock('stress:test', 5000);
  assert(lock1 !== null, 'first lock acquired');
  const lock2 = await redis.acquireLock('stress:test', 5000);
  assert(lock2 === null, 'second lock denied');
  await redis.releaseLock('stress:test', lock1);
  const lock3 = await redis.acquireLock('stress:test', 5000);
  assert(lock3 !== null, 'lock re-acquired after release');
  await redis.releaseLock('stress:test', lock3);

  // ── 5. Concurrent acquireLock (only 1 should win) ──
  console.log('\n5. Concurrent lock acquisition (20 callers)...');
  const lockPromises = [];
  for (let i = 0; i < 20; i++) {
    lockPromises.push(redis.acquireLock('stress:concurrent', 10000));
  }
  const lockResults = await Promise.all(lockPromises);
  const acquiredLocks = lockResults.filter(l => l !== null);
  assert(acquiredLocks.length === 1, `only 1 of 20 acquired lock (got ${acquiredLocks.length})`);
  console.log(`  ${acquiredLocks.length}/${lockResults.length} locks acquired`);
  if (acquiredLocks.length > 0) {
    await redis.releaseLock('stress:concurrent', acquiredLocks[0]);
  }

  // ── 6. Queue survives after removeFromQueue ──
  console.log('\n6. Queue integrity after removals...');
  const beforeRemove = await db.queueStats();
  // Remove 10 items
  const toRemove = items.slice(10, 20);
  for (const item of toRemove) {
    await db.removeFromQueue(item.id);
  }
  const afterRemove = await db.queueStats();
  assert(afterRemove.total === beforeRemove.total - 10,
    `total decreased by 10 (${beforeRemove.total} → ${afterRemove.total})`);
  assert(afterRemove.scheduled === beforeRemove.scheduled - 10,
    `scheduled decreased by 10`);

  // ── 7. Remove non-existent returns false ──
  console.log('\n7. Remove non-existent item...');
  const removedNonexistent = await db.removeFromQueue(999999);
  assert(removedNonexistent === false, 'returns false');

  // ── 8. Large queue performance ──
  console.log('\n8. Queue with 500 items (max)...');
  const schedFuture = new Date(Date.now() + 7 * 86400000).toISOString();
  const batchPromises = [];
  for (let i = 0; i < 380; i++) {  // 380 more to reach ~500 total
    batchPromises.push(db.addToQueue({ topic: `perf-${i}`, scheduled_for: schedFuture }));
  }
  await Promise.all(batchPromises);
  const stats500 = await db.queueStats();
  assert(stats500.total >= 470, `queue has ~470+ items (got ${stats500.total})`);
  console.log(`  Queue size: ${stats500.total}`);

  // ── 9. getDueItems with future dates returns empty ──
  console.log('\n9. getDueItems with only future dates...');
  const dueFuture = await db.getDueItems();
  assert(dueFuture.length === 0, 'no due items (all future)');

  // ── 10. Queue stats accuracy ──
  console.log('\n10. Queue stats accuracy...');
  const stats = await db.queueStats();
  assert(stats.total === stats.scheduled + stats.posted + stats.failed,
    `stats consistent: ${stats.total} = ${stats.scheduled} + ${stats.posted} + ${stats.failed}`);

  // ── 11. getQueue with multiple filters ──
  console.log('\n11. getQueue with multiple filters...');
  const fbItems = await db.getQueue({ platform: 'facebook', status: 'scheduled', limit: 10 });
  assert(fbItems.every(i => i.platform === 'facebook'), 'all facebook');
  assert(fbItems.every(i => i.status === 'scheduled'), 'all scheduled');
  assert(fbItems.length <= 10, 'at most 10 items');

  // ── 12. Cleanup ──
  console.log('\n12. Cleanup...');
  const final = await db.getQueue();
  for (const item of final) {
    await db.removeFromQueue(item.id);
  }
  const finalStats = await db.queueStats();
  assert(finalStats.total === 0, `queue empty after cleanup (${finalStats.total})`);
  console.log('  Done');

  // ── Results ──
  const total = passed + failed;
  console.log(`\n=== Stress Results: ${passed}/${total} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Stress test error:', err);
  process.exit(1);
});
