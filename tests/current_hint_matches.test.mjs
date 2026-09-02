// Migrated from test_hints.mjs and test_pure_edge_cases.mjs. The legacy copy took
// (word, hintQueue, hintIndex); the real function reads the hoisted hintQueue /
// hintIndex, so each case seeds them through internals.hintState first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';

function matches(word, hintQueue, hintIndex) {
  const { internals } = loadScript();
  internals.hintState = { hintQueue, hintIndex };
  return internals.currentHintMatches(word);
}

const queue = [
  { word: 'batch', hint: 'BA.. 5' },
  { word: 'crackle', hint: 'CR.. 7' },
  { word: 'ambl', hint: 'AM.. 4' },
];

// --- exact word match ---
test('matches correct word via exact word match', () => {
  assert.equal(matches('batch', queue, 1), true);
});
test('matches via exact word match (case insensitive)', () => {
  assert.equal(matches('BATCH', queue, 1), true);
});
test('rejects wrong word entirely', () => {
  assert.equal(matches('catch', queue, 1), false);
});
test('matches "crackle" for second entry', () => {
  assert.equal(matches('crackle', queue, 2), true);
});

// --- guards ---
test('returns false when hintIndex is 0', () => {
  assert.equal(matches('batch', queue, 0), false);
});
test('returns false for empty word', () => {
  assert.equal(matches('', queue, 1), false);
});
test('returns false when hintIndex exceeds queue', () => {
  assert.equal(matches('batch', queue, 5), false);
});
test('null word returns false', () => {
  assert.equal(matches(null, [{ hint: 'BA.. 5' }], 1), false);
});
test('undefined word returns false', () => {
  assert.equal(matches(undefined, [{ hint: 'BA.. 5' }], 1), false);
});

// --- prefix + length fallback (entries without a word field) ---
const fallbackQueue = [
  { hint: 'BA.. 5' },
  { hint: 'CR.. 7' },
];

test('fallback matches prefix+length when no word field', () => {
  assert.equal(matches('batch', fallbackQueue, 1), true);
});
test('fallback rejects wrong length', () => {
  assert.equal(matches('bat', fallbackQueue, 1), false);
});
test('fallback rejects wrong prefix', () => {
  assert.equal(matches('catch', fallbackQueue, 1), false);
});
test('"ba" is too short for "BA.. 5" hint', () => {
  assert.equal(matches('ba', [{ hint: 'BA.. 5' }], 1), false);
});
test('exact boundary match: word length matches hint exactly', () => {
  assert.equal(matches('baker', [{ hint: 'BA.. 5' }], 1), true);
});
test('single-hint queue with matching word "xyz" at index 1', () => {
  assert.equal(matches('xyz', [{ hint: 'XY.. 3' }], 1), true);
});

// --- captured input + hint match (was "Integration" in test_hints.mjs) ---
test('captured input matches hint on success', () => {
  const { internals } = loadScript();
  assert.equal(internals.classifyMessage('Nice!'), 'success');
  internals.hintState = { hintQueue: [{ word: 'colic', hint: 'CO.. 5' }], hintIndex: 1 };
  assert.equal(internals.currentHintMatches('colic'), true);
});
test('captured input does not match different hint', () => {
  const { internals } = loadScript();
  assert.equal(internals.classifyMessage('Great!'), 'success');
  internals.hintState = { hintQueue: [{ word: 'batch', hint: 'BA.. 5' }], hintIndex: 1 };
  assert.equal(internals.currentHintMatches('colic'), false);
});
test('captured input works even when DOM has no words yet', () => {
  const { internals, document } = loadScript();
  assert.equal(document.querySelectorAll('.sb-wordlist-items-pag li').length, 0);
  internals.hintState = { hintQueue: [{ word: 'batch', hint: 'BA.. 5' }], hintIndex: 1 };
  assert.equal(internals.currentHintMatches('batch'), true);
});
