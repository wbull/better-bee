// Word Explorer tooltip through the real script: showTooltip's render path,
// stale-response discard, hide/position, the document-level dismiss handlers,
// the MW audio button and the lazy Wikipedia image. Network goes through a fake
// GM_xmlhttpRequest keyed on URL; every timer (rAF, hide delay) is on the fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const datamuse = (word, def) => [{ word, defs: [`n\t${def}`] }];
const mwEntry = (word, audio) => [{
  hwi: { hw: word, prs: [{ mw: 'hēl', sound: audio ? { audio } : undefined }] },
  fl: 'noun',
  shortdef: [`the ${word} definition`],
}];
const wikiSummary = (word, thumb) => ({
  type: 'standard',
  titles: { canonical: word },
  ...(thumb ? { thumbnail: { source: thumb } } : {}),
});

// Routes: datamuse / mw answer from `defs`; wikipedia answers from `wiki`.
// Anything else (and any missing entry) is a real 404 so the keyless chain
// settles definitively without touching the (absent) page fetch fallback.
// `hold` keeps matching requests pending and hands them back for later settling.
function page({ defs = {}, wiki = {}, hold = () => false, gmValues, html = '<body></body>', onWindow } = {}) {
  const timers = makeFakeTimers();
  const pending = [];
  const requests = [];
  const answer = (o, body) => body === undefined
    ? o.onload({ status: 404, responseText: 'Not Found' })
    : o.onload({ status: 200, responseText: JSON.stringify(body) });
  const gmXhrImpl = o => {
    requests.push(o.url);
    const u = new URL(o.url);
    const word = decodeURIComponent(u.pathname.split('/').pop());
    let body;
    if (u.hostname === 'api.datamuse.com') body = defs[u.searchParams.get('sp')];
    else if (u.hostname === 'dictionaryapi.com') body = defs[word];
    else if (u.hostname === 'en.wikipedia.org') body = wiki[word];
    if (hold(o.url)) pending.push({ url: o.url, resolve: b => answer(o, b === undefined ? body : b), fail: () => o.onerror(new Error('boom')) });
    else answer(o, body);
  };
  const ctx = loadScript({ timers, gmXhrImpl, gmValues, html, onWindow });
  const el = ctx.internals.elements;
  Object.defineProperty(el.tooltip, 'offsetWidth', { value: 200, configurable: true });
  Object.defineProperty(el.tooltip, 'offsetHeight', { value: 100, configurable: true });
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  const anchor = (rect = { top: 100, bottom: 120, left: 300, width: 50 }) => {
    const a = ctx.document.createElement('span');
    a.rectCalls = 0;
    a.getBoundingClientRect = () => { a.rectCalls++; return { ...rect }; };
    ctx.document.body.appendChild(a);
    return a;
  };
  const key = (k, opts = {}) => ctx.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const pointerdown = target => target.dispatchEvent(new ctx.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  const takePending = url => { const i = pending.findIndex(p => p.url.includes(url)); return i < 0 ? null : pending.splice(i, 1)[0]; };
  return { ...ctx, timers, el, flush, anchor, key, pointerdown, requests, pending, takePending };
}

// ─── showTooltip ───────────────────────────────────────────────────

test('showTooltip on a fresh word: loading state now, definition after resolve, we-visible on the rAF tick', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'back of the foot') }, hold: u => u.includes('datamuse') });
  const a = p.anchor();
  assert.equal(p.el.tooltip.style.display, 'none');
  const done = p.internals.showTooltip('heel', a);
  assert.equal(p.el.tooltip.style.display, 'block');
  assert.ok(p.el.tooltipBody.querySelector('.we-tooltip-loading'));
  assert.ok(!p.el.tooltip.classList.contains('we-visible'), 'visible only after the rAF tick');
  p.timers.advance(16);
  assert.ok(p.el.tooltip.classList.contains('we-visible'));
  assert.equal(a.rectCalls, 1, 'positioned once for the loading state');

  p.takePending('datamuse').resolve();
  await done;
  assert.ok(!p.el.tooltipBody.querySelector('.we-tooltip-loading'));
  assert.equal(p.el.tooltipBody.querySelector('.we-tooltip-word').textContent, 'heel');
  assert.match(p.el.tooltipBody.querySelector('.we-tooltip-def').textContent, /back of the foot/);
  assert.equal(p.el.tooltip.style.display, 'block');
  assert.equal(a.rectCalls, 2, 'repositioned for the rendered content');
  assert.ok(p.internals.apiCache.has('heel'));
});

