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

function getMwAudioUrl(audio) {
  if (!audio) return '';
  let subdir;
  if (audio.startsWith('bix')) subdir = 'bix';
  else if (audio.startsWith('gg')) subdir = 'gg';
  else if (/^[0-9\W]/.test(audio)) subdir = 'number';
  else subdir = audio.charAt(0);
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audio}.mp3`;
}

function describeFetchError(e) {
  const status = e && e.status;
  if (status === 429) return 'Dictionary rate limit hit (HTTP 429)';
  if (status >= 500) return `Dictionary service is down (HTTP ${status})`;
  if (status) return `Dictionary error (HTTP ${status})`;
  if (e && /timeout|abort/i.test(`${e.name} ${e.message}`)) return 'Dictionary request timed out';
  return 'Network error reaching the dictionary';
}

// Wiktionary REST serves definitions as HTML fragments (wiki links, bold,
// label spans); reduce to plain text before rendering.
function stripWikiHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTooltipContent(word, dictResult) {
  let html = '';

  // Word heading
  html += `<div class="we-tooltip-word">${escapeHTML(word)}</div>`;

  // Dictionary content
  if (dictResult.status === 'fulfilled' && dictResult.source === 'mw' && Array.isArray(dictResult.value)) {
    // MW returns array of strings when word not found (suggestions)
    if (typeof dictResult.value[0] === 'string') {
      html += `<div class="we-tooltip-nodef">No definition found.</div>`;
      return html;
    }

    // Merriam-Webster format
    const entry = dictResult.value[0];
    const pos = entry.fl || '';
    const phonetic = entry.hwi?.prs?.[0]?.mw ? `/${entry.hwi.prs[0].mw}/` : '';
    const metaParts = [pos, phonetic].filter(Boolean);
    if (metaParts.length) {
      html += `<div class="we-tooltip-meta">${metaParts.map(escapeHTML).join(' \u00b7 ')}</div>`;
    }

    // Audio
    const audioFile = entry.hwi?.prs?.[0]?.sound?.audio;
    const audioUrl = getMwAudioUrl(audioFile);
    if (audioUrl) {
      html += `<button class="we-tooltip-audio" data-audio="${escapeHTML(audioUrl)}">&#128264;</button>`;
    }

    // Definitions
    const defs = entry.shortdef || [];
    for (const def of defs.slice(0, 2)) {
      html += `<div class="we-tooltip-def">&bull; ${escapeHTML(def)}</div>`;
    }
  } else if (dictResult.status === 'fulfilled' && dictResult.source === 'datamuse' && Array.isArray(dictResult.value)) {
    const entry = dictResult.value[0] || {};
    const ipa = ((entry.tags || []).find(t => t.startsWith('ipa_pron:')) || '').slice(9).trim();
    const posNames = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };
    const defs = (entry.defs || []).slice(0, 2).map(d => {
      const tab = d.indexOf('\t');
      return { pos: posNames[d.slice(0, tab)] || '', text: d.slice(tab + 1).trim() };
    });
    const metaParts = [defs[0] ? defs[0].pos : '', ipa ? `/${ipa}/` : ''].filter(Boolean);
    if (metaParts.length) {
      html += `<div class="we-tooltip-meta">${metaParts.map(escapeHTML).join(' \u00b7 ')}</div>`;
    }
    for (const def of defs) {
      html += `<div class="we-tooltip-def">&bull; ${escapeHTML(def.text)}</div>`;
    }
  } else if (dictResult.status === 'fulfilled' && dictResult.source === 'wiktionary' && dictResult.value && Array.isArray(dictResult.value.en)) {
    const entry = dictResult.value.en[0] || {};
    const pos = (entry.partOfSpeech || '').toLowerCase();
    if (pos) {
      html += `<div class="we-tooltip-meta">${escapeHTML(pos)}</div>`;
    }
    const defs = (entry.definitions || [])
      .map(d => stripWikiHtml(d.definition || ''))
      .filter(Boolean)
      .slice(0, 2);
    for (const text of defs) {
      html += `<div class="we-tooltip-def">&bull; ${escapeHTML(text)}</div>`;
    }
  } else if (dictResult.status === 'rejected' && !dictResult.notFound) {
    html += `<div class="we-tooltip-nodef">${escapeHTML(dictResult.errorText || 'Couldn’t load definition')} — click the word to retry.</div>`;
    if (dictResult.source !== 'mw') {
      html += `<div class="we-tooltip-tip">Tip: for reliable definitions, add a free Merriam-Webster key (Tampermonkey menu → Set Dictionary API Key).</div>`;
    }
  } else {
    html += `<div class="we-tooltip-nodef">No definition found.</div>`;
  }

  return html;
}

