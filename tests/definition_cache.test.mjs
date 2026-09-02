import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, plain } from './harness.mjs';

// getDefinition / prefetchDefinition sit on top of the real keyless chain
// (fetchDictionary → gmFetch → gmRequest → GM_xmlhttpRequest). Every
// fetchDictionary call in keyless mode opens with exactly one Datamuse request,
// so `dmCalls` counts fetchDictionary invocations the way the legacy test
// counted its stub. `handler(word)` answers each request: a value → 200 JSON;
// an error with `.status` → that HTTP status; anything else → transport error.
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };

const dmOk = word => [{ word, tags: ['n'], defs: ['n\tx'] }];
const err = status => Object.assign(new Error(`HTTP ${status}`), { status });
const notFound = () => err(404);
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_MAX_FAILURES = 3;

function boot(initial = dmOk) {
  let handler = initial;
  const dmCalls = [];
  const impl = o => {
    const u = new URL(o.url);
    const dm = u.hostname === 'api.datamuse.com';
    const word = dm ? u.searchParams.get('sp') : decodeURIComponent(u.pathname.split('/').pop());
    if (dm) dmCalls.push(word);
    const answer = handler; // bind at request time so a later respond() swap only affects new requests
    Promise.resolve().then(() => answer(word)).then(
      v => o.onload({ status: 200, responseText: JSON.stringify(v) }),
      e => (e && e.status) ? o.onload({ status: e.status, responseText: '' }) : o.onerror(e),
    );
  };
  const { internals } = loadScript({ gmXhrImpl: impl, fetchImpl: async () => { throw new Error('fetch down'); } });
  const { getDefinition, prefetchDefinition, apiCache, defInflight } = internals;
  return { getDefinition, prefetchDefinition, apiCache, defInflight, dmCalls, respond: h => { handler = h; } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// --- getDefinition cache policy ---

test('concurrent calls dedup to one fetch and share the settlement', async () => {
  const t = boot();
  const gate = deferred();
  t.respond(async word => { await gate.promise; return dmOk(word); });
  const a = t.getDefinition('iota');
  const b = t.getDefinition('IOTA'); // case-insensitive key
  await flush();
  assert.equal(t.defInflight.size, 1);
  gate.resolve();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(t.dmCalls.length, 1);
  assert.equal(ra, rb);
  assert.equal(ra.status, 'fulfilled');
  assert.equal(ra.source, 'datamuse');
  assert.deepEqual(plain(ra.value), dmOk('iota'));
  assert.equal(t.defInflight.size, 0);
});

test('success is cached — second call does not refetch', async () => {
  const t = boot();
  await t.getDefinition('iota');
  const again = await t.getDefinition('iota');
  assert.equal(t.dmCalls.length, 1);
  assert.equal(again.status, 'fulfilled');
  assert.equal(t.apiCache.get('iota').dictResult.status, 'fulfilled');
});

test('regression: transient failure is NOT cached — a later call retries and can succeed', async () => {
  const t = boot(() => { throw new Error('GM timeout'); }); // transport error: both legs die
  const first = await t.getDefinition('iota');
  assert.equal(first.status, 'rejected');
  assert.equal(first.notFound, false);
  assert.equal(t.apiCache.size, 0, 'transient failure must not poison the cache');
  t.respond(dmOk);
  const second = await t.getDefinition('iota');
  assert.equal(t.dmCalls.length, 2);
  assert.equal(second.status, 'fulfilled');
});

test('HTTP 500 is transient too — not cached, with a definitive cause text', async () => {
  const t = boot(() => { throw err(500); });
  const r = await t.getDefinition('iota');
  assert.equal(r.status, 'rejected');
  assert.equal(r.notFound, false);
  assert.equal(r.errorText, 'Dictionary service is down (HTTP 500)');
  assert.equal(r.source, 'free');
  assert.equal(t.apiCache.size, 0);
});

test('HTTP 404 is definitive — cached as notFound, no refetch', async () => {
  const t = boot(() => { throw notFound(); });
  const first = await t.getDefinition('iota');
  assert.equal(first.notFound, true);
  assert.equal(t.apiCache.get('iota').dictResult.notFound, true);
  const second = await t.getDefinition('iota');
  assert.equal(t.dmCalls.length, 1);
  assert.equal(second.notFound, true);
});

test('regression: a failing concurrent fetch cannot overwrite a success (single settlement)', async () => {
  const t = boot();
  const gate = deferred();
  t.respond(async word => { await gate.promise; return dmOk(word); });
  const clickFetch = t.getDefinition('iota');
  t.respond(() => { throw new Error('would fail'); }); // swapped mid-flight
  const prefetchFetch = t.getDefinition('iota'); // joins the in-flight promise — never issues its own
  gate.resolve();
  const [a, b] = await Promise.all([clickFetch, prefetchFetch]);
  assert.equal(t.dmCalls.length, 1);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'fulfilled');
  assert.equal(t.apiCache.get('iota').dictResult.status, 'fulfilled');
});

// --- prefetch queue + breaker ---

test('at most PREFETCH_CONCURRENCY fetches in flight', async () => {
  const t = boot();
  const gates = new Map(); // word → release()
  t.respond(word => new Promise(res => gates.set(word, () => res(dmOk(word)))));
  const words = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff'];
  for (const w of words) t.prefetchDefinition(w);
  await flush();
  assert.equal(t.dmCalls.length, PREFETCH_CONCURRENCY, 'the rest wait in the queue');
  let released = 0;
  let maxInFlight = 0;
  while (released < words.length) {
    maxInFlight = Math.max(maxInFlight, t.dmCalls.length - released);
    const [word, go] = gates.entries().next().value;
    gates.delete(word);
    go();
    released++;
    await flush();
  }
  assert.equal(t.apiCache.size, words.length, 'all queued words eventually fetched');
  assert.equal(maxInFlight, PREFETCH_CONCURRENCY);
  assert.equal(t.defInflight.size, 0);
});

test('duplicate prefetch of a queued/cached word is a no-op', async () => {
  const t = boot();
  t.prefetchDefinition('iota');
  t.prefetchDefinition('iota');
  await flush();
  t.prefetchDefinition('iota');
  await flush();
  assert.equal(t.dmCalls.length, 1);
});

test('breaker trips after 3 consecutive transient failures — prefetch stops, clicks still fetch', async () => {
  const t = boot(() => { throw err(429); });
  for (const w of ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']) t.prefetchDefinition(w);
  await flush();
  assert.ok(t.dmCalls.length >= PREFETCH_MAX_FAILURES, `breaker needs ${PREFETCH_MAX_FAILURES} failures to trip`);
  assert.ok(t.dmCalls.length <= PREFETCH_MAX_FAILURES + 1, `prefetch kept hammering: ${t.dmCalls.length} calls`);
  const before = t.dmCalls.length;
  t.prefetchDefinition('gggg'); // enqueues, but the breaker blocks the pump
  await flush();
  assert.equal(t.dmCalls.length, before, 'tripped breaker must not issue prefetch fetches');
  t.respond(dmOk);
  const click = await t.getDefinition('hhhh'); // click path bypasses the breaker
  assert.equal(click.status, 'fulfilled');
  assert.equal(t.dmCalls.at(-1), 'hhhh');
});

test('notFound (404) does not count toward the breaker', async () => {
  const t = boot(() => { throw notFound(); });
  const words = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'];
  for (const w of words) t.prefetchDefinition(w);
  await flush();
  assert.equal(t.dmCalls.length, words.length, '404s are the API working — keep prefetching');
  assert.equal(t.apiCache.size, words.length, 'each 404 is cached as notFound');
  t.prefetchDefinition('ffff'); // well past the breaker threshold — still pumps
  await flush();
  assert.equal(t.dmCalls.length, words.length + 1);
});