test('showTooltip on a cached word skips the loading state and renders straight from cache', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'back of the foot') } });
  const a = p.anchor();
  await p.internals.showTooltip('heel', a);
  p.internals.hideTooltip();
  p.timers.advance(150);
  assert.equal(p.el.tooltip.style.display, 'none');
  const dictRequests = () => p.requests.filter(u => u.includes('datamuse')).length;
  const before = dictRequests();

  const done = p.internals.showTooltip('heel', a);
  assert.equal(p.el.tooltip.style.display, 'none', 'no loading flash for a cached word');
  assert.ok(!p.el.tooltipBody.querySelector('.we-tooltip-loading'));
  await done;
  assert.equal(p.el.tooltip.style.display, 'block');
  assert.match(p.el.tooltipBody.textContent, /back of the foot/);
  assert.equal(dictRequests(), before, 'no second dictionary request');
});

test('a not-found word (404 down the keyless chain) still renders "No definition found."', async () => {
  const p = page();
  await p.internals.showTooltip('zzzz', p.anchor());
  assert.equal(p.el.tooltipBody.querySelector('.we-tooltip-word').textContent, 'zzzz');
  assert.match(p.el.tooltipBody.querySelector('.we-tooltip-nodef').textContent, /No definition found/);
});

test('stale response is discarded: a slower earlier lookup never overwrites the newer word', async () => {
  const p = page({
    defs: { heel: datamuse('heel', 'DEF-A'), hello: datamuse('hello', 'DEF-B') },
    hold: u => u.includes('datamuse'),
  });
  const a = p.anchor();
  const first = p.internals.showTooltip('heel', a);
  const second = p.internals.showTooltip('hello', a);
  p.takePending('sp=hello').resolve();
  await second;
  assert.match(p.el.tooltipBody.textContent, /DEF-B/);

  p.takePending('sp=heel').resolve();
  await first;
  assert.match(p.el.tooltipBody.textContent, /DEF-B/);
  assert.doesNotMatch(p.el.tooltipBody.textContent, /DEF-A/);
  assert.equal(p.el.tooltipBody.querySelector('.we-tooltip-word').textContent, 'hello');
  assert.ok(p.internals.apiCache.has('heel'), 'the stale result is still cached for later');
});

test('hideTooltip during an in-flight lookup: the resolution never renders', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'DEF-A') }, hold: u => u.includes('datamuse') });
  const a = p.anchor();
  const done = p.internals.showTooltip('heel', a);
  p.internals.hideTooltip();
  p.timers.advance(150);
  assert.equal(p.el.tooltip.style.display, 'none');

  p.takePending('datamuse').resolve();
  await done;
  await p.flush();
  assert.equal(p.el.tooltip.style.display, 'none', 'dismissal outranks the late resolution');
  assert.ok(p.el.tooltipBody.querySelector('.we-tooltip-loading'), 'body untouched');
  assert.equal(a.rectCalls, 1, 'not repositioned');
  assert.ok(!p.requests.some(u => u.includes('wikipedia')), 'no image lookup for a discarded render');
});

// ─── hideTooltip ───────────────────────────────────────────────────

