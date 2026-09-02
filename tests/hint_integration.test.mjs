// End-to-end through the real page wiring: keyboard shortcuts → live `hints`
// controller → hintUi → toast / bee DOM, with the clue feed served by a fake
// GM_xmlhttpRequest and every timer under the fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, wordListHtml, FIXTURE_GAME } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const CLUES = [{ word: 'heel', text: 'Back of the foot', user: 'Ann' }];

function page({ found = [], clues = CLUES, gameData = FIXTURE_GAME } = {}) {
  const timers = makeFakeTimers();
  const gmXhrImpl = o => {
    if (/\/clues\/\d+\.json$/.test(o.url) && clues) o.onload({ status: 200, responseText: JSON.stringify(clues) });
    else o.onerror(new Error('no route'));
  };
  // Math.random is captured into the controller's deps at load, so it must be
  // replaced before the script runs: onWindow keeps the queue in answer order.
  const ctx = loadScript({
    timers, gameData, gmXhrImpl,
    html: `<body>${wordListHtml(found)}</body>`,
    onWindow: w => { w.Math.random = () => 0.999; },
  });
  const key = (k, opts = {}) => ctx.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  const el = ctx.internals.elements;
  return { ...ctx, timers, key, flush, el, bee: ctx.document.getElementById('bee-buddy') };
}

test('"?" starts hints: bee exits, first hint toast appears at +450ms', () => {
  const p = page();
  assert.equal(p.key('?'), false, 'keydown should be preventDefault-ed');
  assert.equal(p.internals.hints.state.active, true);
  assert.ok(p.bee.classList.contains('we-exiting'));
  assert.ok(!p.el.hintToast.classList.contains('we-visible'));
  p.timers.advance(450);
  assert.ok(p.el.hintToast.classList.contains('we-visible'));
  assert.equal(p.el.hintTiles.textContent, 'HE');
  assert.equal(p.el.hintTiles.querySelectorAll('.we-hint-tile').length, 4);
  p.timers.advance(150);
  assert.ok(p.bee.classList.contains('we-exited'));
});

test('"?" again advances to the next hint', () => {
  const p = page();
  p.key('?'); p.timers.advance(450);
  p.key('?');
  assert.equal(p.el.hintTiles.textContent, 'HE'); // hello
  assert.equal(p.internals.hints.state.index, 2);
  p.key('?');
  assert.equal(p.el.hintTiles.textContent, 'OT');
});

test('modifier keys are ignored', () => {
  const p = page();
  p.key('?', { ctrlKey: true });
  p.key('?', { metaKey: true });
  assert.equal(p.internals.hints.state.active, false);
});

test('"." expands the clue for the current hint, "." again collapses', async () => {
  const p = page();
  p.key('?'); p.timers.advance(450);
  await p.flush(); // clue prefetch from start() settles
  assert.equal(p.key('.'), false);
  assert.ok(p.el.hintToast.classList.contains('we-expanded'));
  await p.flush();
  assert.equal(p.el.hintToastClue.textContent, '“Back of the foot”Clue by Ann');
  assert.equal(p.el.hintToastClue.querySelector('.we-hint-toast-credit').textContent, 'Clue by Ann');
  p.key('.');
  assert.ok(!p.el.hintToast.classList.contains('we-expanded'));
});

test('"." shows the loading ellipsis immediately and "(no clue available)" when the feed has no entry', async () => {
  const p = page({ clues: [] });
  p.key('?'); p.timers.advance(450);
  p.key('.');
  assert.equal(p.el.hintToastClue.textContent, '…');
  await p.flush();
  assert.equal(p.el.hintToastClue.textContent, '(no clue available)');
});

test('"." does nothing while hints are inactive', () => {
  const p = page();
  assert.equal(p.key('.'), true); // not preventDefault-ed
  assert.ok(!p.el.hintToast.classList.contains('we-expanded'));
});

test('Escape stops hints: toast hides, bee resets now and returns at +400', () => {
  const p = page();
  p.key('?'); p.timers.advance(450);
  assert.equal(p.key('Escape'), false);
  assert.equal(p.internals.hints.state.active, false);
  assert.ok(!p.el.hintToast.classList.contains('we-visible'));
  assert.ok(!p.bee.classList.contains('we-exiting'));
  p.timers.advance(400);
  assert.ok(p.bee.classList.contains('we-returning'));
  p.bee.dispatchEvent(new p.window.Event('animationend'));
  assert.ok(p.bee.classList.contains('we-arrived'));
  assert.ok(!p.bee.classList.contains('we-returning'));
});

