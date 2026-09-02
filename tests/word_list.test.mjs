import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';

// NYT renders each found word as an anagram span plus a visually-hidden twin
// (the hidden span gains " (pangram)" on the pangram), so li.textContent doubles up.
const nytLi = (word, { pangram = false } = {}) =>
  `<li><span class="sb-anagram${pangram ? ' pangram' : ''}" aria-hidden="true">${word}</span>` +
  `<span class="visually-hidden">${word}${pangram ? ' (pangram)' : ''}</span></li>`;

// processWordList runs once at script load, so the word-list markup goes in `html`.
// Network is stubbed to never resolve: prefetch/tooltip lookups stay pending.
function load(bodyInner) {
  return loadScript({
    html: `<body>${bodyInner}</body>`,
    gmXhrImpl: () => {},
    fetchImpl: () => new Promise(() => {}),
  });
}
const pag = inner => `<ul class="sb-wordlist-items-pag">${inner}</ul>`;
const found = ctx => ctx.internals.getFoundWords();

// ─── getFoundWords ─────────────────────────────────────────────────

test('getFoundWords collects from .sb-wordlist-items-pag li', () => {
  const ctx = load(pag('<li>batch</li><li>crackle</li>'));
  const set = found(ctx);
  assert.ok(set.has('batch'));
  assert.ok(set.has('crackle'));
  assert.equal(set.size, 2);
});

test('getFoundWords collects from .sb-recent-words li', () => {
  const ctx = load('<ul class="sb-recent-words"><li>amble</li></ul>');
  assert.ok(found(ctx).has('amble'));
});

test('getFoundWords collects from .sb-wordlist-window li', () => {
  const ctx = load('<div class="sb-wordlist-window"><ul><li>amble</li></ul></div>');
  assert.ok(found(ctx).has('amble'));
});

test('getFoundWords deduplicates across selectors', () => {
  const ctx = load(pag('<li>batch</li>') + '<ul class="sb-recent-words"><li>batch</li></ul>');
  assert.equal(found(ctx).size, 1);
});

test('getFoundWords lowercases words', () => {
  const ctx = load(pag('<li>BATCH</li>'));
  const set = found(ctx);
  assert.ok(set.has('batch'));
  assert.ok(!set.has('BATCH'));
});

test('getFoundWords ignores empty li elements', () => {
  const ctx = load(pag('<li></li><li>  </li><li>batch</li>'));
  const set = found(ctx);
  assert.equal(set.size, 1);
  assert.ok(set.has('batch'));
});

test('getFoundWords returns an empty Set when there are no words', () => {
  const ctx = load('<div></div>');
  assert.equal(found(ctx).size, 0);
});

test('getFoundWords extracts a single word from NYT sb-anagram + visually-hidden li', () => {
  const ctx = load(pag(nytLi('mewl')));
  const set = found(ctx);
  assert.ok(set.has('mewl'), 'expected found set to contain "mewl"');
  assert.ok(!set.has('mewlmewl'), 'expected found set NOT to contain doubled "mewlmewl"');
});

test('getFoundWords strips the " (pangram)" suffix on the pangram li', () => {
  const ctx = load(pag(nytLi('windmilled', { pangram: true })));
  const set = found(ctx);
  assert.ok(set.has('windmilled'));
  assert.ok(!set.has('windmilledwindmilled (pangram)'));
});

// ─── processWordList (decoration) ──────────────────────────────────

test('processWordList adds the we-word class', () => {
  const { document } = load(pag('<li>batch</li>'));
  assert.ok(document.querySelector('li').classList.contains('we-word'));
});

test('processWordList sets role="button", aria-label and makes the li focusable', () => {
  const { document } = load(pag('<li>batch</li>'));
  const li = document.querySelector('li');
  assert.equal(li.getAttribute('role'), 'button');
  assert.equal(li.getAttribute('aria-label'), 'Look up batch');
  assert.equal(li.tabIndex, 0);
});

test('processWordList skips words shorter than 4 chars', () => {
  const { document } = load(pag('<li>bat</li>'));
  const li = document.querySelector('li');
  assert.ok(!li.classList.contains('we-word'));
  assert.equal(li.getAttribute('role'), null);
  assert.equal(li.dataset.weProcessed, '1', 'short words are still marked processed');
});

