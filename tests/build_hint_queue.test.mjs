import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, wordListHtml, FIXTURE_GAME, plain } from './harness.mjs';

const ALL = FIXTURE_GAME.today.answers;
const words = q => plain(q).map(e => e.word);

function boot({ found = [], gameData = FIXTURE_GAME, random } = {}) {
  const ctx = loadScript({ gameData, html: `<body>${wordListHtml(found)}</body>` });
  if (random) ctx.window.Math.random = random;
  return ctx;
}

test('returns null when the puzzle data is missing', () => {
  const { internals } = boot({ gameData: {} });
  assert.equal(internals.buildHintQueue(), null);
});

test('returns an empty queue when every answer is already found', () => {
  const { internals } = boot({ found: ALL });
  assert.deepEqual(plain(internals.buildHintQueue()), []);
});

test('excludes found words case-insensitively and shapes each entry as word + hint', () => {
  const { internals } = boot({ found: ['HELLO', 'Other'], random: () => 0.999 });
  const q = internals.buildHintQueue();
  assert.deepEqual(words(q), ['heel', 'relate', 'tether', 'theater']);
  assert.deepEqual(plain(q[0]), { word: 'heel', hint: 'HE.. 4' });
});

test('is a permutation of the unfound answers', () => {
  const { internals } = boot();
  const q = internals.buildHintQueue();
  assert.deepEqual([...words(q)].sort(), [...ALL].sort());
});

test('actually shuffles: a zero RNG walks the Fisher-Yates swaps deterministically', () => {
  const { internals } = boot({ random: () => 0 });
  // j = 0 on every pass: i=5..1 each swap with slot 0.
  assert.deepEqual(words(internals.buildHintQueue()), ['hello', 'other', 'relate', 'tether', 'theater', 'heel']);
});

test('a new puzzle id drops the clue cache and in-flight clue fetch', () => {
  const { internals } = boot();
  internals.hintState = { lastPuzzleId: 1, clueCache: new Map([['x', {}]]), cluePromise: Promise.resolve(null) };
  internals.buildHintQueue();
  const s = internals.hintState;
  assert.equal(s.lastPuzzleId, FIXTURE_GAME.today.id);
  assert.equal(s.clueCache, null);
  assert.equal(s.cluePromise, null);
});

test('the same puzzle id keeps the clue cache', () => {
  const { internals } = boot();
  const cache = new Map([['x', {}]]);
  internals.hintState = { lastPuzzleId: FIXTURE_GAME.today.id, clueCache: cache };
  internals.buildHintQueue();
  assert.equal(internals.hintState.clueCache, cache);
});
