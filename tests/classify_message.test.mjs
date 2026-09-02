// Migrated from test_hints.mjs and test_pure_edge_cases.mjs: classifyMessage is the
// real function from better_bee.user.js, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';

const classify = text => loadScript().internals.classifyMessage(text);

// --- success ---
test('returns success for "Nice!"', () => {
  assert.equal(classify('Nice!'), 'success');
});
test('returns success for "Pangram!"', () => {
  assert.equal(classify('Pangram!'), 'success');
});
test('returns success for "Genius"', () => {
  assert.equal(classify('Genius'), 'success');
});
test('"Queen Bee!" returns success (case insensitive)', () => {
  assert.equal(classify('Queen Bee!'), 'success');
});
test('"NICE!" returns success (case insensitive)', () => {
  assert.equal(classify('NICE!'), 'success');
});

// --- duplicate ---
test('returns duplicate for "Already found"', () => {
  assert.equal(classify('Already found'), 'duplicate');
});
test('"found it" returns duplicate', () => {
  assert.equal(classify('found it'), 'duplicate');
});
test('"already" alone returns duplicate', () => {
  assert.equal(classify('already'), 'duplicate');
});
test('"already FOUND" returns duplicate', () => {
  assert.equal(classify('already FOUND'), 'duplicate');
});

// --- error ---
test('returns error for "Not in word list"', () => {
  assert.equal(classify('Not in word list'), 'error');
});
test('"Too short" returns error', () => {
  assert.equal(classify('Too short'), 'error');
});

// --- empty / missing input ---
test('returns null for empty string', () => {
  assert.equal(classify(''), null);
});
test('null returns null', () => {
  assert.equal(classify(null), null);
});
test('undefined returns null', () => {
  assert.equal(classify(undefined), null);
});