test('clicking the bee opens Bee Buddy only while hints are inactive', () => {
  const p = page();
  const opened = [];
  p.window.open = url => opened.push(url);
  p.bee.click();
  assert.equal(opened.length, 1);
  p.key('?');
  p.bee.click();
  assert.equal(opened.length, 1);
});

test('with every word found, "?" congratulates and never activates', () => {
  const p = page({ found: FIXTURE_GAME.today.answers });
  p.key('?');
  assert.equal(p.el.hintTiles.textContent, 'You found them all!');
  assert.equal(p.internals.hints.state.active, false);
  assert.ok(p.el.hintToast.classList.contains('we-visible'));
  p.timers.advance(3000);
  assert.ok(!p.el.hintToast.classList.contains('we-visible'));
});

test('with no puzzle data, "?" says hints are unavailable', () => {
  const p = page({ gameData: {} });
  p.key('?');
  assert.equal(p.el.hintTiles.textContent, 'Hints unavailable');
  assert.equal(p.internals.hints.state.active, false);
});

test('a successful NYT message for the hinted word runs the got-it sequence and advances', async () => {
  const p = page();
  const input = p.document.createElement('div');
  input.className = 'sb-hive-input-content';
  p.document.body.appendChild(input);
  p.key('?'); p.timers.advance(450);
  await p.flush(); // hookInputObserver retry runs from the main observer
  input.textContent = 'heel';
  await p.flush();
  const msg = p.document.createElement('div');
  msg.className = 'sb-message';
  msg.textContent = 'Nice!';
  p.document.body.appendChild(msg);
  await p.flush(); // MutationObserver delivery
  assert.equal(p.internals.hints.state.dismissing, true, 'guard armed at t0');
  p.timers.advance(100);
  assert.ok(p.el.hintToastCheck.classList.contains('we-visible'), 'check shown at +100');
  assert.equal(p.el.emojiEl.style.opacity, '1', 'emoji feedback shown');
  p.timers.advance(400);
  assert.ok(p.el.hintToast.classList.contains('we-got-it'));
  p.timers.advance(600);
  assert.ok(!p.el.hintToast.classList.contains('we-visible'), 'toast hidden at +1100');
  p.timers.advance(400);
  assert.equal(p.internals.hints.state.dismissing, false);
  assert.equal(p.internals.hints.state.index, 2, 'advanced to the next hint at +1500');
  assert.ok(p.el.hintToast.classList.contains('we-visible'));
});

test('a non-success message releases the guard without advancing', async () => {
  const p = page();
  const input = p.document.createElement('div');
  input.className = 'sb-hive-input-content';
  p.document.body.appendChild(input);
  p.key('?'); p.timers.advance(450);
  await p.flush();
  input.textContent = 'heel';
  await p.flush();
  const msg = p.document.createElement('div');
  msg.className = 'sb-message';
  msg.textContent = 'Already found';
  p.document.body.appendChild(msg);
  await p.flush();
  assert.equal(p.internals.hints.state.dismissing, true);
  p.timers.advance(100);
  assert.equal(p.internals.hints.state.dismissing, false);
  assert.equal(p.internals.hints.state.index, 1);
});

test('typing into the hive updates the tiles for the current hint', async () => {
  const p = page();
  const input = p.document.createElement('div');
  input.className = 'sb-hive-input-content';
  p.document.body.appendChild(input);
  p.key('?'); p.timers.advance(450);
  await p.flush();
  input.textContent = 'hee';
  await p.flush();
  const tiles = [...p.el.hintTiles.querySelectorAll('.we-hint-tile')];
  assert.deepEqual(tiles.map(t => t.textContent), ['H', 'E', 'E', '']);
  assert.deepEqual(tiles.map(t => t.className), [
    'we-hint-tile filled', 'we-hint-tile filled', 'we-hint-tile typed', 'we-hint-tile empty',
  ]);
});
