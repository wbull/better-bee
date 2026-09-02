import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, plain } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

// gmFetch = GM_xmlhttpRequest first (with our own watchdog), page fetch second.
// The watchdog and AbortSignal.timeout both live on the window's setTimeout,
// which the fake clock replaces, so every "hang" below is driven by advance().
const GM_TIMEOUT = 2500; // GM_FETCH_TIMEOUT_MS in the script

const CLUES = [{ word: 'iota', text: 'Greek i', user: 'STEVE G' }];
const fetchOk = async () => ({ ok: true, json: async () => CLUES });
const fetchDown = async () => { throw new Error('fetch down'); };
const gmHangs = () => {}; // Tampermonkey MV3 on Chrome: request silently vanishes

const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };

function boot({ gm, fetch }) {
  const timers = makeFakeTimers();
  const ctx = loadScript({ timers, gmXhrImpl: gm, fetchImpl: fetch });
  return { timers, gmFetch: ctx.internals.gmFetch };
}

test('regression: GM_xmlhttpRequest never calls back → fetch fallback still delivers clues', async () => {
  let fetched = false;
  const { gmFetch, timers } = boot({ gm: gmHangs, fetch: async url => { fetched = true; return fetchOk(url); } });
  const p = gmFetch('https://static01.nyt.com/clues/1.json');
  timers.advance(GM_TIMEOUT - 1);
  await flush();
  assert.equal(fetched, false, 'fetch is the fallback, not the first choice');
  timers.advance(1);
  await flush();
  assert.equal(fetched, true, 'watchdog fires at exactly GM_FETCH_TIMEOUT_MS');
  assert.deepEqual(plain(await p), CLUES);
});

test('GM success resolves without touching fetch', async () => {
  let request;
  const gm = o => { request = o; o.onload({ status: 200, responseText: JSON.stringify(CLUES) }); };
  const { gmFetch } = boot({ gm, fetch: async () => { throw new Error('fetch must not be called'); } });
  assert.deepEqual(plain(await gmFetch('u')), CLUES);
  assert.equal(request.method, 'GET');
  assert.equal(request.url, 'u');
  assert.equal(request.timeout, GM_TIMEOUT);
});

test('GM network error falls back to fetch', async () => {
  const { gmFetch } = boot({ gm: o => o.onerror(new Error('boom')), fetch: fetchOk });
  assert.deepEqual(plain(await gmFetch('u')), CLUES);
});

test('GM non-2xx status rejects without touching fetch (server answered — no retry)', async () => {
  let fetched = false;
  const { gmFetch } = boot({
    gm: o => o.onload({ status: 500, responseText: '' }),
    fetch: async () => { fetched = true; return fetchOk(); },
  });
  await assert.rejects(() => gmFetch('u'), e => /HTTP 500/.test(e.message) && e.status === 500);
  assert.equal(fetched, false);
});

test('GM 404 rejects with err.status = 404, no fallback (word not found is definitive)', async () => {
  let fetched = false;
  const { gmFetch } = boot({
    gm: o => o.onload({ status: 404, responseText: '{}' }),
    fetch: async () => { fetched = true; return fetchOk(); },
  });
  await assert.rejects(() => gmFetch('u'), e => e.status === 404);
  assert.equal(fetched, false);
});

test('GM 429 rejects, no fallback (regression: rate-limit must not double the load)', async () => {
  let fetched = false;
  const { gmFetch } = boot({
    gm: o => o.onload({ status: 429, responseText: '' }),
    fetch: async () => { fetched = true; return fetchOk(); },
  });
  await assert.rejects(() => gmFetch('u'), e => e.status === 429);
  assert.equal(fetched, false);
});

test('GM 200 with invalid JSON still falls back (transport-ambiguous, no status)', async () => {
  const { gmFetch } = boot({ gm: o => o.onload({ status: 200, responseText: 'not json' }), fetch: fetchOk });
  assert.deepEqual(plain(await gmFetch('u')), CLUES);
});

test('regression: hung fetch fallback is aborted — gmFetch cannot spin forever', async () => {
  let signal = null;
  const fetch = (url, opts) => new Promise((_, rej) => {
    signal = opts.signal;
    signal.addEventListener('abort', () => rej(signal.reason));
  });
  const { gmFetch, timers } = boot({ gm: gmHangs, fetch });
  const p = gmFetch('u');
  const rejection = assert.rejects(p, e => e.name === 'TimeoutError'); // handler attached before it can fire
  timers.advance(GM_TIMEOUT); // GM watchdog → fallback fetch starts
  await flush();
  assert.ok(signal, 'fallback fetch was started with an abort signal');
  assert.equal(signal.aborted, false);
  timers.advance(GM_TIMEOUT - 1);
  await flush();
  assert.equal(signal.aborted, false);
  timers.advance(1); // AbortSignal.timeout(GM_FETCH_TIMEOUT_MS) fires
  await flush();
  assert.equal(signal.aborted, true);
  await rejection;
});

test('GM throwing synchronously falls back to fetch', async () => {
  const { gmFetch } = boot({ gm: () => { throw new Error('not granted'); }, fetch: fetchOk });
  assert.deepEqual(plain(await gmFetch('u')), CLUES);
});

test('both transports down → gmFetch rejects (callers show fallback text)', async () => {
  const { gmFetch, timers } = boot({ gm: gmHangs, fetch: fetchDown });
  const p = gmFetch('u');
  const rejection = assert.rejects(p, /fetch down/);
  timers.advance(GM_TIMEOUT);
  await rejection;
});

test('fetch fallback rejects on non-ok HTTP status, carrying err.status', async () => {
  const { gmFetch, timers } = boot({ gm: gmHangs, fetch: async () => ({ ok: false, status: 404, json: async () => null }) });
  const p = gmFetch('u');
  const rejection = assert.rejects(p, e => /HTTP/.test(e.message) && e.status === 404);
  timers.advance(GM_TIMEOUT);
  await rejection;
});
