import assert from 'node:assert';

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

// ─── Extract pure functions from source ─────────────────────────────

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

// ─── Tests ──────────────────────────────────────────────────────────

console.log('\nescapeHTML:');

test('escapes <>&" characters', () => {
  assert.strictEqual(escapeHTML('<>&"'), '&lt;&gt;&amp;&quot;');
});

test('empty input returns empty string', () => {
  assert.strictEqual(escapeHTML(''), '');
});

test('safe strings pass through unchanged', () => {
  assert.strictEqual(escapeHTML('hello world'), 'hello world');
});

test('handles strings with multiple special chars like script tags', () => {
  assert.strictEqual(
    escapeHTML('<script>alert("xss")</script>'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
  );
});

console.log('\nclassifyMessage:');

test('"found it" returns duplicate', () => {
  assert.strictEqual(classifyMessage('found it'), 'duplicate');
});

test('"Queen Bee!" returns success (case insensitive)', () => {
  assert.strictEqual(classifyMessage('Queen Bee!'), 'success');
});

test('"already" alone returns duplicate', () => {
  assert.strictEqual(classifyMessage('already'), 'duplicate');
});

test('"NICE!" returns success (case insensitive)', () => {
  assert.strictEqual(classifyMessage('NICE!'), 'success');
});

test('"already FOUND" returns duplicate', () => {
  assert.strictEqual(classifyMessage('already FOUND'), 'duplicate');
});

test('"Too short" returns error', () => {
  assert.strictEqual(classifyMessage('Too short'), 'error');
});

test('null returns null', () => {
  assert.strictEqual(classifyMessage(null), null);
});

test('undefined returns null', () => {
  assert.strictEqual(classifyMessage(undefined), null);
});

console.log('\ncurrentHintMatches:');

test('"ba" is too short for "BA.. 5" hint', () => {
  assert.strictEqual(currentHintMatches('ba', [{ hint: 'BA.. 5' }], 1), false);
});

test('exact boundary match: word length matches hint exactly', () => {
  assert.strictEqual(currentHintMatches('baker', [{ hint: 'BA.. 5' }], 1), true);
});

test('null word returns false', () => {
  assert.strictEqual(currentHintMatches(null, [{ hint: 'BA.. 5' }], 1), false);
});

test('undefined word returns false', () => {
  assert.strictEqual(currentHintMatches(undefined, [{ hint: 'BA.. 5' }], 1), false);
});

test('single-hint queue with matching word "xyz" at index 1', () => {
  assert.strictEqual(currentHintMatches('xyz', [{ hint: 'XY.. 3' }], 1), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
