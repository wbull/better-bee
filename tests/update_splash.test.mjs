import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, plain, versionFromHeader } from './harness.mjs';

const CURRENT = versionFromHeader();
const SPLASH_SEL = '.ob-overlay[aria-label="Better Bee update news"]';
const ONBOARDING_SEEN = { betterBee_onboardingSeen: '1' };

const fns = () => loadScript().internals;
const lastSeen = w => JSON.parse(w.localStorage.getItem('GM_bb_last_seen_version'));
const splash = doc => doc.querySelector(SPLASH_SEL);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── compareVersions ───────────────────────────────────────────────

test('compareVersions: 1.9 sorts before 1.10 (numeric segments, not lexicographic/float)', () => {
  const { compareVersions } = fns();
  assert.equal(compareVersions('1.9', '1.10'), -1);
  assert.equal(compareVersions('1.10', '1.9'), 1);
});

test('compareVersions: equal versions compare as 0', () => {
  assert.equal(fns().compareVersions('1.42', '1.42'), 0);
});

test('compareVersions: unequal segment counts pad with zeros', () => {
  const { compareVersions } = fns();
  assert.equal(compareVersions('1.42', '1.42.0'), 0);
  assert.equal(compareVersions('1.42', '1.42.1'), -1);
  assert.equal(compareVersions('2', '1.99'), 1);
});

// ─── collectUnseenNotes ────────────────────────────────────────────

test('collectUnseenNotes: no noted versions in range → []', () => {
  const { collectUnseenNotes } = fns();
  assert.deepEqual(plain(collectUnseenNotes('1.41', '1.42', {})), []);
  assert.deepEqual(
    plain(collectUnseenNotes('1.41', '1.42', { '1.40': { features: ['old'], fixes: [] } })),
    []
  );
});

test('collectUnseenNotes: skipped versions all accumulate', () => {
  const notes = {
    '1.40': { features: ['a'], fixes: [] },
    '1.41': { features: [], fixes: ['b'] },
    '1.42': { features: ['c'], fixes: [] },
  };
  const out = fns().collectUnseenNotes('1.39', '1.42', notes);
  assert.deepEqual(plain(out.map(e => e.version)), ['1.42', '1.41', '1.40']);
});

test('collectUnseenNotes: current version with no entry contributes nothing', () => {
  const notes = { '1.41': { features: ['a'], fixes: [] } };
  const out = fns().collectUnseenNotes('1.40', '1.42', notes);
  assert.deepEqual(plain(out.map(e => e.version)), ['1.41']);
});

test('collectUnseenNotes: ordering is newest first', () => {
  const notes = {
    '1.9': { features: ['old'], fixes: [] },
    '1.10': { features: ['new'], fixes: [] },
  };
  const out = fns().collectUnseenNotes('1.8', '1.10', notes);
  assert.deepEqual(plain(out.map(e => e.version)), ['1.10', '1.9']);
});

test('collectUnseenNotes: lastSeen itself excluded, current included', () => {
  const notes = {
    '1.41': { features: ['seen'], fixes: [] },
    '1.42': { features: ['unseen'], fixes: [] },
  };
  const out = plain(fns().collectUnseenNotes('1.41', '1.42', notes));
  assert.deepEqual(out.map(e => e.version), ['1.42']);
  assert.deepEqual(out[0].features, ['unseen']);
  assert.deepEqual(out[0].fixes, []);
});

test('collectUnseenNotes: missing features/fixes arrays default to []', () => {
  const out = plain(fns().collectUnseenNotes('1.41', '1.42', { '1.42': {} }));
  assert.deepEqual(out, [{ version: '1.42', features: [], fixes: [] }]);
});

// ─── buildSplashContent ────────────────────────────────────────────

test('buildSplashContent renders a version heading with feature and fix sections', () => {
  const { document, internals } = loadScript();
  const el = internals.buildSplashContent(document, [
    { version: '1.42', features: ['feat one'], fixes: ['fix one'] },
  ]);
  assert.equal(el.className, 'us-notes');
  assert.equal(el.querySelector('.us-version-heading').textContent, 'v1.42');
  const titles = [...el.querySelectorAll('.us-section-title')].map(t => t.textContent);
  assert.deepEqual(titles, ['✨ New', '🐛 Fixed']);
  const items = [...el.querySelectorAll('.us-note-list li')].map(li => li.textContent);
  assert.deepEqual(items, ['feat one', 'fix one']);
});

test('buildSplashContent omits empty sections', () => {
  const { document, internals } = loadScript();
  const el = internals.buildSplashContent(document, [
    { version: '1.42', features: ['only feature'], fixes: [] },
  ]);
  const titles = [...el.querySelectorAll('.us-section-title')].map(t => t.textContent);
  assert.deepEqual(titles, ['✨ New']);
  assert.equal(el.querySelectorAll('.us-note-list').length, 1);
});

