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
// Short timeout so hang-path tests run in milliseconds, not 2.5s.
const GM_FETCH_TIMEOUT_MS = 50;
let GM_xmlhttpRequest;
let fetch;

// --- Functions under test (mirrored from better_bee.user.js) ---

function gmRequest(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('GM timeout')), GM_FETCH_TIMEOUT_MS);
    const ok = v => { clearTimeout(timer); resolve(v); };
    const fail = e => { clearTimeout(timer); reject(e); };
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: GM_FETCH_TIMEOUT_MS,
        onload: res => {
          if (res.status >= 200 && res.status < 300) {
            try { ok(JSON.parse(res.responseText)); }
            catch { fail(new Error('Invalid JSON')); }
          } else {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status; // real server answer — lets gmFetch skip a pointless retry
            fail(err);
          }
        },
        onerror: () => fail(new Error('Network error')),
        ontimeout: () => fail(new Error('GM timeout')),
      });
    } catch (e) { fail(e); }
  });
}

async function gmFetch(url) {
  try {
    return await gmRequest(url);
  } catch (e) {
    // Any real HTTP status means the server answered; page fetch would just
    // repeat the same answer and double the load.
    if (e && e.status) throw e;
    // Every host we call serves Access-Control-Allow-Origin: *, so page
    // fetch works when the GM transport is broken or slow.
    const res = await fetch(url, { signal: AbortSignal.timeout(GM_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

// --- Tests ---

console.log('\ngmFetch transport fallback:');

const CLUES = [{ word: 'iota', text: 'Greek i', user: 'STEVE G' }];
const fetchOk = async () => ({ ok: true, json: async () => CLUES });
const fetchDown = async () => { throw new Error('fetch down'); };

await test('regression: GM_xmlhttpRequest never calls back → fetch fallback still delivers clues', async () => {
  GM_xmlhttpRequest = () => {}; // Tampermonkey MV3 on Chrome: request silently vanishes
  let fetched = false;
  fetch = async (url) => { fetched = true; return fetchOk(url); };
  const data = await gmFetch('https://static01.nyt.com/clues/1.json');
  assert.deepStrictEqual(data, CLUES);
  assert.strictEqual(fetched, true);
});

await test('GM success resolves without touching fetch', async () => {
  GM_xmlhttpRequest = (o) => o.onload({ status: 200, responseText: JSON.stringify(CLUES) });
  fetch = async () => { throw new Error('fetch must not be called'); };
  assert.deepStrictEqual(await gmFetch('u'), CLUES);
});

await test('GM network error falls back to fetch', async () => {
  GM_xmlhttpRequest = (o) => o.onerror(new Error('boom'));
  fetch = fetchOk;
  assert.deepStrictEqual(await gmFetch('u'), CLUES);
});

await test('GM non-2xx status rejects without touching fetch (server answered — no retry)', async () => {
  GM_xmlhttpRequest = (o) => o.onload({ status: 500, responseText: '' });
  let fetched = false;
  fetch = async () => { fetched = true; return fetchOk(); };
  await assert.rejects(() => gmFetch('u'), /HTTP 500/);
  assert.strictEqual(fetched, false);
});

await test('GM 404 rejects with err.status = 404, no fallback (word not found is definitive)', async () => {
  GM_xmlhttpRequest = (o) => o.onload({ status: 404, responseText: '{}' });
  let fetched = false;
  fetch = async () => { fetched = true; return fetchOk(); };
  await assert.rejects(() => gmFetch('u'), (e) => e.status === 404);
  assert.strictEqual(fetched, false);
});

await test('GM 429 rejects, no fallback (regression: rate-limit must not double the load)', async () => {
  GM_xmlhttpRequest = (o) => o.onload({ status: 429, responseText: '' });
  let fetched = false;
  fetch = async () => { fetched = true; return fetchOk(); };
  await assert.rejects(() => gmFetch('u'), (e) => e.status === 429);
  assert.strictEqual(fetched, false);
});

await test('GM 200 with invalid JSON still falls back (transport-ambiguous, no status)', async () => {
  GM_xmlhttpRequest = (o) => o.onload({ status: 200, responseText: 'not json' });
  fetch = fetchOk;
  assert.deepStrictEqual(await gmFetch('u'), CLUES);
});

await test('regression: hung fetch fallback is aborted — gmFetch cannot spin forever', async () => {
  GM_xmlhttpRequest = () => {}; // GM leg silently vanishes
  fetch = (url, opts) => new Promise((_, rej) =>
    opts.signal.addEventListener('abort', () => rej(opts.signal.reason)));
  // Node unrefs AbortSignal.timeout's internal timer; hold the loop open for it.
  const keepAlive = setTimeout(() => {}, 2000);
  const start = Date.now();
  await assert.rejects(() => gmFetch('u'));
  clearTimeout(keepAlive);
  assert.ok(Date.now() - start < 1000, 'should abort in ~2× timeout, not hang');
});

await test('GM throwing synchronously falls back to fetch', async () => {
  GM_xmlhttpRequest = () => { throw new Error('not granted'); };
  fetch = fetchOk;
  assert.deepStrictEqual(await gmFetch('u'), CLUES);
});

await test('both transports down → gmFetch rejects (callers show fallback text)', async () => {
  GM_xmlhttpRequest = () => {};
  fetch = fetchDown;
  await assert.rejects(() => gmFetch('u'));
});

await test('fetch fallback rejects on non-ok HTTP status, carrying err.status', async () => {
  GM_xmlhttpRequest = () => {};
  fetch = async () => ({ ok: false, status: 404, json: async () => null });
  await assert.rejects(() => gmFetch('u'), (e) => /HTTP/.test(e.message) && e.status === 404);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
