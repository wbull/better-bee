// Tooltip rendering and its helpers, driven through the REAL userscript.
// Migrated from the legacy test_build_panel_content.mjs (42 cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';
import {
  datamuseDict, wiktionaryDict, fulfilledMwDict, mwNotFound,
  rejectedDict, erroredDict, notFoundDict, wikiSummary,
} from './fixtures/dict.mjs';

// Fresh window per test; returns the internals plus a parser for returned HTML.
function boot() {
  const { internals, document } = loadScript();
  const parse = html => { const el = document.createElement('div'); el.innerHTML = html; return el; };
  return { ...internals, parse };
}

const MW_AUDIO = 'https://media.merriam-webster.com/audio/prons/en/us/mp3';

// ─── buildTooltipContent (free API) ────────────────────────────────

test('word heading with correct text', () => {
  const { buildTooltipContent, parse } = boot();
  const html = buildTooltipContent('hello', rejectedDict());
  assert.ok(html.includes('<div class="we-tooltip-word">hello</div>'));
  assert.equal(parse(html).querySelector('.we-tooltip-word').textContent, 'hello');
});

test('transient API failure shows retry message, not "No definition found"', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('xyzzy', rejectedDict());
  assert.ok(html.includes('we-tooltip-nodef'));
  assert.ok(html.includes('click the word to retry'));
  assert.ok(!html.includes('No definition found'));
});

test('definitive not-found (404) shows "No definition found"', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('xyzzy', notFoundDict());
  assert.ok(html.includes('we-tooltip-nodef'));
  assert.ok(html.includes('No definition found'));
  assert.ok(!html.includes('retry'));
  assert.ok(!html.includes('we-tooltip-tip'), '404 is not a reliability problem — no tip');
});

test('transient failure renders the specific cause text', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('xyzzy', erroredDict('Dictionary service is down (HTTP 522)'));
  assert.ok(html.includes('Dictionary service is down (HTTP 522) — click the word to retry'));
});

test('free-API failure shows the Merriam-Webster key tip; MW failure does not', () => {
  const { buildTooltipContent } = boot();
  const free = buildTooltipContent('xyzzy', erroredDict('Network error reaching the dictionary', 'free'));
  assert.ok(free.includes('we-tooltip-tip'));
  assert.ok(free.includes('Merriam-Webster key'));
  const mw = buildTooltipContent('xyzzy', erroredDict('Network error reaching the dictionary', 'mw'));
  assert.ok(!mw.includes('we-tooltip-tip'));
});

test('XSS: HTML entities escaped in word names', () => {
  const { buildTooltipContent, parse } = boot();
  const html = buildTooltipContent('<script>alert("xss")</script>', rejectedDict());
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(parse(html).querySelector('script'), null);
});

// ─── stripGrammarLabels ────────────────────────────────────────────

test('pure grammar label is removed entirely', () => {
  const { stripGrammarLabels } = boot();
  assert.equal(stripGrammarLabels('(uncountable) The seed of this tree.'), 'The seed of this tree.');
});

test('mixed label keeps the context part only', () => {
  const { stripGrammarLabels } = boot();
  assert.equal(stripGrammarLabels('(uncountable, arithmetic) The operation of adding.'), '(arithmetic) The operation of adding.');
});

test('context-only labels are kept', () => {
  const { stripGrammarLabels } = boot();
  assert.equal(stripGrammarLabels('(finance) A bank account.'), '(finance) A bank account.');
  assert.equal(stripGrammarLabels('(chiefly in the negative) A jot.'), '(chiefly in the negative) A jot.');
});

test('definition without a leading parenthetical passes through', () => {
  const { stripGrammarLabels } = boot();
  assert.equal(stripGrammarLabels('To move swiftly.'), 'To move swiftly.');
});

test('grammar labels are stripped in the Datamuse branch', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('annatto', datamuseDict({
    word: 'annatto', tags: ['n'],
    defs: ['n\t(uncountable) The seed of this tree. ', 'n\t(uncountable, cooking) A dye. '],
  }));
  assert.ok(html.includes('&bull; The seed of this tree.'));
  assert.ok(html.includes('(cooking) A dye.'));
  assert.ok(!html.includes('uncountable'));
});

// ─── pickWikiThumbnail ─────────────────────────────────────────────

test('standard article with matching title and thumbnail → URL (case-insensitive)', () => {
  const { pickWikiThumbnail } = boot();
  assert.equal(pickWikiThumbnail(wikiSummary(), 'tooth'), 'https://upload.wikimedia.org/t/tooth.png');
});

