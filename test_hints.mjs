// Unit tests for hint matching logic extracted from better_bee.user.js
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// ─── Extract pure functions ─────────────────────────────────────────

function classifyMessage(text) {
  if (!text) return null;
  text = text.toLowerCase();
  if (/already\s*found/.test(text) || text.includes('already') || text.includes('found it')) {
    return 'duplicate';
  }
  if (/^(nice|great|awesome|good|solid|amazing|wonderful|excellent|genius|pangram|queen bee)/.test(text)) {
    return 'success';
  }
  return 'error';
}

function currentHintMatches(word, hintQueue, hintIndex) {
  if (!word || hintIndex === 0 || hintIndex > hintQueue.length) return false;
  const entry = hintQueue[hintIndex - 1];
  // Exact word match (more reliable)
  if (entry.word && word.toLowerCase() === entry.word) return true;
  // Fallback: prefix + length match
  const prefix = entry.hint.slice(0, 2);
  const len = parseInt(entry.hint.split(' ').pop(), 10);
  const upper = word.toUpperCase();
  return upper.length === len && upper.startsWith(prefix);
}

function getLastFoundWord(document) {
  const recent = document.querySelector('.sb-recent-words li');
  if (recent) return recent.textContent.trim();
  const items = document.querySelectorAll('.sb-wordlist-items-pag li');
  if (items.length > 0) return items[items.length - 1].textContent.trim();
  return '';
}

// ─── Tests ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${e.message}`);
  }
}

// --- classifyMessage ---
console.log('\nclassifyMessage:');

test('returns success for "Nice!"', () => {
  assert.strictEqual(classifyMessage('Nice!'), 'success');
});
test('returns success for "Pangram!"', () => {
  assert.strictEqual(classifyMessage('Pangram!'), 'success');
});
test('returns success for "Genius"', () => {
  assert.strictEqual(classifyMessage('Genius'), 'success');
});
test('returns duplicate for "Already found"', () => {
  assert.strictEqual(classifyMessage('Already found'), 'duplicate');
});
test('returns error for "Not in word list"', () => {
  assert.strictEqual(classifyMessage('Not in word list'), 'error');
});
test('returns null for empty string', () => {
  assert.strictEqual(classifyMessage(''), null);
});

// --- currentHintMatches ---
console.log('\ncurrentHintMatches:');

const queue = [
  { word: 'batch', hint: 'BA.. 5' },
  { word: 'crackle', hint: 'CR.. 7' },
  { word: 'ambl', hint: 'AM.. 4' },
];

test('matches correct word via exact word match', () => {
  assert.strictEqual(currentHintMatches('batch', queue, 1), true);
});
test('matches via exact word match (case insensitive)', () => {
  assert.strictEqual(currentHintMatches('BATCH', queue, 1), true);
});
test('rejects wrong word entirely', () => {
  assert.strictEqual(currentHintMatches('catch', queue, 1), false);
});
test('matches "crackle" for second entry', () => {
  assert.strictEqual(currentHintMatches('crackle', queue, 2), true);
});
test('returns false when hintIndex is 0', () => {
  assert.strictEqual(currentHintMatches('batch', queue, 0), false);
});
test('returns false for empty word', () => {
  assert.strictEqual(currentHintMatches('', queue, 1), false);
});
test('returns false when hintIndex exceeds queue', () => {
  assert.strictEqual(currentHintMatches('batch', queue, 5), false);
});

// Fallback prefix+length tests (entry without word field)
console.log('\ncurrentHintMatches (prefix+length fallback):');

const fallbackQueue = [
  { hint: 'BA.. 5' },
  { hint: 'CR.. 7' },
];

test('fallback matches prefix+length when no word field', () => {
  assert.strictEqual(currentHintMatches('batch', fallbackQueue, 1), true);
});
test('fallback rejects wrong length', () => {
  assert.strictEqual(currentHintMatches('bat', fallbackQueue, 1), false);
});
test('fallback rejects wrong prefix', () => {
  assert.strictEqual(currentHintMatches('catch', fallbackQueue, 1), false);
});

// --- getLastFoundWord (DOM) ---
console.log('\ngetLastFoundWord:');

test('reads from .sb-recent-words first', () => {
  const dom = new JSDOM(`
    <ul class="sb-recent-words"><li>amble</li><li>batch</li></ul>
    <ul class="sb-wordlist-items-pag"><li>alpha</li><li>zebra</li></ul>
  `);
  assert.strictEqual(getLastFoundWord(dom.window.document), 'amble');
});

test('falls back to paginated list when no recent words', () => {
  const dom = new JSDOM(`
    <ul class="sb-wordlist-items-pag"><li>alpha</li><li>zebra</li></ul>
  `);
  assert.strictEqual(getLastFoundWord(dom.window.document), 'zebra');
});

test('returns empty string when no words in DOM', () => {
  const dom = new JSDOM(`<div></div>`);
  assert.strictEqual(getLastFoundWord(dom.window.document), '');
});

test('trims whitespace from word', () => {
  const dom = new JSDOM(`
    <ul class="sb-recent-words"><li>  amble  </li></ul>
  `);
  assert.strictEqual(getLastFoundWord(dom.window.document), 'amble');
});

// --- Integration: captured input approach ---
console.log('\nIntegration (captured input + hint match):');

test('captured input matches hint on success', () => {
  const capturedWord = 'colic';
  const type = classifyMessage('Nice!');
  assert.strictEqual(type, 'success');
  assert.strictEqual(currentHintMatches(capturedWord, [{ word: 'colic', hint: 'CO.. 5' }], 1), true);
});

test('captured input does not match different hint', () => {
  const capturedWord = 'colic';
  const type = classifyMessage('Great!');
  assert.strictEqual(type, 'success');
  assert.strictEqual(currentHintMatches(capturedWord, [{ word: 'batch', hint: 'BA.. 5' }], 1), false);
});

test('captured input works even when DOM has no words yet', () => {
  const capturedWord = 'batch';
  assert.strictEqual(currentHintMatches(capturedWord, [{ word: 'batch', hint: 'BA.. 5' }], 1), true);
});

// --- getLastFoundWord still works as fallback ---
console.log('\ngetLastFoundWord (fallback):');

test('full flow via DOM: recent words list', () => {
  const dom = new JSDOM(`
    <ul class="sb-recent-words"><li>batch</li><li>older</li></ul>
  `);
  const word = getLastFoundWord(dom.window.document);
  assert.strictEqual(word, 'batch');
  assert.strictEqual(currentHintMatches(word, [{ word: 'batch', hint: 'BA.. 5' }], 1), true);
});

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