test('hideTooltip drops we-visible now and sets display none at +150ms', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') } });
  await p.internals.showTooltip('heel', p.anchor());
  p.timers.advance(16);
  assert.ok(p.el.tooltip.classList.contains('we-visible'));

  p.internals.hideTooltip();
  assert.ok(!p.el.tooltip.classList.contains('we-visible'));
  assert.equal(p.el.tooltip.style.display, 'block', 'still laid out for the fade');
  p.timers.advance(149);
  assert.equal(p.el.tooltip.style.display, 'block');
  p.timers.advance(1);
  assert.equal(p.el.tooltip.style.display, 'none');
});

// ─── positionTooltip ───────────────────────────────────────────────

test('positionTooltip places below the anchor by default, centered, arrow at the word center', () => {
  const p = page();
  p.window.innerHeight = 768; p.window.innerWidth = 1024;
  const a = p.anchor({ top: 100, bottom: 120, left: 300, width: 50 });
  p.el.tooltip.classList.add('we-above'); // must be cleared on every call
  p.internals.positionTooltip(a);
  assert.equal(p.el.tooltip.style.display, 'block');
  assert.equal(p.el.tooltip.style.top, '128px');   // bottom + 8
  assert.equal(p.el.tooltip.style.left, '225px');  // 325 - 200/2
  assert.ok(!p.el.tooltip.classList.contains('we-above'));
  assert.equal(p.el.tooltip.querySelector('.we-tooltip-arrow').style.left, '100px'); // 325 - 225
});

test('positionTooltip flips above (we-above) when it would overflow the bottom and there is room above', () => {
  const p = page();
  p.window.innerHeight = 200; p.window.innerWidth = 1024;
  const a = p.anchor({ top: 130, bottom: 150, left: 300, width: 50 });
  p.internals.positionTooltip(a);
  assert.equal(p.el.tooltip.style.top, '22px'); // 130 - 100 - 8
  assert.ok(p.el.tooltip.classList.contains('we-above'));
});

test('positionTooltip stays below when it overflows the bottom but there is no room above either', () => {
  const p = page();
  p.window.innerHeight = 200; p.window.innerWidth = 1024;
  const a = p.anchor({ top: 100, bottom: 120, left: 300, width: 50 });
  p.internals.positionTooltip(a);
  assert.equal(p.el.tooltip.style.top, '128px');
  assert.ok(!p.el.tooltip.classList.contains('we-above'));
});

test('positionTooltip clamps to the 8px margin at the left edge and the arrow to 12px', () => {
  const p = page();
  p.window.innerHeight = 768; p.window.innerWidth = 1024;
  const a = p.anchor({ top: 100, bottom: 120, left: 0, width: 20 });
  p.internals.positionTooltip(a);
  assert.equal(p.el.tooltip.style.left, '8px');
  assert.equal(p.el.tooltip.querySelector('.we-tooltip-arrow').style.left, '12px'); // raw 10 - 8 = 2
});

test('positionTooltip clamps to the 8px margin at the right edge and the arrow to tw-12', () => {
  const p = page();
  p.window.innerHeight = 768; p.window.innerWidth = 1024;
  const a = p.anchor({ top: 100, bottom: 120, left: 1000, width: 20 });
  p.internals.positionTooltip(a);
  assert.equal(p.el.tooltip.style.left, '816px'); // 1024 - 200 - 8
  assert.equal(p.el.tooltip.querySelector('.we-tooltip-arrow').style.left, '188px'); // raw 1010 - 816 = 194
});

// ─── document-level dismissal ──────────────────────────────────────

test('pointerdown outside hides an open tooltip; inside the tooltip or on a .we-word it does not', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') }, html: '<body><div class="we-word"><b id="inner">heel</b></div><p id="out">x</p></body>' });
  await p.internals.showTooltip('heel', p.anchor());
  p.timers.advance(16);

  p.pointerdown(p.el.tooltipBody.querySelector('.we-tooltip-word'));
  assert.ok(p.el.tooltip.classList.contains('we-visible'), 'press inside the tooltip keeps it');
  p.pointerdown(p.document.getElementById('inner'));
  assert.ok(p.el.tooltip.classList.contains('we-visible'), 'press on a .we-word descendant keeps it');

  p.pointerdown(p.document.getElementById('out'));
  assert.ok(!p.el.tooltip.classList.contains('we-visible'));
  p.timers.advance(150);
  assert.equal(p.el.tooltip.style.display, 'none');
});