function datamuseDict(entry) {
  return { status: 'fulfilled', value: [entry], source: 'datamuse' };
}
function wiktionaryDict(en) {
  return { status: 'fulfilled', value: { en }, source: 'wiktionary' };
}
function fulfilledMwDict(entry) {
  return { status: 'fulfilled', value: [entry], source: 'mw' };
}
function mwNotFound(suggestions) {
  return { status: 'fulfilled', value: suggestions, source: 'mw' };
}
function rejectedDict() {
  return { status: 'rejected', notFound: false }; // transient failure — retryable
}
function erroredDict(errorText, source = 'free') {
  return { status: 'rejected', notFound: false, source, errorText };
}
function notFoundDict() {
  return { status: 'rejected', notFound: true }; // definitive 404 — word absent
}

// ─── Free API tests ────────────────────────────────────────────────

console.log('\nbuildTooltipContent (free API):');

test('Word heading with correct text', () => {
  const html = buildTooltipContent('hello', rejectedDict());
  assert.ok(html.includes('<div class="we-tooltip-word">hello</div>'));
});

test('Transient API failure shows retry message, not "No definition found"', () => {
  const html = buildTooltipContent('xyzzy', rejectedDict());
  assert.ok(html.includes('we-tooltip-nodef'));
  assert.ok(html.includes('click the word to retry'));
  assert.ok(!html.includes('No definition found'));
});

test('Definitive not-found (404) shows "No definition found"', () => {
  const html = buildTooltipContent('xyzzy', notFoundDict());
  assert.ok(html.includes('we-tooltip-nodef'));
  assert.ok(html.includes('No definition found'));
  assert.ok(!html.includes('retry'));
  assert.ok(!html.includes('we-tooltip-tip'), '404 is not a reliability problem — no tip');
});

test('Transient failure renders the specific cause text', () => {
  const html = buildTooltipContent('xyzzy', erroredDict('Dictionary service is down (HTTP 522)'));
  assert.ok(html.includes('Dictionary service is down (HTTP 522) — click the word to retry'));
});

test('Free-API failure shows the Merriam-Webster key tip; MW failure does not', () => {
  const free = buildTooltipContent('xyzzy', erroredDict('Network error reaching the dictionary', 'free'));
  assert.ok(free.includes('we-tooltip-tip'));
  assert.ok(free.includes('Merriam-Webster key'));
  const mw = buildTooltipContent('xyzzy', erroredDict('Network error reaching the dictionary', 'mw'));
  assert.ok(!mw.includes('we-tooltip-tip'));
});

// ─── describeFetchError tests ──────────────────────────────────────

console.log('\ndescribeFetchError:');

test('429 → rate limit wording', () => {
  assert.strictEqual(describeFetchError(Object.assign(new Error('HTTP 429'), { status: 429 })),
    'Dictionary rate limit hit (HTTP 429)');
});

test('5xx → service down wording with status', () => {
  assert.strictEqual(describeFetchError(Object.assign(new Error('HTTP 522'), { status: 522 })),
    'Dictionary service is down (HTTP 522)');
});

test('other status → generic HTTP wording', () => {
  assert.strictEqual(describeFetchError(Object.assign(new Error('HTTP 403'), { status: 403 })),
    'Dictionary error (HTTP 403)');
});

