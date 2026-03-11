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

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildTooltipContent(word, dictResult) {
  let html = '';

  // Word heading
  html += `<div class="we-tooltip-word">${escapeHTML(word)}</div>`;

  // Dictionary content
  if (dictResult.status === 'fulfilled' && Array.isArray(dictResult.value)) {
    const entry = dictResult.value[0];

    // Part of speech + phonetic on one line
    const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '';
    const firstPos = entry.meanings?.[0]?.partOfSpeech || '';
    const metaParts = [firstPos, phonetic].filter(Boolean);
    if (metaParts.length) {
      html += `<div class="we-tooltip-meta">${metaParts.map(escapeHTML).join(' \u00b7 ')}</div>`;
    }

    // Audio button (small, inline)
    const audioUrl = entry.phonetics
      ?.map(p => p.audio)
      .filter(a => a && a.length > 0)[0];
    if (audioUrl) {
      html += `<button class="we-tooltip-audio" data-audio="${escapeHTML(audioUrl)}">&#128264;</button>`;
    }

    // 1-2 definitions from first meaning group
    const defs = entry.meanings?.[0]?.definitions;
    if (defs) {
      for (const def of defs.slice(0, 2)) {
        html += `<div class="we-tooltip-def">&bull; ${escapeHTML(def.definition)}</div>`;
      }
    }
  } else {
    html += `<div class="we-tooltip-nodef">No definition found.</div>`;
  }

  return html;
}

function fulfilledDict(entry) {
  return { status: 'fulfilled', value: [entry] };
}
function rejectedDict() {
  return { status: 'rejected', reason: new Error('Not found') };
}

console.log('\nbuildTooltipContent:');

test('Word heading with correct text', () => {
  const html = buildTooltipContent('hello', rejectedDict());
  assert.ok(html.includes('<div class="we-tooltip-word">hello</div>'));
});

test('POS and phonetic on one meta line', () => {
  const html = buildTooltipContent('hello', fulfilledDict({
    phonetic: '/həˈloʊ/',
    meanings: [{ partOfSpeech: 'noun', definitions: [] }]
  }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('noun'));
  assert.ok(html.includes('/həˈloʊ/'));
  assert.ok(html.includes('\u00b7'), 'POS and phonetic separated by middle dot');
});

test('Phonetic only (no POS) still shows meta', () => {
  const html = buildTooltipContent('hello', fulfilledDict({
    phonetic: '/həˈloʊ/',
    meanings: []
  }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('/həˈloʊ/'));
});

test('Missing phonetic shows POS only', () => {
  const html = buildTooltipContent('hello', fulfilledDict({
    meanings: [{ partOfSpeech: 'verb', definitions: [] }]
  }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('verb'));
  assert.ok(!html.includes('\u00b7'));
});

test('Audio button when phonetic audio URL exists', () => {
  const html = buildTooltipContent('hello', fulfilledDict({
    phonetics: [{ audio: 'https://example.com/hello.mp3' }],
    meanings: []
  }));
  assert.ok(html.includes('we-tooltip-audio'));
  assert.ok(html.includes('https://example.com/hello.mp3'));
});

test('No audio button when audio URL is missing', () => {
  const html = buildTooltipContent('hello', fulfilledDict({
    phonetics: [{ audio: '' }],
    meanings: []
  }));
  assert.ok(!html.includes('we-tooltip-audio'));
});

test('Shows up to 2 definitions from first meaning group', () => {
  const html = buildTooltipContent('run', fulfilledDict({
    meanings: [{
      partOfSpeech: 'verb',
      definitions: [
        { definition: 'To move swiftly' },
        { definition: 'To operate' },
        { definition: 'This should be cut off' }
      ]
    }]
  }));
  assert.ok(html.includes('To move swiftly'));
  assert.ok(html.includes('To operate'));
  assert.ok(!html.includes('This should be cut off'));
});

test('Only uses first meaning group', () => {
  const html = buildTooltipContent('run', fulfilledDict({
    meanings: [
      { partOfSpeech: 'verb', definitions: [{ definition: 'First group def' }] },
      { partOfSpeech: 'noun', definitions: [{ definition: 'Second group def' }] }
    ]
  }));
  assert.ok(html.includes('First group def'));
  assert.ok(!html.includes('Second group def'));
});

test('"No definition found" on API failure', () => {
  const html = buildTooltipContent('xyzzy', rejectedDict());
  assert.ok(html.includes('we-tooltip-nodef'));
  assert.ok(html.includes('No definition found'));
});

test('XSS: HTML entities escaped in word names', () => {
  const html = buildTooltipContent('<script>alert("xss")</script>', rejectedDict());
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
