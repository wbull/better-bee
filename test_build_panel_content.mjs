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

function buildPanelContent(word, dictResult, wikiResult) {
  let html = '';

  // Word heading
  html += `<h2 class="we-panel-word">${escapeHTML(word)}</h2>`;

  // Dictionary content
  if (dictResult.status === 'fulfilled' && Array.isArray(dictResult.value)) {
    const entry = dictResult.value[0];

    // Phonetic
    const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '';
    if (phonetic) {
      html += `<div class="we-panel-phonetic">${escapeHTML(phonetic)}</div>`;
    }

    // Audio button
    const audioUrl = entry.phonetics
      ?.map(p => p.audio)
      .filter(a => a && a.length > 0)[0];
    if (audioUrl) {
      html += `<button class="we-panel-audio" data-audio="${escapeHTML(audioUrl)}">&#128264; Play pronunciation</button>`;
    }

    // Meanings
    if (entry.meanings) {
      for (const meaning of entry.meanings) {
        html += `<div class="we-panel-pos">${escapeHTML(meaning.partOfSpeech)}</div>`;
        for (const def of meaning.definitions.slice(0, 3)) {
          html += `<div class="we-panel-def">&bull; ${escapeHTML(def.definition)}</div>`;
        }
      }
    }
  } else {
    html += `<div class="we-panel-nodef">No definition found for &ldquo;${escapeHTML(word)}&rdquo;</div>`;
  }

  // Wikipedia image
  if (wikiResult.status === 'fulfilled') {
    const wiki = wikiResult.value;
    // Skip disambiguation pages
    if (wiki.type !== 'disambiguation' && wiki.thumbnail?.source) {
      html += `<div class="we-panel-img">`;
      html += `<img src="${escapeHTML(wiki.thumbnail.source)}" alt="${escapeHTML(wiki.title || word)}">`;
      if (wiki.description) {
        html += `<div class="we-panel-img-caption">${escapeHTML(wiki.description)}</div>`;
      }
      html += `</div>`;
    }
  }

  return html;
}

function fulfilledDict(entry) {
  return { status: 'fulfilled', value: [entry] };
}
function rejectedDict() {
  return { status: 'rejected', reason: new Error('Not found') };
}
function fulfilledWiki(data) {
  return { status: 'fulfilled', value: data };
}
function rejectedWiki() {
  return { status: 'rejected', reason: new Error('Not found') };
}

console.log('\nbuildPanelContent:');

test('Word heading with correct text', () => {
  const html = buildPanelContent('hello', rejectedDict(), rejectedWiki());
  assert.ok(html.includes('<h2 class="we-panel-word">hello</h2>'));
});

test('Phonetic displayed when present', () => {
  const html = buildPanelContent('hello', fulfilledDict({
    phonetic: '/həˈloʊ/',
    meanings: []
  }), rejectedWiki());
  assert.ok(html.includes('we-panel-phonetic'));
  assert.ok(html.includes('/həˈloʊ/'));
});

test('Audio button when phonetic audio URL exists', () => {
  const html = buildPanelContent('hello', fulfilledDict({
    phonetics: [{ audio: 'https://example.com/hello.mp3' }],
    meanings: []
  }), rejectedWiki());
  assert.ok(html.includes('we-panel-audio'));
  assert.ok(html.includes('https://example.com/hello.mp3'));
});

test('Definitions rendered (up to 3 per part of speech)', () => {
  const html = buildPanelContent('run', fulfilledDict({
    meanings: [{
      partOfSpeech: 'verb',
      definitions: [
        { definition: 'To move swiftly' },
        { definition: 'To operate' },
        { definition: 'To manage' },
        { definition: 'This should be cut off' }
      ]
    }]
  }), rejectedWiki());
  assert.ok(html.includes('To move swiftly'));
  assert.ok(html.includes('To operate'));
  assert.ok(html.includes('To manage'));
  assert.ok(!html.includes('This should be cut off'));
});

test('"No definition found" on API failure', () => {
  const html = buildPanelContent('xyzzy', rejectedDict(), rejectedWiki());
  assert.ok(html.includes('we-panel-nodef'));
  assert.ok(html.includes('No definition found'));
});

test('Wikipedia image when available and not disambiguation', () => {
  const html = buildPanelContent('cat', fulfilledDict({ meanings: [] }),
    fulfilledWiki({
      type: 'standard',
      thumbnail: { source: 'https://example.com/cat.jpg' },
      title: 'Cat',
      description: 'A small domesticated carnivore'
    }));
  assert.ok(html.includes('we-panel-img'));
  assert.ok(html.includes('https://example.com/cat.jpg'));
  assert.ok(html.includes('A small domesticated carnivore'));
});

test('Skips Wikipedia image for disambiguation pages', () => {
  const html = buildPanelContent('bat', fulfilledDict({ meanings: [] }),
    fulfilledWiki({
      type: 'disambiguation',
      thumbnail: { source: 'https://example.com/bat.jpg' },
      title: 'Bat'
    }));
  assert.ok(!html.includes('we-panel-img'));
});

test('XSS: HTML entities escaped in word names', () => {
  const html = buildPanelContent('<script>alert("xss")</script>', rejectedDict(), rejectedWiki());
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