test('GM watchdog timeout → timed out wording', () => {
  assert.strictEqual(describeFetchError(new Error('GM timeout')), 'Dictionary request timed out');
});

test('AbortSignal TimeoutError → timed out wording', () => {
  const e = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
  assert.strictEqual(describeFetchError(e), 'Dictionary request timed out');
});

test('status-less network failure → network wording', () => {
  assert.strictEqual(describeFetchError(new Error('Network error')), 'Network error reaching the dictionary');
});

test('XSS: HTML entities escaped in word names', () => {
  const html = buildTooltipContent('<script>alert("xss")</script>', rejectedDict());
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// ─── Datamuse renderer ─────────────────────────────────────────────

console.log('\nbuildTooltipContent (Datamuse):');

test('Datamuse: POS name and IPA on the meta line', () => {
  const html = buildTooltipContent('iota', datamuseDict({
    word: 'iota',
    tags: ['n', 'pron:AY0 OW1 T AH0 ', 'ipa_pron:aɪˈoʊtʌ'],
    defs: ['n\tA very small quantity. '],
  }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('noun'));
  assert.ok(html.includes('/aɪˈoʊtʌ/'));
  assert.ok(html.includes('·'));
});

test('Datamuse: shows up to 2 definitions, tab prefix stripped', () => {
  const html = buildTooltipContent('run', datamuseDict({
    word: 'run',
    tags: ['v'],
    defs: ['v\tTo move swiftly. ', 'v\tTo operate. ', 'v\tThis should be cut off. '],
  }));
  assert.ok(html.includes('To move swiftly.'));
  assert.ok(html.includes('To operate.'));
  assert.ok(!html.includes('This should be cut off'));
  assert.ok(!html.includes('\t'));
});

test('Datamuse: adj/adv POS codes map to full names; unknown code shows no POS', () => {
  const adj = buildTooltipContent('busy', datamuseDict({ word: 'busy', tags: [], defs: ['adj\tOccupied. '] }));
  assert.ok(adj.includes('adjective'));
  const u = buildTooltipContent('zzz', datamuseDict({ word: 'zzz', tags: [], defs: ['u\tSleep sound. '] }));
  assert.ok(!u.includes('we-tooltip-meta'));
  assert.ok(u.includes('Sleep sound.'));
});

test('Datamuse: no IPA tag → meta line is the bare POS name', () => {
  const html = buildTooltipContent('iota', datamuseDict({ word: 'iota', tags: ['n'], defs: ['n\tX. '] }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('>noun</div>'), 'meta content should be exactly the POS, no /ipa/ or dot');
});

// ─── Wiktionary renderer ───────────────────────────────────────────

console.log('\nbuildTooltipContent (Wiktionary):');

test('Wiktionary: strips HTML tags and shows lowercased POS', () => {
  const html = buildTooltipContent('iota', wiktionaryDict([{
    partOfSpeech: 'Noun',
    definitions: [{ definition: 'The ninth letter of the <a href="/wiki/Greek">Greek</a> alphabet (<b>Ι</b>, <b>ι</b>).' }],
  }]));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('noun'));
  assert.ok(html.includes('The ninth letter of the Greek alphabet (Ι, ι).'));
  assert.ok(!html.includes('<a '));
  assert.ok(!html.includes('<b>'));
});

test('Wiktionary: empty-string senses are skipped, cap 2', () => {
  const html = buildTooltipContent('iota', wiktionaryDict([{
    partOfSpeech: 'Noun',
    definitions: [
      { definition: '' },
      { definition: 'First real sense.' },
      { definition: '<span class="usage-label-sense"></span>' },
      { definition: 'Second real sense.' },
      { definition: 'Third — cut off.' },
    ],
  }]));
  assert.ok(html.includes('First real sense.'));
  assert.ok(html.includes('Second real sense.'));
  assert.ok(!html.includes('cut off'));
});

test('Wiktionary: HTML in definitions cannot inject markup (escaped after strip)', () => {
  const html = buildTooltipContent('x', wiktionaryDict([{
    partOfSpeech: 'Noun',
    definitions: [{ definition: 'uses &lt;script&gt; tags' }],
  }]));
  assert.ok(!html.includes('<script>'));
});

// ─── stripWikiHtml tests ───────────────────────────────────────────

console.log('\nstripWikiHtml:');

test('removes tags, decodes entities, collapses whitespace', () => {
  assert.strictEqual(
    stripWikiHtml('A <b>bold</b>&nbsp;&amp; <a href="x">linked</a>\n  claim&#39;s &quot;test&quot; &lt;tag&gt;'),
    'A bold & linked claim\'s "test" <tag>'
  );
});

test('label-only fragment reduces to empty string', () => {
  assert.strictEqual(stripWikiHtml('<span class="usage-label-sense" about="#mwt22"></span>'), '');
});

// ─── Merriam-Webster API tests ─────────────────────────────────────

console.log('\nbuildTooltipContent (Merriam-Webster):');

test('MW: POS and phonetic displayed', () => {
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'noun',
    hwi: { prs: [{ mw: 'hə-ˈlō' }] },
    shortdef: ['an expression of greeting']
  }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('noun'));
  assert.ok(html.includes('/hə-ˈlō/'));
  assert.ok(html.includes('\u00b7'));
});

test('MW: Missing phonetic shows POS only', () => {
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'verb',
    hwi: {},
    shortdef: ['to greet']
  }));
  assert.ok(html.includes('verb'));
  assert.ok(!html.includes('\u00b7'));
});

