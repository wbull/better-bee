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

// Segment-wise numeric compare: '1.9' < '1.10' (parseFloat would get this wrong).
function compareVersions(a, b) {
  const as = String(a).split('.');
  const bs = String(b).split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const an = Number(as[i] || 0);
    const bn = Number(bs[i] || 0);
    if (an !== bn) return an < bn ? -1 : 1;
  }
  return 0;
}

// Noted versions with lastSeen < v <= current, newest first.
function collectUnseenNotes(lastSeen, current, notes) {
  return Object.keys(notes)
    .filter(v => compareVersions(lastSeen, v) < 0 && compareVersions(v, current) <= 0)
    .sort((a, b) => compareVersions(b, a))
    .map(v => ({
      version: v,
      features: notes[v].features || [],
      fixes: notes[v].fixes || [],
    }));
}

// createElement + textContent only — note strings must never hit innerHTML.
function buildSplashContent(doc, entries) {
  const container = doc.createElement('div');
  container.className = 'us-notes';
  for (const entry of entries) {
    const block = doc.createElement('div');
    block.className = 'us-version-block';
    const heading = doc.createElement('h3');
    heading.className = 'us-version-heading';
    heading.textContent = `v${entry.version}`;
    block.appendChild(heading);
    const sections = [
      ['✨ New', entry.features],
      ['🐛 Fixed', entry.fixes],
    ];
    for (const [label, items] of sections) {
      if (!items || items.length === 0) continue;
      const title = doc.createElement('div');
      title.className = 'us-section-title';
      title.textContent = label;
      block.appendChild(title);
      const list = doc.createElement('ul');
      list.className = 'us-note-list';
      for (const item of items) {
        const li = doc.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      }
      block.appendChild(list);
    }
    container.appendChild(block);
  }
  return container;
}

// --- compareVersions ---

console.log('\ncompareVersions:');

test('1.9 sorts before 1.10 (numeric segments, not lexicographic/float)', () => {
  assert.strictEqual(compareVersions('1.9', '1.10'), -1);
  assert.strictEqual(compareVersions('1.10', '1.9'), 1);
});

test('equal versions compare as 0', () => {
  assert.strictEqual(compareVersions('1.42', '1.42'), 0);
});

test('unequal segment counts pad with zeros', () => {
  assert.strictEqual(compareVersions('1.42', '1.42.0'), 0);
  assert.strictEqual(compareVersions('1.42', '1.42.1'), -1);
  assert.strictEqual(compareVersions('2', '1.99'), 1);
});

// --- collectUnseenNotes ---

console.log('\ncollectUnseenNotes:');

test('no noted versions in range → []', () => {
  assert.deepStrictEqual(collectUnseenNotes('1.41', '1.42', {}), []);
  assert.deepStrictEqual(
    collectUnseenNotes('1.41', '1.42', { '1.40': { features: ['old'], fixes: [] } }),
    []
  );
});

test('skipped versions all accumulate', () => {
  const notes = {
    '1.40': { features: ['a'], fixes: [] },
    '1.41': { features: [], fixes: ['b'] },
    '1.42': { features: ['c'], fixes: [] },
  };
  const out = collectUnseenNotes('1.39', '1.42', notes);
  assert.deepStrictEqual(out.map(e => e.version), ['1.42', '1.41', '1.40']);
});

test('current version with no entry contributes nothing', () => {
  const notes = { '1.41': { features: ['a'], fixes: [] } };
  const out = collectUnseenNotes('1.40', '1.42', notes);
  assert.deepStrictEqual(out.map(e => e.version), ['1.41']);
});

test('ordering is newest first', () => {
  const notes = {
    '1.9': { features: ['old'], fixes: [] },
    '1.10': { features: ['new'], fixes: [] },
  };
  const out = collectUnseenNotes('1.8', '1.10', notes);
  assert.deepStrictEqual(out.map(e => e.version), ['1.10', '1.9']);
});

test('lastSeen itself excluded, current included', () => {
  const notes = {
    '1.41': { features: ['seen'], fixes: [] },
    '1.42': { features: ['unseen'], fixes: [] },
  };
  const out = collectUnseenNotes('1.41', '1.42', notes);
  assert.deepStrictEqual(out.map(e => e.version), ['1.42']);
  assert.deepStrictEqual(out[0].features, ['unseen']);
  assert.deepStrictEqual(out[0].fixes, []);
});

// --- buildSplashContent ---

console.log('\nbuildSplashContent:');

test('renders version heading with feature and fix sections', () => {
  const dom = new JSDOM('<body></body>');
  const doc = dom.window.document;
  const el = buildSplashContent(doc, [
    { version: '1.42', features: ['feat one'], fixes: ['fix one'] },
  ]);
  assert.strictEqual(el.querySelector('.us-version-heading').textContent, 'v1.42');
  const titles = [...el.querySelectorAll('.us-section-title')].map(t => t.textContent);
  assert.deepStrictEqual(titles, ['✨ New', '🐛 Fixed']);
  const items = [...el.querySelectorAll('.us-note-list li')].map(li => li.textContent);
  assert.deepStrictEqual(items, ['feat one', 'fix one']);
});

test('empty sections are omitted', () => {
  const dom = new JSDOM('<body></body>');
  const doc = dom.window.document;
  const el = buildSplashContent(doc, [
    { version: '1.42', features: ['only feature'], fixes: [] },
  ]);
  const titles = [...el.querySelectorAll('.us-section-title')].map(t => t.textContent);
  assert.deepStrictEqual(titles, ['✨ New']);
  assert.strictEqual(el.querySelectorAll('.us-note-list').length, 1);
});

test('note text containing <script> renders inert as text', () => {
  const dom = new JSDOM('<body></body>');
  const doc = dom.window.document;
  const el = buildSplashContent(doc, [
    { version: '1.42', features: ['<script>alert(1)</script>'], fixes: [] },
  ]);
  assert.strictEqual(el.querySelectorAll('script').length, 0);
  assert.strictEqual(
    el.querySelector('.us-note-list li').textContent,
    '<script>alert(1)</script>'
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
