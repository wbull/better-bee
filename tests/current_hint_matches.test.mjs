// hints.matches(word): does the typed word satisfy the hint currently on screen?
// Exact-word first, then the prefix + length fallback the on-screen hint implies.
// A controller is built with fakes and walked to the k-th hint; answers are kept
// in order by a non-shuffling RNG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const noopUi = new Proxy({ isClueExpanded: () => false }, { get: (t, k) => t[k] ?? (() => {}) });

function atHint(answers, k = 1) {
  const { internals } = loadScript();
  const timers = makeFakeTimers();
  const hints = internals.createHintController({
    getAnswers: () => answers,
    getFoundWords: () => new Set(),
    getPuzzleId: () => 1,
    fetchClueData: () => Promise.resolve(null),
    ui: noopUi,
    setTimeout: timers.setTimeout,
    random: () => 0.999,
  });
  if (k >= 1) { hints.start(); timers.advance(450); }
  for (let i = 1; i < k; i++) hints.next();
  return hints;
}

const QUEUE = ['batch', 'crackle', 'ambl'];

// --- exact word match ---
test('matches correct word via exact word match', () => {
  assert.equal(atHint(QUEUE).matches('batch'), true);
});
test('matches via exact word match (case insensitive)', () => {
  assert.equal(atHint(QUEUE).matches('BATCH'), true);
});
test('rejects wrong word entirely', () => {
  assert.equal(atHint(QUEUE).matches('catch'), false);
});
test('matches "crackle" for second entry', () => {
  assert.equal(atHint(QUEUE, 2).matches('crackle'), true);
});
test('the previous hint no longer matches once the queue advanced', () => {
  assert.equal(atHint(QUEUE, 2).matches('batch'), false);
});

// --- guards ---
test('returns false before any hint has been shown', () => {
  assert.equal(atHint(QUEUE, 0).matches('batch'), false);
});
test('returns false for empty word', () => {
  assert.equal(atHint(QUEUE).matches(''), false);
});
test('null word returns false', () => {
  assert.equal(atHint(QUEUE).matches(null), false);
});
test('undefined word returns false', () => {
  assert.equal(atHint(QUEUE).matches(undefined), false);
});

// --- prefix + length fallback (word differs from the answer but fits the hint) ---
test('fallback matches prefix+length', () => {
  assert.equal(atHint(['batch']).matches('baton'), true);
});
test('fallback rejects wrong length', () => {
  assert.equal(atHint(['batch']).matches('bat'), false);
});
test('fallback rejects wrong prefix', () => {
  assert.equal(atHint(['batch']).matches('catch'), false);
});
test('"ba" is too short for a "BA.. 5" hint', () => {
  assert.equal(atHint(['batch']).matches('ba'), false);
});
test('exact boundary match: word length matches hint exactly', () => {
  assert.equal(atHint(['batch']).matches('baker'), true);
});
test('three-letter hint "XY.. 3" accepts "xyz"', () => {
  assert.equal(atHint(['xyq']).matches('xyz'), true);
});

// --- captured input + hint match (was "Integration" in test_hints.mjs) ---
test('captured input matches hint on success', () => {
  const { internals } = loadScript();
  assert.equal(internals.classifyMessage('Nice!'), 'success');
  assert.equal(atHint(['colic']).matches('colic'), true);
});
test('captured input does not match different hint', () => {
  const { internals } = loadScript();
  assert.equal(internals.classifyMessage('Great!'), 'success');
  assert.equal(atHint(['batch']).matches('colic'), false);
});
test('captured input works even when DOM has no words yet', () => {
  const { document } = loadScript();
  assert.equal(document.querySelectorAll('.sb-wordlist-items-pag li').length, 0);
  assert.equal(atHint(['batch']).matches('batch'), true);
});
