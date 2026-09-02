import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, wordListHtml, versionFromHeader } from './harness.mjs';

test('on the Spelling Bee page the script hands its internals to __bbInternals', () => {
  const { internals } = loadScript();
  assert.ok(internals, 'internals object was not delivered');
  assert.equal(typeof internals.classifyMessage, 'function');
  assert.equal(typeof internals.nextHint, 'function');
});

test('on the Spelling Bee page the script injects its UI and menu commands', () => {
  const { document, window } = loadScript();
  assert.equal(document.querySelectorAll('.we-hint-toast').length, 1);
  assert.equal(document.querySelectorAll('.we-tooltip').length, 1);
  assert.deepEqual([...window.__gmMenu], [
    'Set Dictionary API Key',
    'Clear Dictionary API Key',
    'Update news: On — click to disable',
    'Preview update news',
  ]);
});

test('on a non-Bee nytimes page only Module 1 runs and no internals are exposed', () => {
  const { internals, document } = loadScript({ url: 'https://www.nytimes.com/crosswords' });
  assert.equal(internals, undefined);
  assert.equal(document.querySelectorAll('.we-hint-toast').length, 0);
});

test('a word already in the list is decorated at load', () => {
  const { document } = loadScript({ html: `<body>${wordListHtml(['hello'])}</body>` });
  assert.equal(document.querySelector('li').dataset.weProcessed, '1');
});

test('GM_info reports the @version from the header', () => {
  const { window } = loadScript();
  assert.equal(window.GM_info.script.version, versionFromHeader());
  assert.match(window.GM_info.script.version, /^\d+\.\d+$/);
});