test('buildSplashContent renders note text containing <script> inert as text', () => {
  const { document, internals } = loadScript();
  const el = internals.buildSplashContent(document, [
    { version: '1.42', features: ['<script>alert(1)</script>'], fixes: [] },
  ]);
  assert.equal(el.querySelectorAll('script').length, 0);
  assert.equal(el.querySelector('.us-note-list li').textContent, '<script>alert(1)</script>');
});

test('buildSplashContent renders one block per entry, in the given order', () => {
  const { document, internals } = loadScript();
  const el = internals.buildSplashContent(document, [
    { version: '1.43', features: [], fixes: ['x'] },
    { version: '1.42', features: ['y'], fixes: [] },
  ]);
  const headings = [...el.querySelectorAll('.us-version-block > .us-version-heading')].map(h => h.textContent);
  assert.deepEqual(headings, ['v1.43', 'v1.42']);
});

// ─── maybeShowUpdateSplash (runs during script load) ───────────────

test('first install: last-seen is seeded to the current version and no splash is shown', () => {
  const { window, document } = loadScript({ version: CURRENT, localStorage: ONBOARDING_SEEN });
  assert.equal(lastSeen(window), CURRENT);
  assert.equal(splash(document), null);
});

test('opted out: last-seen advances silently and no splash is shown', () => {
  const { window, document } = loadScript({
    version: CURRENT,
    localStorage: ONBOARDING_SEEN,
    gmValues: { bb_last_seen_version: '1.40', bb_update_news_optout: true },
  });
  assert.equal(lastSeen(window), CURRENT);
  assert.equal(splash(document), null);
});

test('first-run onboarding overlay open: splash is suppressed and last-seen advances', () => {
  // No betterBee_onboardingSeen in localStorage → the welcome overlay opens first.
  const { window, document, internals } = loadScript({
    version: CURRENT,
    gmValues: { bb_last_seen_version: '1.40' },
  });
  assert.equal(internals.onboardingActive, true);
  assert.ok(document.querySelector('.ob-overlay'), 'welcome overlay present');
  assert.equal(splash(document), null, 'update splash must not stack on the welcome overlay');
  assert.equal(lastSeen(window), CURRENT);
});

test('no unseen notes (last-seen == current): last-seen stays current and no splash is shown', () => {
  const { window, document } = loadScript({
    version: CURRENT,
    localStorage: ONBOARDING_SEEN,
    gmValues: { bb_last_seen_version: CURRENT },
  });
  assert.equal(lastSeen(window), CURRENT);
  assert.equal(splash(document), null);
});

test('versions skipped but none of them noted: last-seen advances and no splash is shown', () => {
  // RELEASE_NOTES starts at 1.42, so 1.40 → 1.41 has nothing to announce.
  const { window, document } = loadScript({
    version: '1.41',
    localStorage: ONBOARDING_SEEN,
    gmValues: { bb_last_seen_version: '1.40' },
  });
  assert.equal(lastSeen(window), '1.41');
  assert.equal(splash(document), null);
});

test('unseen notes present: splash is built with the newest version in its title, seen-on-render', () => {
  const { window, document, internals } = loadScript({
    version: CURRENT,
    localStorage: ONBOARDING_SEEN,
    gmValues: { bb_last_seen_version: '0' },
  });
  const overlay = splash(document);
  assert.ok(overlay, 'update splash overlay exists');
  assert.equal(overlay.getAttribute('role'), 'dialog');
  const headings = [...overlay.querySelectorAll('.us-version-heading')].map(h => h.textContent);
  assert.ok(headings.length >= 1, 'at least one noted version rendered');
  assert.equal(overlay.querySelector('.ob-title').textContent, `Better Bee updated — ${headings[0]}`);
  const versions = headings.map(h => h.slice(1));
  for (const v of versions) assert.ok(internals.compareVersions(v, CURRENT) <= 0, `${v} <= ${CURRENT}`);
  for (let i = 1; i < versions.length; i++) {
    assert.equal(internals.compareVersions(versions[i - 1], versions[i]), 1, 'newest first');
  }
  // Not yet marked seen: that happens when the panel actually renders.
  assert.equal(overlay.style.display, 'none');
  assert.equal(lastSeen(window), '0');
  assert.equal(internals.onboardingActive, false);
});

test('unseen notes present: once the puzzle DOM is ready the splash renders and marks the version seen', async () => {
  const { window, document, internals } = loadScript({
    version: CURRENT,
    html: '<body><div class="sb-hive-input-content"></div></body>',
    localStorage: ONBOARDING_SEEN,
    gmValues: { bb_last_seen_version: '0' },
  });
  const overlay = splash(document);
  assert.equal(overlay.style.display, 'none');
  // 200ms poll for the hive input + 500ms settle + a rAF (stubbed at 16ms).
  await sleep(850);
  assert.equal(overlay.style.display, 'flex');
  assert.ok(overlay.classList.contains('we-visible'));
  assert.equal(lastSeen(window), CURRENT);
  assert.equal(internals.onboardingActive, true, 'splash counts as an open overlay');

  overlay.querySelector('.ob-cta').click();
  assert.equal(internals.onboardingActive, false);
  assert.ok(!overlay.classList.contains('we-visible'));
});