test('processWordList marks items as processed and is idempotent', () => {
  const ctx = load(pag('<li>batch</li>'));
  ctx.internals.processWordList(); // second call on top of the load-time run
  const li = ctx.document.querySelector('li');
  assert.equal(li.dataset.weProcessed, '1');
  assert.ok(li.classList.contains('we-word'));
  assert.equal(li.getAttribute('aria-label'), 'Look up batch');
});

test('processWordList handles an empty list', () => {
  const { document, internals } = load(pag(''));
  internals.processWordList(); // must not throw
  assert.equal(document.querySelectorAll('.we-word').length, 0);
});

test('processWordList decorates words added after load (via an explicit re-run)', () => {
  const ctx = load(pag('<li>batch</li>'));
  const ul = ctx.document.querySelector('ul');
  ul.insertAdjacentHTML('beforeend', '<li>crackle</li>');
  ctx.internals.processWordList();
  const items = [...ul.querySelectorAll('li')];
  assert.deepEqual(items.map(li => li.getAttribute('aria-label')), ['Look up batch', 'Look up crackle']);
});

test('aria-label uses the sb-anagram word, not the doubled textContent', () => {
  const { document } = load(pag(nytLi('mewl')));
  assert.equal(document.querySelector('li').getAttribute('aria-label'), 'Look up mewl');
});

test('aria-label for the pangram excludes the " (pangram)" suffix', () => {
  const { document } = load(pag(nytLi('windmilled', { pangram: true })));
  assert.equal(document.querySelector('li').getAttribute('aria-label'), 'Look up windmilled');
});

// ─── processWordList (event wiring → showTooltip) ──────────────────

const tooltipShown = ctx => {
  const { tooltip, tooltipBody } = ctx.internals.elements;
  return tooltip.style.display === 'block' && !!tooltipBody.querySelector('.we-tooltip-loading');
};

test('clicking a decorated li shows the tooltip in its loading state', () => {
  const ctx = load(pag(nytLi('mewl')));
  const li = ctx.document.querySelector('li');
  assert.equal(ctx.internals.elements.tooltip.style.display, 'none', 'hidden before click');
  const notCancelled = li.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(notCancelled, false, 'click is preventDefaulted');
  assert.ok(tooltipShown(ctx));
  assert.match(ctx.internals.elements.tooltipBody.textContent, /Loading/);
});

test('pressing Enter on a decorated li shows the tooltip', () => {
  const ctx = load(pag(nytLi('mewl')));
  const li = ctx.document.querySelector('li');
  const notCancelled = li.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(notCancelled, false, 'Enter is preventDefaulted');
  assert.ok(tooltipShown(ctx));
});

test('pressing Space on a decorated li shows the tooltip', () => {
  const ctx = load(pag(nytLi('mewl')));
  const li = ctx.document.querySelector('li');
  const notCancelled = li.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  assert.equal(notCancelled, false, 'Space is preventDefaulted');
  assert.ok(tooltipShown(ctx));
});

test('other keys on a decorated li do nothing', () => {
  const ctx = load(pag(nytLi('mewl')));
  const li = ctx.document.querySelector('li');
  const notCancelled = li.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
  assert.equal(notCancelled, true);
  assert.equal(ctx.internals.elements.tooltip.style.display, 'none');
});

test('pointerdown and mousedown on a decorated li are preventDefaulted and do not propagate', () => {
  const ctx = load(pag(nytLi('mewl')));
  const li = ctx.document.querySelector('li');
  const reached = [];
  ctx.document.addEventListener('pointerdown', e => reached.push(e.type));
  ctx.document.addEventListener('mousedown', e => reached.push(e.type));
  const pd = li.dispatchEvent(new ctx.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  const md = li.dispatchEvent(new ctx.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(pd, false, 'pointerdown is preventDefaulted');
  assert.equal(md, false, 'mousedown is preventDefaulted');
  assert.deepEqual(reached, [], 'neither event bubbles past the li');
  assert.equal(ctx.internals.elements.tooltip.style.display, 'none', 'press alone does not open the tooltip');
});

test('a short (undecorated) li gets no handlers: click is not cancelled and shows nothing', () => {
  const ctx = load(pag('<li>bat</li>'));
  const li = ctx.document.querySelector('li');
  const notCancelled = li.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(notCancelled, true);
  assert.equal(ctx.internals.elements.tooltip.style.display, 'none');
});
