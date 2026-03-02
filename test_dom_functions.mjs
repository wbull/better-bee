import assert from 'node:assert';
import { JSDOM } from 'jsdom';

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

// --- Functions under test ---

function getFoundWords(document) {
  const found = new Set();
  const selectors = [
    '.sb-wordlist-items-pag li',
    '.sb-wordlist-window li',
    '.sb-recent-words li',
  ];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach(li => {
      const word = li.textContent.trim().toLowerCase();
      if (word) found.add(word);
    });
  }
  return found;
}

const MIN_WORD_LENGTH = 4;

function processWordList(document) {
  const selectors = [
    '.sb-wordlist-items-pag li',
    '.sb-wordlist-window li',
    '.sb-recent-words li',
  ];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach(li => {
      if (li.dataset.weProcessed) return;
      li.dataset.weProcessed = '1';

      const wordText = li.textContent.trim().toLowerCase();
      if (!wordText || wordText.length < MIN_WORD_LENGTH) return;

      li.classList.add('we-word');
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `Look up ${wordText}`);
      li.tabIndex = 0;
    });
  }
}

// --- Tests ---

console.log('\ngetFoundWords:');

test('collects from .sb-wordlist-items-pag li', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"><li>batch</li><li>crackle</li></ul>');
  const found = getFoundWords(dom.window.document);
  assert.ok(found.has('batch'));
  assert.ok(found.has('crackle'));
  assert.strictEqual(found.size, 2);
});

test('collects from .sb-recent-words li', () => {
  const dom = new JSDOM('<ul class="sb-recent-words"><li>amble</li></ul>');
  const found = getFoundWords(dom.window.document);
  assert.ok(found.has('amble'));
});

test('deduplicates across selectors', () => {
  const dom = new JSDOM(`
    <ul class="sb-wordlist-items-pag"><li>batch</li></ul>
    <ul class="sb-recent-words"><li>batch</li></ul>
  `);
  const found = getFoundWords(dom.window.document);
  assert.strictEqual(found.size, 1);
});

test('lowercases words', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"><li>BATCH</li></ul>');
  const found = getFoundWords(dom.window.document);
  assert.ok(found.has('batch'));
  assert.ok(!found.has('BATCH'));
});

test('ignores empty li elements', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"><li></li><li>  </li><li>batch</li></ul>');
  const found = getFoundWords(dom.window.document);
  assert.strictEqual(found.size, 1);
  assert.ok(found.has('batch'));
});

test('empty Set when no words', () => {
  const dom = new JSDOM('<div></div>');
  const found = getFoundWords(dom.window.document);
  assert.strictEqual(found.size, 0);
});

console.log('\nprocessWordList:');

test('adds we-word class', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"><li>batch</li></ul>');
  processWordList(dom.window.document);
  const li = dom.window.document.querySelector('li');
  assert.ok(li.classList.contains('we-word'));
});

test('sets role="button" and aria-label', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"><li>batch</li></ul>');
  processWordList(dom.window.document);
  const li = dom.window.document.querySelector('li');
  assert.strictEqual(li.getAttribute('role'), 'button');
  assert.strictEqual(li.getAttribute('aria-label'), 'Look up batch');
});

test('skips words shorter than 4 chars', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"><li>bat</li></ul>');
  processWordList(dom.window.document);
  const li = dom.window.document.querySelector('li');
  assert.ok(!li.classList.contains('we-word'));
});

test('marks as processed (idempotent)', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"><li>batch</li></ul>');
  processWordList(dom.window.document);
  processWordList(dom.window.document); // second call
  const li = dom.window.document.querySelector('li');
  assert.strictEqual(li.dataset.weProcessed, '1');
  assert.ok(li.classList.contains('we-word'));
});

test('handles empty list', () => {
  const dom = new JSDOM('<ul class="sb-wordlist-items-pag"></ul>');
  processWordList(dom.window.document); // should not throw
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
