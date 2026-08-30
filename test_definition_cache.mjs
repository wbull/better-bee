import assert from 'node:assert';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${e.message}`);
  }
}

// --- Test doubles the mirrored functions close over ---
let fetchDictionary;
let mwApiKey = '';
const apiCache = new Map();

// --- Functions under test (mirrored from better_bee.user.js) ---

const defInflight = new Map(); // word → in-flight promise: dedups prefetch vs click

function getDefinition(word) {
  const key = word.toLowerCase();
  if (apiCache.has(key)) return Promise.resolve(apiCache.get(key).dictResult);
  if (defInflight.has(key)) return defInflight.get(key);
  const p = (async () => {
    try {
      const result = await fetchDictionary(word);
      const dictResult = { status: 'fulfilled', value: result, source: mwApiKey ? 'mw' : 'free' };
      apiCache.set(key, { dictResult });
      return dictResult;
    } catch (e) {
      const dictResult = { status: 'rejected', notFound: !!(e && e.status === 404) };
      if (dictResult.notFound) apiCache.set(key, { dictResult });
      return dictResult;
    } finally {
      defInflight.delete(key);
    }
  })();
  defInflight.set(key, p);
  return p;
}

const prefetchQueue = [];
let prefetchActive = 0;
let prefetchFailures = 0; // consecutive transient failures; success resets
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_MAX_FAILURES = 3;

function prefetchDefinition(word) {
  const key = word.toLowerCase();
  if (apiCache.has(key) || defInflight.has(key) || prefetchQueue.includes(key)) return;
  prefetchQueue.push(key);
  pumpPrefetch();
}

async function pumpPrefetch() {
  if (prefetchActive >= PREFETCH_CONCURRENCY || prefetchFailures >= PREFETCH_MAX_FAILURES) return;
  const key = prefetchQueue.shift();
  if (!key) return;
  prefetchActive++;
  const dictResult = await getDefinition(key);
  if (dictResult.status === 'rejected' && !dictResult.notFound) prefetchFailures++;
  else prefetchFailures = 0;
  prefetchActive--;
  pumpPrefetch();
}

// --- Test helpers ---

function reset() {
  apiCache.clear();
  defInflight.clear();
  prefetchQueue.length = 0;
  prefetchActive = 0;
  prefetchFailures = 0;
  mwApiKey = '';
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const notFoundError = () => Object.assign(new Error('HTTP 404'), { status: 404 });
const ENTRY = [{ word: 'iota' }];

// --- Tests ---

console.log('\ngetDefinition cache policy:');

await test('concurrent calls dedup to one fetch and share the settlement', async () => {
  reset();
  let calls = 0;
  const gate = deferred();
  fetchDictionary = async () => { calls++; await gate.promise; return ENTRY; };
  const a = getDefinition('iota');
  const b = getDefinition('IOTA'); // case-insensitive key
  gate.resolve();
  const [ra, rb] = await Promise.all([a, b]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(ra, rb);
  assert.strictEqual(ra.status, 'fulfilled');
});

await test('success is cached — second call does not refetch', async () => {
  reset();
  let calls = 0;
  fetchDictionary = async () => { calls++; return ENTRY; };
  await getDefinition('iota');
  const again = await getDefinition('iota');
  assert.strictEqual(calls, 1);
  assert.strictEqual(again.status, 'fulfilled');
});

await test('regression: transient failure is NOT cached — a later call retries and can succeed', async () => {
  reset();
  let calls = 0;
  fetchDictionary = async () => { calls++; throw new Error('GM timeout'); };
  const first = await getDefinition('iota');
  assert.strictEqual(first.status, 'rejected');
  assert.strictEqual(first.notFound, false);
  assert.strictEqual(apiCache.size, 0, 'transient failure must not poison the cache');
  fetchDictionary = async () => { calls++; return ENTRY; };
  const second = await getDefinition('iota');
  assert.strictEqual(calls, 2);
  assert.strictEqual(second.status, 'fulfilled');
});

await test('HTTP 500 is transient too — not cached', async () => {
  reset();
  fetchDictionary = async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); };
  const r = await getDefinition('iota');
  assert.strictEqual(r.notFound, false);
  assert.strictEqual(apiCache.size, 0);
});

await test('HTTP 404 is definitive — cached as notFound, no refetch', async () => {
  reset();
  let calls = 0;
  fetchDictionary = async () => { calls++; throw notFoundError(); };
  const first = await getDefinition('iota');
  assert.strictEqual(first.notFound, true);
  const second = await getDefinition('iota');
  assert.strictEqual(calls, 1);
  assert.strictEqual(second.notFound, true);
});

await test('regression: a failing concurrent fetch cannot overwrite a success (single settlement)', async () => {
  reset();
  const gate = deferred();
  fetchDictionary = async () => { await gate.promise; return ENTRY; };
  const clickFetch = getDefinition('iota');
  fetchDictionary = async () => { throw new Error('would fail'); }; // swapped mid-flight
  const prefetchFetch = getDefinition('iota'); // joins the in-flight promise — never issues its own
  gate.resolve();
  const [a, b] = await Promise.all([clickFetch, prefetchFetch]);
  assert.strictEqual(a.status, 'fulfilled');
  assert.strictEqual(b.status, 'fulfilled');
  assert.strictEqual(apiCache.get('iota').dictResult.status, 'fulfilled');
});

console.log('\nprefetch queue + breaker:');

await test('at most PREFETCH_CONCURRENCY fetches in flight', async () => {
  reset();
  let inFlight = 0;
  let maxInFlight = 0;
  fetchDictionary = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return ENTRY;
  };
  for (const w of ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff']) prefetchDefinition(w);
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(apiCache.size, 6, 'all queued words eventually fetched');
  assert.ok(maxInFlight <= PREFETCH_CONCURRENCY, `max in flight was ${maxInFlight}`);
});

await test('duplicate prefetch of a queued/cached word is a no-op', async () => {
  reset();
  let calls = 0;
  fetchDictionary = async () => { calls++; return ENTRY; };
  prefetchDefinition('iota');
  prefetchDefinition('iota');
  await new Promise(r => setTimeout(r, 20));
  prefetchDefinition('iota');
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(calls, 1);
});

await test('breaker trips after 3 consecutive transient failures — prefetch stops, clicks still fetch', async () => {
  reset();
  let calls = 0;
  fetchDictionary = async () => { calls++; throw new Error('HTTP 429 vibes'); };
  for (const w of ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']) prefetchDefinition(w);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(calls <= PREFETCH_MAX_FAILURES + 1, `prefetch kept hammering: ${calls} calls`);
  assert.ok(prefetchFailures >= PREFETCH_MAX_FAILURES);
  const before = calls;
  prefetchDefinition('gggg'); // enqueues, but the breaker blocks the pump
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(calls, before, 'tripped breaker must not issue prefetch fetches');
  fetchDictionary = async () => { calls++; return ENTRY; };
  const click = await getDefinition('hhhh'); // click path bypasses the breaker
  assert.strictEqual(click.status, 'fulfilled');
});

await test('notFound (404) does not count toward the breaker', async () => {
  reset();
  let calls = 0;
  fetchDictionary = async () => { calls++; throw notFoundError(); };
  for (const w of ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']) prefetchDefinition(w);
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(calls, 5, '404s are the API working — keep prefetching');
  assert.strictEqual(prefetchFailures, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