test('pointerdown with no tooltip open is a no-op (no hide timer scheduled)', () => {
  const p = page({ html: '<body><p id="out">x</p></body>' });
  const before = p.timers.pending();
  p.pointerdown(p.document.getElementById('out'));
  assert.equal(p.timers.pending(), before);
  assert.equal(p.el.tooltip.style.display, 'none');
});

test('Escape closes an open tooltip and is preventDefault-ed', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') } });
  await p.internals.showTooltip('heel', p.anchor());
  p.timers.advance(16);
  assert.equal(p.key('Escape'), false);
  assert.ok(!p.el.tooltip.classList.contains('we-visible'));
  p.timers.advance(150);
  assert.equal(p.el.tooltip.style.display, 'none');
});

for (const cls of ['pz-icon-close', 'sb-modal-close', 'pz-moment__close']) {
  test(`Escape with no tooltip open clicks an NYT native close (.${cls})`, () => {
    const p = page({ html: `<body><button class="${cls}">x</button></body>` });
    let clicks = 0;
    p.document.querySelector(`.${cls}`).addEventListener('click', () => clicks++);
    assert.equal(p.key('Escape'), false);
    assert.equal(clicks, 1);
  });
}

test('Escape with nothing to close is left alone (not preventDefault-ed)', () => {
  const p = page();
  assert.equal(p.key('Escape'), true);
});

test('Escape with hints active stops hints rather than touching the tooltip', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') } });
  await p.internals.showTooltip('heel', p.anchor());
  p.timers.advance(16);
  p.key('?');
  assert.equal(p.internals.hints.state.active, true);
  assert.equal(p.key('Escape'), false);
  assert.equal(p.internals.hints.state.active, false);
  assert.ok(p.el.tooltip.classList.contains('we-visible'), 'tooltip untouched by the hints Escape');
});

test('non-Escape keys do not reach the dismiss logic', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') } });
  await p.internals.showTooltip('heel', p.anchor());
  p.timers.advance(16);
  assert.equal(p.key('a'), true);
  assert.ok(p.el.tooltip.classList.contains('we-visible'));
});

// ─── audio button (Merriam-Webster) ────────────────────────────────

function mwPage({ audio = 'heel0001', playResult = Promise.resolve() } = {}) {
  const created = [];
  let plays = 0;
  const p = page({
    gmValues: { mw_api_key: 'k' },
    defs: { heel: mwEntry('heel', audio) },
    onWindow: w => {
      w.Audio = class { constructor(src) { created.push(src); } play() { plays++; return playResult; } };
    },
  });
  return { ...p, created, plays: () => plays };
}

test('clicking .we-tooltip-audio constructs Audio with the data-audio URL and plays it', async () => {
  const p = mwPage();
  await p.internals.showTooltip('heel', p.anchor());
  assert.ok(p.requests.some(u => u.includes('dictionaryapi.com') && u.includes('key=k')));
  const btn = p.el.tooltipBody.querySelector('.we-tooltip-audio');
  assert.ok(btn, 'audio button rendered from the MW entry');
  assert.equal(btn.dataset.audio, 'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/heel0001.mp3');
  btn.click();
  assert.deepEqual(p.created, [btn.dataset.audio]);
  assert.equal(p.plays(), 1);
});

test('a rejected play() is swallowed', async () => {
  const p = mwPage({ playResult: Promise.reject(new Error('NotAllowedError')) });
  await p.internals.showTooltip('heel', p.anchor());
  p.el.tooltipBody.querySelector('.we-tooltip-audio').click();
  await p.flush(); // an unhandled rejection here would fail the test process
  assert.equal(p.plays(), 1);
});

