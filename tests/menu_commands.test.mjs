// Tampermonkey menu commands, driven through the GM shim's __gmMenuCommands
// registry: the real callbacks registered by better_bee.user.js at load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScript, USERSCRIPT, versionFromHeader } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const CURRENT = versionFromHeader();
const SPLASH_SEL = '.ob-overlay[aria-label="Better Bee update news"]';
const HIVE = '<body><div class="sb-hive-input-content"></div></body>';
const ONBOARDING_SEEN = { betterBee_onboardingSeen: '1' };

const gm = (w, k) => JSON.parse(w.localStorage.getItem('GM_' + k));
const menu = (w, label) => {
  const fn = w.__gmMenuCommands[label];
  assert.equal(typeof fn, 'function', `menu command registered: ${label}`);
  return fn;
};
// 200ms hive poll + 500ms settle + rAF (16ms) before a splash renders.
const renderSplash = timers => timers.advance(200 + 500 + 16);

// Versions noted in the script's RELEASE_NOTES table, as written in the source.
function notedVersions() {
  const src = readFileSync(USERSCRIPT, 'utf8');
  const m = /const RELEASE_NOTES = \{([\s\S]*?)\n {2}\};/.exec(src);
  assert.ok(m, 'RELEASE_NOTES table found in the userscript');
  return [...m[1].matchAll(/^ {4}'(\d+(?:\.\d+)*)':\s*\{/gm)].map(x => x[1]);
}

// Records every GM_xmlhttpRequest URL and answers each with an empty JSON array.
function recordingXhr() {
  const urls = [];
  const impl = o => {
    urls.push(o.url);
    Promise.resolve().then(() => o.onload({ status: 200, responseText: '[]' }));
  };
  return { impl, urls };
}

// ─── Set Dictionary API Key ────────────────────────────────────────

test('Set Dictionary API Key: prompt is pre-filled with the stored key', () => {
  const calls = [];
  const { window } = loadScript({
    gmValues: { mw_api_key: 'old-key' },
    onWindow: w => { w.prompt = (msg, def) => { calls.push([msg, def]); return null; }; },
  });
  menu(window, 'Set Dictionary API Key')();
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /Merriam-Webster/);
  assert.equal(calls[0][1], 'old-key');
});

test('Set Dictionary API Key: stores the trimmed key and clears the definition caches', () => {
  const { window, internals } = loadScript({
    onWindow: w => { w.prompt = () => '  abc123  '; },
  });
  internals.apiCache.set('heel', { source: 'datamuse', value: [] });
  internals.defInflight.set('hello', Promise.resolve());

  menu(window, 'Set Dictionary API Key')();

  assert.equal(gm(window, 'mw_api_key'), 'abc123');
  assert.equal(internals.apiCache.size, 0, 'apiCache cleared');
  assert.equal(internals.defInflight.size, 0, 'defInflight cleared');
});

test('Set Dictionary API Key: the live lookup path switches to Merriam-Webster immediately', async () => {
  const xhr = recordingXhr();
  const { window, internals } = loadScript({
    gmXhrImpl: xhr.impl,
    onWindow: w => { w.prompt = () => 'abc123'; },
  });
  menu(window, 'Set Dictionary API Key')();

  const r = await internals.fetchDictionary('heel');
  assert.equal(r.source, 'mw');
  assert.equal(xhr.urls.length, 1);
  assert.ok(xhr.urls[0].startsWith('https://dictionaryapi.com/api/v3/references/collegiate/json/heel?key=abc123'), xhr.urls[0]);
});

test('Set Dictionary API Key: a cancelled prompt (null) changes nothing', () => {
  const { window, internals } = loadScript({
    gmValues: { mw_api_key: 'old-key' },
    onWindow: w => { w.prompt = () => null; },
  });
  internals.apiCache.set('heel', { source: 'mw', value: [] });
  internals.defInflight.set('hello', Promise.resolve());

  menu(window, 'Set Dictionary API Key')();

  assert.equal(gm(window, 'mw_api_key'), 'old-key');
  assert.equal(internals.apiCache.size, 1, 'apiCache untouched');
  assert.equal(internals.defInflight.size, 1, 'defInflight untouched');
});

// ─── Clear Dictionary API Key ──────────────────────────────────────

test('Clear Dictionary API Key: empties the stored key, clears caches, and lookups go keyless', async () => {
  const xhr = recordingXhr();
  const { window, internals } = loadScript({
    gmValues: { mw_api_key: 'old-key' },
    gmXhrImpl: xhr.impl,
  });
  internals.apiCache.set('heel', { source: 'mw', value: [] });
  internals.defInflight.set('hello', Promise.resolve());

  menu(window, 'Clear Dictionary API Key')();

  assert.equal(gm(window, 'mw_api_key'), '');
  assert.equal(internals.apiCache.size, 0);
  assert.equal(internals.defInflight.size, 0);

  await internals.fetchDictionary('heel').catch(() => {});
  assert.ok(xhr.urls.length >= 1, 'a lookup was issued');
  assert.ok(xhr.urls.every(u => !u.includes('dictionaryapi.com')), `no MW request: ${xhr.urls}`);
  assert.ok(xhr.urls[0].includes('api.datamuse.com'), xhr.urls[0]);
});

