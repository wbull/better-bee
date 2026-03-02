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

// Injectable version of buildHintQueue for testing.
// NOTE: The production version includes a Fisher-Yates shuffle; it is
// removed here so that results are deterministic.
function buildHintQueue(getAnswersFn, getFoundWordsFn) {
  const answers = getAnswersFn();
  if (!answers) return null;
  const found = getFoundWordsFn();
  const remaining = answers.filter(w => !found.has(w.toLowerCase()));
  if (remaining.length === 0) return [];

  // Build hints: objects with word + display hint
  const hints = remaining.map(w => ({
    word: w.toLowerCase(),
    hint: w.toUpperCase().slice(0, 2) + '.. ' + w.length,
  }));

  return hints;
}

console.log('\nbuildHintQueue:');

test('Returns null when answers is null', () => {
  const result = buildHintQueue(() => null, () => new Set());
  assert.strictEqual(result, null);
});

test('Returns [] when all words found', () => {
  const result = buildHintQueue(
    () => ['batch', 'crackle'],
    () => new Set(['batch', 'crackle'])
  );
  assert.deepStrictEqual(result, []);
});

test('Correct hint format {word, hint}', () => {
  const result = buildHintQueue(
    () => ['batch'],
    () => new Set()
  );
  assert.strictEqual(result[0].hint, 'BA.. 5');
  assert.strictEqual(result[0].word, 'batch');
});

test('Excludes already-found words', () => {
  const result = buildHintQueue(
    () => ['batch', 'crackle', 'amble'],
    () => new Set(['batch'])
  );
  assert.strictEqual(result.length, 2);
  // Should not contain hint for 'batch'
  assert.ok(!result.some(h => h.word === 'batch'));
});

test('All hints match regex ^[A-Z]{2}\\.\\.\\s\\d+$', () => {
  const result = buildHintQueue(
    () => ['batch', 'crackle', 'amble', 'xenophobe'],
    () => new Set()
  );
  const pattern = /^[A-Z]{2}\.\. \d+$/;
  for (const entry of result) {
    assert.ok(pattern.test(entry.hint), `"${entry.hint}" doesn't match pattern`);
  }
});

test('Queue length = answers.length - found.length', () => {
  const result = buildHintQueue(
    () => ['batch', 'crackle', 'amble', 'xenophobe'],
    () => new Set(['batch', 'amble'])
  );
  assert.strictEqual(result.length, 2);
});

test('word field is lowercase', () => {
  const result = buildHintQueue(
    () => ['BATCH', 'Crackle'],
    () => new Set()
  );
  assert.strictEqual(result[0].word, 'batch');
  assert.strictEqual(result[1].word, 'crackle');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
