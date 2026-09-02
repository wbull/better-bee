// Pure decision pieces extracted from the shared MutationObserver callback.
//   resolveCapturedWord(directRead, lastInputText)  — t0: which word did the player submit?
//   planMessageReaction({ text, armed })            — t0+100: emoji type + got-it / release
//   collectMessageNodes(node)                       — which added nodes are NYT messages?
//   computeTileStates(input, word, tileCount)       — hint tiles for the current hive input
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, plain } from './harness.mjs';

const fns = () => loadScript().internals;

// ─── resolveCapturedWord ────────────────────────────────────────────

test('a direct read of 4+ letters wins over the tracked input', () => {
  assert.equal(fns().resolveCapturedWord('crackle', 'batch'), 'crackle');
});
test('a short direct read falls back to the tracked input (NYT may have cleared the hive)', () => {
  assert.equal(fns().resolveCapturedWord('abc', 'batch'), 'batch');
  assert.equal(fns().resolveCapturedWord('', 'batch'), 'batch');
});
test('exactly MIN_WORD_LENGTH letters counts as a direct read', () => {
  assert.equal(fns().resolveCapturedWord('heel', 'other'), 'heel');
});

// ─── planMessageReaction ────────────────────────────────────────────

test('success while armed → success emoji, got it, no release', () => {
  assert.deepEqual(plain(fns().planMessageReaction({ text: 'Nice!', armed: true })),
    { emojiType: 'success', gotIt: true, release: false });
});
test('duplicate while armed → duplicate emoji, no got it, release the guard', () => {
  assert.deepEqual(plain(fns().planMessageReaction({ text: 'Already found', armed: true })),
    { emojiType: 'duplicate', gotIt: false, release: true });
});
test('error while not armed → error emoji, neither flag', () => {
  assert.deepEqual(plain(fns().planMessageReaction({ text: 'Not in word list', armed: false })),
    { emojiType: 'error', gotIt: false, release: false });
});
test('success while not armed → emoji only', () => {
  assert.deepEqual(plain(fns().planMessageReaction({ text: 'Pangram!', armed: false })),
    { emojiType: 'success', gotIt: false, release: false });
});
test('unclassifiable message while armed → no emoji but the guard is still released', () => {
  assert.deepEqual(plain(fns().planMessageReaction({ text: '', armed: true })),
    { emojiType: null, gotIt: false, release: true });
  assert.deepEqual(plain(fns().planMessageReaction({ text: undefined, armed: true })),
    { emojiType: null, gotIt: false, release: true });
});

// ─── collectMessageNodes ────────────────────────────────────────────

test('collects the node itself when it is a message', () => {
  const { internals, document } = loadScript();
  const n = document.createElement('div');
  n.className = 'sb-message';
  assert.deepEqual([...internals.collectMessageNodes(n)], [n]);
});
test('collects descendant messages, and the node itself first when both apply', () => {
  const { internals, document } = loadScript();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<p></p><div class="sb-message" id="a"></div><span><div class="sb-message" id="b"></div></span>';
  assert.deepEqual([...internals.collectMessageNodes(wrap)].map(e => e.id), ['a', 'b']);
  wrap.className = 'sb-message';
  assert.deepEqual([...internals.collectMessageNodes(wrap)].map(e => e.id || 'self'), ['self', 'a', 'b']);
});
test('returns an empty array for non-elements and elements without messages', () => {
  const { internals, document } = loadScript();
  assert.deepEqual([...internals.collectMessageNodes(document.createTextNode('x'))], []);
  assert.deepEqual([...internals.collectMessageNodes(document.createElement('div'))], []);
});

// ─── computeTileStates ──────────────────────────────────────────────

test('no input: first two tiles show the hint prefix, the rest are empty', () => {
  assert.deepEqual(plain(fns().computeTileStates('', 'heel', 4)), [
    { text: 'H', className: 'we-hint-tile hint' },
    { text: 'E', className: 'we-hint-tile hint' },
    { text: '', className: 'we-hint-tile empty' },
    { text: '', className: 'we-hint-tile empty' },
  ]);
});
test('typed letters fill in order: prefix tiles become filled, later ones typed', () => {
  assert.deepEqual(plain(fns().computeTileStates('hee', 'heel', 4)), [
    { text: 'H', className: 'we-hint-tile filled' },
    { text: 'E', className: 'we-hint-tile filled' },
    { text: 'E', className: 'we-hint-tile typed' },
    { text: '', className: 'we-hint-tile empty' },
  ]);
});
test('input is upper-cased and may exceed the tile count without error', () => {
  const states = plain(fns().computeTileStates('heelxx', 'heel', 4));
  assert.equal(states.length, 4);
  assert.deepEqual(states.map(s => s.text), ['H', 'E', 'E', 'L']);
});
test('a typed letter that differs from the hint is shown as typed, not corrected', () => {
  assert.deepEqual(plain(fns().computeTileStates('x', 'heel', 4))[0], { text: 'X', className: 'we-hint-tile filled' });
});
test('handles null input and a missing word', () => {
  assert.deepEqual(plain(fns().computeTileStates(null, undefined, 2)), [
    { text: '', className: 'we-hint-tile hint' },
    { text: '', className: 'we-hint-tile hint' },
  ]);
});