// ─── Update news toggle ────────────────────────────────────────────

test('Update news: label says On when not opted out, and the command toggles the opt-out each time', () => {
  const { window } = loadScript();
  const label = 'Update news: On — click to disable';
  assert.ok(window.__gmMenu.includes(label), `registered label: ${[...window.__gmMenu]}`);
  assert.ok(!window.__gmMenu.some(l => l.startsWith('Update news: Off')));

  const toggle = menu(window, label);
  toggle();
  assert.equal(gm(window, 'bb_update_news_optout'), true);
  toggle();
  assert.equal(gm(window, 'bb_update_news_optout'), false);
});

test('Update news: label says Off when opted out at load, and the command re-enables', () => {
  const { window } = loadScript({ gmValues: { bb_update_news_optout: true } });
  const label = 'Update news: Off — click to enable';
  assert.ok(window.__gmMenu.includes(label), `registered label: ${[...window.__gmMenu]}`);
  assert.ok(!window.__gmMenu.some(l => l.startsWith('Update news: On')));

  menu(window, label)();
  assert.equal(gm(window, 'bb_update_news_optout'), false);
});

// ─── Preview update news ───────────────────────────────────────────

test('Preview update news: renders every noted version, newest first, without touching last-seen or opt-out', () => {
  const timers = makeFakeTimers();
  const { window, document, internals } = loadScript({
    version: CURRENT,
    html: HIVE,
    localStorage: ONBOARDING_SEEN,
    gmValues: { bb_last_seen_version: CURRENT },
    timers,
  });
  assert.equal(document.querySelector(SPLASH_SEL), null, 'no splash from the normal flow');
  // Make a stray write detectable: the preview must never advance last-seen.
  window.localStorage.setItem('GM_bb_last_seen_version', JSON.stringify('0'));

  menu(window, 'Preview update news')();

  const overlay = document.querySelector(SPLASH_SEL);
  assert.ok(overlay, 'preview splash created');
  assert.equal(overlay.style.display, 'none', 'hidden until the puzzle DOM is ready');

  const expected = notedVersions().sort((a, b) => internals.compareVersions(b, a));
  assert.ok(expected.length >= 1, 'RELEASE_NOTES has at least one entry');
  const headings = [...overlay.querySelectorAll('.us-version-heading')].map(h => h.textContent.slice(1));
  assert.deepEqual(headings, expected);
  assert.equal(overlay.querySelector('.ob-title').textContent, `Better Bee updated — v${expected[0]}`);

  renderSplash(timers);
  assert.equal(overlay.style.display, 'flex');
  assert.ok(overlay.classList.contains('we-visible'));
  assert.equal(document.activeElement, overlay.querySelector('.ob-cta'));
  assert.equal(internals.onboardingActive, true, 'preview counts as an open overlay while shown');

  assert.equal(gm(window, 'bb_last_seen_version'), '0', 'last-seen not written by the preview');
  assert.equal(window.localStorage.getItem('GM_bb_update_news_optout'), null, 'opt-out not written');

  overlay.querySelector('.ob-cta').click();
  assert.equal(internals.onboardingActive, false);
  assert.equal(gm(window, 'bb_last_seen_version'), '0', 'still not written after dismiss');
});

test('Preview update news: does nothing while the first-run onboarding overlay is active', () => {
  const timers = makeFakeTimers();
  const { window, document, internals } = loadScript({ html: HIVE, timers });
  assert.equal(internals.onboardingActive, true);

  menu(window, 'Preview update news')();

  assert.equal(document.querySelector(SPLASH_SEL), null, 'no preview splash');
  assert.equal(document.querySelectorAll('.ob-overlay').length, 1, 'only the welcome overlay exists');
  renderSplash(timers);
  assert.equal(document.querySelector(SPLASH_SEL), null);
});

test('Preview update news: does nothing while an update splash is already showing', () => {
  const timers = makeFakeTimers();
  const { window, document, internals } = loadScript({
    version: CURRENT,
    html: HIVE,
    localStorage: ONBOARDING_SEEN,
    gmValues: { bb_last_seen_version: '0' },
    timers,
  });
  renderSplash(timers);
  assert.equal(internals.onboardingActive, true, 'post-update splash is open');
  assert.equal(document.querySelectorAll(SPLASH_SEL).length, 1);

  menu(window, 'Preview update news')();

  assert.equal(document.querySelectorAll(SPLASH_SEL).length, 1, 'no second splash stacked');
});