test('an MW entry without audio renders no button and wires nothing', async () => {
  const p = mwPage({ audio: null });
  await p.internals.showTooltip('heel', p.anchor());
  assert.equal(p.el.tooltipBody.querySelector('.we-tooltip-audio'), null);
  assert.deepEqual(p.created, []);
});

// ─── Wikipedia image ───────────────────────────────────────────────

const THUMB = 'https://upload.wikimedia.org/t/heel.png';

test('a summary with a thumbnail inserts img.we-tooltip-img after the word heading and repositions', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') }, wiki: { heel: wikiSummary('heel', THUMB) } });
  const a = p.anchor();
  await p.internals.showTooltip('heel', a);
  await p.flush();
  const img = p.el.tooltipBody.querySelector('img.we-tooltip-img');
  assert.ok(img);
  assert.equal(img.src, THUMB);
  assert.equal(img.alt, '');
  assert.equal(img.previousElementSibling.className, 'we-tooltip-word');
  const after = a.rectCalls;
  assert.ok(after >= 3, 'repositioned once the image node is in');

  img.onload();
  assert.equal(a.rectCalls, after + 1, 'onload repositions for the decoded size');
  assert.ok(img.isConnected);

  img.onerror();
  assert.equal(a.rectCalls, after + 2, 'onerror repositions after removing the image');
  assert.equal(p.el.tooltipBody.querySelector('img'), null);
});

test('a summary without a thumbnail inserts no img', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') }, wiki: { heel: wikiSummary('heel') } });
  await p.internals.showTooltip('heel', p.anchor());
  await p.flush();
  assert.ok(p.requests.some(u => u.includes('/page/summary/heel')));
  assert.equal(p.el.tooltipBody.querySelector('img'), null);
});

test('an image resolving after hideTooltip is dropped', async () => {
  const p = page({ defs: { heel: datamuse('heel', 'x') }, wiki: { heel: wikiSummary('heel', THUMB) }, hold: u => u.includes('wikipedia') });
  await p.internals.showTooltip('heel', p.anchor());
  const req = p.takePending('wikipedia');
  assert.ok(req, 'image lookup is in flight');
  p.internals.hideTooltip();
  req.resolve();
  await p.flush();
  assert.equal(p.el.tooltipBody.querySelector('img'), null);
});

test('an image resolving after switching to another word is dropped', async () => {
  const p = page({
    defs: { heel: datamuse('heel', 'x'), hello: datamuse('hello', 'y') },
    wiki: { heel: wikiSummary('heel', THUMB) },
    hold: u => u.includes('wikipedia'),
  });
  const a = p.anchor();
  await p.internals.showTooltip('heel', a);
  const req = p.takePending('summary/heel');
  await p.internals.showTooltip('hello', a);
  req.resolve();
  await p.flush();
  assert.equal(p.el.tooltipBody.querySelector('.we-tooltip-word').textContent, 'hello');
  assert.equal(p.el.tooltipBody.querySelector('img'), null);
});

test('getWikiImage caches per word (case-insensitively) and resolves "" on failure', async () => {
  const p = page({ wiki: { heel: wikiSummary('heel', THUMB) } });
  const count = () => p.requests.filter(u => u.includes('wikipedia')).length;

  assert.equal(await p.internals.getWikiImage('heel'), THUMB);
  assert.equal(count(), 1);
  const again = p.internals.getWikiImage('HEEL');
  assert.equal(count(), 1, 'second call served from cache');
  assert.equal(await again, THUMB);

  assert.equal(await p.internals.getWikiImage('other'), '', 'HTTP 404 → no image');
  assert.equal(count(), 2);
  assert.equal(await p.internals.getWikiImage('other'), '');
  assert.equal(count(), 2, 'the failure is cached too');
});

test('getWikiImage resolves "" on a transport error', async () => {
  const p = page({ hold: u => u.includes('wikipedia') });
  const done = p.internals.getWikiImage('heel');
  p.takePending('wikipedia').fail();
  assert.equal(await done, '');
});