test('disambiguation page → no image', () => {
  const { pickWikiThumbnail } = boot();
  assert.equal(pickWikiThumbnail(wikiSummary({ type: 'disambiguation' }), 'tooth'), '');
});

test('title mismatch (redirect to a different article) → no image', () => {
  const { pickWikiThumbnail } = boot();
  assert.equal(pickWikiThumbnail(wikiSummary({ titles: { canonical: 'Anita_Doth' } }), 'doth'), '');
});

test('article without a thumbnail → no image', () => {
  const { pickWikiThumbnail } = boot();
  assert.equal(pickWikiThumbnail(wikiSummary({ thumbnail: undefined }), 'tooth'), '');
});

test('null/missing summary → no image', () => {
  const { pickWikiThumbnail } = boot();
  assert.equal(pickWikiThumbnail(null, 'tooth'), '');
  assert.equal(pickWikiThumbnail({}, 'tooth'), '');
});

// ─── describeFetchError ────────────────────────────────────────────

test('429 → rate limit wording', () => {
  const { describeFetchError } = boot();
  assert.equal(describeFetchError(Object.assign(new Error('HTTP 429'), { status: 429 })),
    'Dictionary rate limit hit (HTTP 429)');
});

test('5xx → service down wording with status', () => {
  const { describeFetchError } = boot();
  assert.equal(describeFetchError(Object.assign(new Error('HTTP 522'), { status: 522 })),
    'Dictionary service is down (HTTP 522)');
});

test('other status → generic HTTP wording', () => {
  const { describeFetchError } = boot();
  assert.equal(describeFetchError(Object.assign(new Error('HTTP 403'), { status: 403 })),
    'Dictionary error (HTTP 403)');
});

test('GM watchdog timeout → timed out wording', () => {
  const { describeFetchError } = boot();
  assert.equal(describeFetchError(new Error('GM timeout')), 'Dictionary request timed out');
});

test('AbortSignal TimeoutError → timed out wording', () => {
  const { describeFetchError } = boot();
  const e = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
  assert.equal(describeFetchError(e), 'Dictionary request timed out');
});

test('status-less network failure → network wording', () => {
  const { describeFetchError } = boot();
  assert.equal(describeFetchError(new Error('Network error')), 'Network error reaching the dictionary');
});

// ─── buildTooltipContent (Datamuse) ────────────────────────────────

test('Datamuse: POS name and IPA on the meta line', () => {
  const { buildTooltipContent } = boot();
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
  const { buildTooltipContent, parse } = boot();
  const html = buildTooltipContent('run', datamuseDict({
    word: 'run',
    tags: ['v'],
    defs: ['v\tTo move swiftly. ', 'v\tTo operate. ', 'v\tThis should be cut off. '],
  }));
  assert.ok(html.includes('To move swiftly.'));
  assert.ok(html.includes('To operate.'));
  assert.ok(!html.includes('This should be cut off'));
  assert.ok(!html.includes('\t'));
  assert.equal(parse(html).querySelectorAll('.we-tooltip-def').length, 2);
});

test('Datamuse: adj/adv POS codes map to full names; unknown code shows no POS', () => {
  const { buildTooltipContent } = boot();
  const adj = buildTooltipContent('busy', datamuseDict({ word: 'busy', tags: [], defs: ['adj\tOccupied. '] }));
  assert.ok(adj.includes('adjective'));
  const u = buildTooltipContent('zzz', datamuseDict({ word: 'zzz', tags: [], defs: ['u\tSleep sound. '] }));
  assert.ok(!u.includes('we-tooltip-meta'));
  assert.ok(u.includes('Sleep sound.'));
});