test('MW: Shows up to 2 definitions from shortdef', () => {
  const html = buildTooltipContent('run', fulfilledMwDict({
    fl: 'verb',
    hwi: {},
    shortdef: ['to go faster than a walk', 'to go steadily', 'to go without restraint']
  }));
  assert.ok(html.includes('to go faster than a walk'));
  assert.ok(html.includes('to go steadily'));
  assert.ok(!html.includes('to go without restraint'));
});

test('MW: Audio button with correct CDN URL', () => {
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'noun',
    hwi: { prs: [{ mw: 'hə-ˈlō', sound: { audio: 'hello001' } }] },
    shortdef: []
  }));
  assert.ok(html.includes('we-tooltip-audio'));
  assert.ok(html.includes('https://media.merriam-webster.com/audio/prons/en/us/mp3/h/hello001.mp3'));
});

test('MW: No audio button when sound is missing', () => {
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'noun',
    hwi: { prs: [{ mw: 'hə-ˈlō' }] },
    shortdef: []
  }));
  assert.ok(!html.includes('we-tooltip-audio'));
});

test('MW: Not found (string array suggestions) shows fallback', () => {
  const html = buildTooltipContent('xyzzy', mwNotFound(['xyst', 'xysti']));
  assert.ok(html.includes('we-tooltip-nodef'));
  assert.ok(html.includes('No definition found'));
});

// ─── getMwAudioUrl tests ───────────────────────────────────────────

console.log('\ngetMwAudioUrl:');

test('Audio subdir: regular word uses first char', () => {
  assert.strictEqual(getMwAudioUrl('hello001'), 'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/hello001.mp3');
});

test('Audio subdir: "bix" prefix', () => {
  assert.strictEqual(getMwAudioUrl('bixbye01'), 'https://media.merriam-webster.com/audio/prons/en/us/mp3/bix/bixbye01.mp3');
});

test('Audio subdir: "gg" prefix', () => {
  assert.strictEqual(getMwAudioUrl('ggword01'), 'https://media.merriam-webster.com/audio/prons/en/us/mp3/gg/ggword01.mp3');
});

test('Audio subdir: digit prefix uses "number"', () => {
  assert.strictEqual(getMwAudioUrl('1word'), 'https://media.merriam-webster.com/audio/prons/en/us/mp3/number/1word.mp3');
});

test('Audio subdir: empty audio returns empty string', () => {
  assert.strictEqual(getMwAudioUrl(''), '');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
