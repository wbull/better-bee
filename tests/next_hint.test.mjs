import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, wordListHtml, FIXTURE_GAME } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const ALL = FIXTURE_GAME.today.answers;
const entry = w => ({ word: w, hint: w.toUpperCase().slice(0, 2) + '.. ' + w.length });

// Boots the real script with hints already active and a chosen queue.
function activeHints({ queue, index = 0, found = [], gameData = FIXTURE_GAME, dismissing = false } = {}) {
  const timers = makeFakeTimers();
  const ctx = loadScript({ timers, gameData, html: `<body>${wordListHtml(found)}</body>` });
  ctx.window.Math.random = () => 0; // deterministic shuffle
  ctx.internals.hintState = { hintActive: true, hintQueue: queue, hintIndex: index, hintDismissing: dismissing };
  return { ...ctx, timers };
}
const toastText = ctx => ctx.internals.elements.hintTiles.textContent;
const toastVisible = ctx => ctx.internals.elements.hintToast.classList.contains('we-visible');
const state = ctx => ctx.internals.hintState;

test('does nothing while hints are inactive', () => {
  const ctx = activeHints({ queue: [entry('hello')] });
  ctx.internals.hintState = { hintActive: false };
  ctx.internals.nextHint();
  assert.equal(state(ctx).hintIndex, 0);
  assert.equal(toastVisible(ctx), false);
});

test('does nothing while a got-it dismissal is in progress', () => {
  const ctx = activeHints({ queue: [entry('hello')], dismissing: true });
  ctx.internals.nextHint();
  assert.equal(state(ctx).hintIndex, 0);
  assert.equal(toastVisible(ctx), false);
});

test('advances to the next entry and shows its first two letters', () => {
  const ctx = activeHints({ queue: [entry('hello'), entry('other')] });
  ctx.internals.nextHint();
  assert.equal(state(ctx).hintIndex, 1);
  assert.equal(toastText(ctx), 'HE');
  assert.equal(toastVisible(ctx), true);
  ctx.internals.nextHint();
  assert.equal(state(ctx).hintIndex, 2);
  assert.equal(toastText(ctx), 'OT');
});

test('skips queued words the player has found since the queue was built', () => {
  const ctx = activeHints({ queue: [entry('hello'), entry('other')], found: ['hello'] });
  ctx.internals.nextHint();
  assert.equal(toastText(ctx), 'OT');
  assert.equal(state(ctx).hintIndex, 2);
});

test('rebuilds the queue from the puzzle answers when it is exhausted', () => {
  const ctx = activeHints({ queue: [entry('hello')], index: 1 });
  ctx.internals.nextHint();
  assert.equal(state(ctx).hintQueue.length, ALL.length);
  assert.equal(state(ctx).hintIndex, 1);
  assert.equal(toastText(ctx).length, 2);
});

test('second pass: a queue of only found words rebuilds and shows an unfound one', () => {
  const found = ALL.filter(w => w !== 'theater');
  const ctx = activeHints({ queue: [entry('hello'), entry('heel')], found });
  ctx.internals.nextHint();
  assert.equal(toastText(ctx), 'TH');
  assert.equal(state(ctx).hintQueue.length, 1);
  assert.equal(state(ctx).hintActive, true);
});

test('with no puzzle data it says hints are unavailable and stops after exactly 3s', () => {
  const ctx = activeHints({ queue: [], gameData: {} });
  ctx.internals.nextHint();
  assert.equal(toastText(ctx), 'Hints unavailable');
  assert.equal(state(ctx).hintQueue, null);
  ctx.timers.advance(2999);
  assert.equal(state(ctx).hintActive, true);
  ctx.timers.advance(1);
  assert.equal(state(ctx).hintActive, false);
  assert.equal(toastVisible(ctx), false);
});

test('when every answer is found it congratulates and stops after 3s', () => {
  const ctx = activeHints({ queue: [], found: ALL });
  ctx.internals.nextHint();
  assert.equal(toastText(ctx), 'You found them all!');
  ctx.timers.advance(3000);
  assert.equal(state(ctx).hintActive, false);
});

test('when the rebuilt queue is exhausted on the second pass it congratulates and stops', () => {
  // Queue holds only found words; the rebuild (found = everything) is empty too.
  const ctx = activeHints({ queue: [entry('hello')], found: ALL });
  ctx.internals.nextHint();
  assert.equal(toastText(ctx), 'You found them all!');
  ctx.timers.advance(3000);
  assert.equal(state(ctx).hintActive, false);
});