test('Datamuse: no IPA tag → meta line is the bare POS name', () => {
  const { buildTooltipContent, parse } = boot();
  const html = buildTooltipContent('iota', datamuseDict({ word: 'iota', tags: ['n'], defs: ['n\tX. '] }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.equal(parse(html).querySelector('.we-tooltip-meta').textContent, 'noun',
    'meta content should be exactly the POS, no /ipa/ or dot');
});

// ─── buildTooltipContent (Wiktionary) ──────────────────────────────

test('Wiktionary: strips HTML tags and shows lowercased POS', () => {
  const { buildTooltipContent } = boot();
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
  const { buildTooltipContent, parse } = boot();
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
  assert.equal(parse(html).querySelectorAll('.we-tooltip-def').length, 2);
});

test('Wiktionary: HTML in definitions cannot inject markup (escaped after strip)', () => {
  const { buildTooltipContent, parse } = boot();
  const html = buildTooltipContent('x', wiktionaryDict([{
    partOfSpeech: 'Noun',
    definitions: [{ definition: 'uses &lt;script&gt; tags' }],
  }]));
  assert.ok(!html.includes('<script>'));
  assert.equal(parse(html).querySelector('script'), null);
});

// ─── stripWikiHtml ─────────────────────────────────────────────────

test('removes tags, decodes entities, collapses whitespace', () => {
  const { stripWikiHtml } = boot();
  assert.equal(
    stripWikiHtml('A <b>bold</b>&nbsp;&amp; <a href="x">linked</a>\n  claim&#39;s &quot;test&quot; &lt;tag&gt;'),
    'A bold & linked claim\'s "test" <tag>',
  );
});

test('label-only fragment reduces to empty string', () => {
  const { stripWikiHtml } = boot();
  assert.equal(stripWikiHtml('<span class="usage-label-sense" about="#mwt22"></span>'), '');
});

// ─── buildTooltipContent (Merriam-Webster) ─────────────────────────

test('MW: POS and phonetic displayed', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'noun',
    hwi: { prs: [{ mw: 'hə-ˈlō' }] },
    shortdef: ['an expression of greeting'],
  }));
  assert.ok(html.includes('we-tooltip-meta'));
  assert.ok(html.includes('noun'));
  assert.ok(html.includes('/hə-ˈlō/'));
  assert.ok(html.includes('·'));
});

test('MW: missing phonetic shows POS only', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'verb',
    hwi: {},
    shortdef: ['to greet'],
  }));
  assert.ok(html.includes('verb'));
  assert.ok(!html.includes('·'));
});

test('MW: shows up to 2 definitions from shortdef', () => {
  const { buildTooltipContent, parse } = boot();
  const html = buildTooltipContent('run', fulfilledMwDict({
    fl: 'verb',
    hwi: {},
    shortdef: ['to go faster than a walk', 'to go steadily', 'to go without restraint'],
  }));
  assert.ok(html.includes('to go faster than a walk'));
  assert.ok(html.includes('to go steadily'));
  assert.ok(!html.includes('to go without restraint'));
  assert.equal(parse(html).querySelectorAll('.we-tooltip-def').length, 2);
});

test('MW: audio button with correct CDN URL', () => {
  const { buildTooltipContent, parse } = boot();
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'noun',
    hwi: { prs: [{ mw: 'hə-ˈlō', sound: { audio: 'hello001' } }] },
    shortdef: [],
  }));
  assert.ok(html.includes('we-tooltip-audio'));
  assert.ok(html.includes(`${MW_AUDIO}/h/hello001.mp3`));
  assert.equal(parse(html).querySelector('.we-tooltip-audio').dataset.audio, `${MW_AUDIO}/h/hello001.mp3`);
});

test('MW: no audio button when sound is missing', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('hello', fulfilledMwDict({
    fl: 'noun',
    hwi: { prs: [{ mw: 'hə-ˈlō' }] },
    shortdef: [],
  }));
  assert.ok(!html.includes('we-tooltip-audio'));
});

test('MW: not found (string array suggestions) shows fallback', () => {
  const { buildTooltipContent } = boot();
  const html = buildTooltipContent('xyzzy', mwNotFound(['xyst', 'xysti']));
  assert.ok(html.includes('we-tooltip-nodef'));
  assert.ok(html.includes('No definition found'));
});

// ─── getMwAudioUrl ─────────────────────────────────────────────────

test('audio subdir: regular word uses first char', () => {
  const { getMwAudioUrl } = boot();
  assert.equal(getMwAudioUrl('hello001'), `${MW_AUDIO}/h/hello001.mp3`);
});

test('audio subdir: "bix" prefix', () => {
  const { getMwAudioUrl } = boot();
  assert.equal(getMwAudioUrl('bixbye01'), `${MW_AUDIO}/bix/bixbye01.mp3`);
});

test('audio subdir: "gg" prefix', () => {
  const { getMwAudioUrl } = boot();
  assert.equal(getMwAudioUrl('ggword01'), `${MW_AUDIO}/gg/ggword01.mp3`);
});

test('audio subdir: digit prefix uses "number"', () => {
  const { getMwAudioUrl } = boot();
  assert.equal(getMwAudioUrl('1word'), `${MW_AUDIO}/number/1word.mp3`);
});

test('audio subdir: empty audio returns empty string', () => {
  const { getMwAudioUrl } = boot();
  assert.equal(getMwAudioUrl(''), '');
});

// ─── escapeHTML ────────────────────────────────────────────────────

test('escapeHTML escapes &, <, > and double quotes', () => {
  const { escapeHTML } = boot();
  assert.equal(escapeHTML('a & b <c> "d"'), 'a &amp; b &lt;c&gt; &quot;d&quot;');
});
