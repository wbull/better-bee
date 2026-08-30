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

// --- Test doubles the mirrored function closes over ---
let gmFetch;
let mwApiKey = '';

// --- Function under test (mirrored from better_bee.user.js) ---
async function fetchDictionary(word) {
  if (mwApiKey) {
    const value = await gmFetch(`https://dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${encodeURIComponent(mwApiKey)}`);
    return { source: 'mw', value };
  }
  // Keyless chain: Datamuse (plain-text defs, one request) then Wiktionary
  // REST. A Wiktionary 404 is the chain's definitive "word not found".
  // Datamuse requires a (free) API key from 2027-01-01 — revisit before then.
  let datamuseError = null;
  try {
    const dm = await gmFetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dpr&ipa=1&max=1`);
    if (Array.isArray(dm) && dm[0] && dm[0].word === word.toLowerCase() && Array.isArray(dm[0].defs) && dm[0].defs.length) {
      return { source: 'datamuse', value: dm };
    }
  } catch (e) { datamuseError = e; }
  try {
    const wk = await gmFetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
    if (wk && Array.isArray(wk.en) && wk.en.length) return { source: 'wiktionary', value: wk };
    const notFound = new Error('HTTP 404');
    notFound.status = 404;
    throw notFound;
  } catch (e) {
    if (e && e.status === 404) throw e;
    throw datamuseError || e;
  }
}

// --- Fixtures (probed shapes, 2026-08-29) ---
const DM_OK = [{ word: 'iota', tags: ['n', 'ipa_pron:aɪˈoʊtʌ'], defs: ['n\tA very small quantity. '] }];
const DM_NO_DEFS = [{ word: 'iota', tags: ['n'] }];
const WK_OK = { en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'The ninth letter.' }] }] };
const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

console.log('\nfetchDictionary chain:');

await test('Datamuse with defs wins — one request, no Wiktionary call', async () => {
  const urls = [];
  gmFetch = async (u) => { urls.push(u); return DM_OK; };
  const r = await fetchDictionary('iota');
  assert.strictEqual(r.source, 'datamuse');
  assert.deepStrictEqual(r.value, DM_OK);
  assert.strictEqual(urls.length, 1);
  assert.ok(urls[0].includes('api.datamuse.com'));
});

await test('Datamuse empty array → falls through to Wiktionary', async () => {
  gmFetch = async (u) => u.includes('datamuse') ? [] : WK_OK;
  const r = await fetchDictionary('iota');
  assert.strictEqual(r.source, 'wiktionary');
  assert.deepStrictEqual(r.value, WK_OK);
});

await test('Datamuse entry without defs → falls through to Wiktionary', async () => {
  gmFetch = async (u) => u.includes('datamuse') ? DM_NO_DEFS : WK_OK;
  const r = await fetchDictionary('iota');
  assert.strictEqual(r.source, 'wiktionary');
});

await test('Datamuse fuzzy match for a different word → falls through to Wiktionary', async () => {
  const fuzzy = [{ word: 'natick', tags: ['n'], defs: ['n\tA town in Massachusetts. '] }];
  gmFetch = async (u) => u.includes('datamuse') ? fuzzy : WK_OK;
  const r = await fetchDictionary('naticc');
  assert.strictEqual(r.source, 'wiktionary');
});

await test('Datamuse transient error → falls through to Wiktionary', async () => {
  gmFetch = async (u) => { if (u.includes('datamuse')) throw err(503); return WK_OK; };
  const r = await fetchDictionary('iota');
  assert.strictEqual(r.source, 'wiktionary');
});

await test('Wiktionary 404 propagates with status (definitive not-found)', async () => {
  gmFetch = async (u) => { if (u.includes('datamuse')) return []; throw err(404); };
  await assert.rejects(() => fetchDictionary('zzzzqqq'), (e) => e.status === 404);
});

await test('Wiktionary 200 with no English section → treated as not-found (status 404)', async () => {
  gmFetch = async (u) => u.includes('datamuse') ? [] : { fr: [] };
  await assert.rejects(() => fetchDictionary('zzzzqqq'), (e) => e.status === 404);
});

await test('both legs transient-fail → Datamuse error wins (first cause)', async () => {
  gmFetch = async (u) => { throw u.includes('datamuse') ? err(429) : err(503); };
  await assert.rejects(() => fetchDictionary('iota'), (e) => e.status === 429);
});

await test('Datamuse ok-but-empty + Wiktionary transient error → Wiktionary error propagates', async () => {
  gmFetch = async (u) => { if (u.includes('datamuse')) return []; throw err(503); };
  await assert.rejects(() => fetchDictionary('iota'), (e) => e.status === 503);
});

await test('MW key set → single MW request, chain untouched', async () => {
  mwApiKey = 'k123';
  const urls = [];
  gmFetch = async (u) => { urls.push(u); return [{ shortdef: ['x'] }]; };
  const r = await fetchDictionary('iota');
  mwApiKey = '';
  assert.strictEqual(r.source, 'mw');
  assert.strictEqual(urls.length, 1);
  assert.ok(urls[0].includes('dictionaryapi.com'));
  assert.ok(urls[0].includes('key=k123'));
});

await test('word is URL-encoded in both chain URLs', async () => {
  const urls = [];
  gmFetch = async (u) => { urls.push(u); if (urls.length === 1) return []; return WK_OK; };
  await fetchDictionary('café');
  assert.ok(!urls[0].includes('café') && urls[0].includes('caf%C3%A9'));
  assert.ok(urls[1].includes('caf%C3%A9'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
