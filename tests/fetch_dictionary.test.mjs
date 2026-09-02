import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, plain } from './harness.mjs';

// fetchDictionary → gmFetch → gmRequest → GM_xmlhttpRequest. The double below
// answers each request from `handler(url)`: a returned value becomes a 200 JSON
// body; an error with `.status` becomes that HTTP status (which gmFetch passes
// through without a page-fetch retry); any other error is a transport error.
function fakeGm(handler) {
  const urls = [];
  const impl = o => {
    urls.push(o.url);
    Promise.resolve().then(() => handler(o.url)).then(
      v => o.onload({ status: 200, responseText: JSON.stringify(v) }),
      e => (e && e.status) ? o.onload({ status: e.status, responseText: '' }) : o.onerror(e),
    );
  };
  return { impl, urls };
}

function boot(handler, opts = {}) {
  const gm = fakeGm(handler);
  const ctx = loadScript({ gmXhrImpl: gm.impl, fetchImpl: async () => { throw new Error('fetch down'); }, ...opts });
  return { fetchDictionary: ctx.internals.fetchDictionary, urls: gm.urls };
}

// --- Fixtures (probed shapes, 2026-08-29) ---
const DM_OK = [{ word: 'iota', tags: ['n', 'ipa_pron:aɪˈoʊtʌ'], defs: ['n\tA very small quantity. '] }];
const DM_NO_DEFS = [{ word: 'iota', tags: ['n'] }];
const WK_OK = { en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'The ninth letter.' }] }] };
const err = status => Object.assign(new Error(`HTTP ${status}`), { status });
const isDatamuse = u => u.includes('api.datamuse.com');

test('Datamuse with defs wins — one request, no Wiktionary call', async () => {
  const { fetchDictionary, urls } = boot(() => DM_OK);
  const r = await fetchDictionary('iota');
  assert.equal(r.source, 'datamuse');
  assert.deepEqual(plain(r.value), DM_OK);
  assert.equal(urls.length, 1);
  assert.ok(isDatamuse(urls[0]));
});

test('Datamuse empty array → falls through to Wiktionary', async () => {
  const { fetchDictionary, urls } = boot(u => isDatamuse(u) ? [] : WK_OK);
  const r = await fetchDictionary('iota');
  assert.equal(r.source, 'wiktionary');
  assert.deepEqual(plain(r.value), WK_OK);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes('en.wiktionary.org'));
});

test('Datamuse entry without defs → falls through to Wiktionary', async () => {
  const { fetchDictionary } = boot(u => isDatamuse(u) ? DM_NO_DEFS : WK_OK);
  const r = await fetchDictionary('iota');
  assert.equal(r.source, 'wiktionary');
});

test('Datamuse fuzzy match for a different word → falls through to Wiktionary', async () => {
  const fuzzy = [{ word: 'natick', tags: ['n'], defs: ['n\tA town in Massachusetts. '] }];
  const { fetchDictionary } = boot(u => isDatamuse(u) ? fuzzy : WK_OK);
  const r = await fetchDictionary('naticc');
  assert.equal(r.source, 'wiktionary');
});

test('Datamuse transient error → falls through to Wiktionary', async () => {
  const { fetchDictionary } = boot(u => { if (isDatamuse(u)) throw err(503); return WK_OK; });
  const r = await fetchDictionary('iota');
  assert.equal(r.source, 'wiktionary');
});

test('Wiktionary 404 propagates with status (definitive not-found)', async () => {
  const { fetchDictionary } = boot(u => { if (isDatamuse(u)) return []; throw err(404); });
  await assert.rejects(() => fetchDictionary('zzzzqqq'), e => e.status === 404);
});

test('Wiktionary 200 with no English section → treated as not-found (status 404)', async () => {
  const { fetchDictionary } = boot(u => isDatamuse(u) ? [] : { fr: [] });
  await assert.rejects(() => fetchDictionary('zzzzqqq'), e => e.status === 404);
});

test('both legs transient-fail → Datamuse error wins (first cause)', async () => {
  const { fetchDictionary } = boot(u => { throw isDatamuse(u) ? err(429) : err(503); });
  await assert.rejects(() => fetchDictionary('iota'), e => e.status === 429);
});

test('Datamuse ok-but-empty + Wiktionary transient error → Wiktionary error propagates', async () => {
  const { fetchDictionary } = boot(u => { if (isDatamuse(u)) return []; throw err(503); });
  await assert.rejects(() => fetchDictionary('iota'), e => e.status === 503);
});

test('MW key set → single MW request, chain untouched', async () => {
  const { fetchDictionary, urls } = boot(() => [{ shortdef: ['x'] }], { gmValues: { mw_api_key: 'k123' } });
  const r = await fetchDictionary('iota');
  assert.equal(r.source, 'mw');
  assert.deepEqual(plain(r.value), [{ shortdef: ['x'] }]);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('dictionaryapi.com'));
  assert.ok(urls[0].includes('key=k123'));
});

test('word is URL-encoded in both chain URLs', async () => {
  const { fetchDictionary, urls } = boot(u => isDatamuse(u) ? [] : WK_OK);
  await fetchDictionary('café');
  assert.equal(urls.length, 2);
  assert.ok(!urls[0].includes('café') && urls[0].includes('caf%C3%A9'));
  assert.ok(urls[1].includes('caf%C3%A9'));
});
