// First-run onboarding overlay: the real welcome dialog built by better_bee.user.js
// when localStorage has no `betterBee_onboardingSeen`, driven with fake timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const OB_SEL = '.ob-overlay[aria-label="Welcome to Better Bee"]';
const HIVE = '<body><div class="sb-hive-input-content"></div></body>';
const POLL = 200, SETTLE = 500, RAF = 16;

function boot(opts = {}) {
  const timers = makeFakeTimers();
  const ctx = loadScript({ html: HIVE, timers, ...opts });
  const overlay = ctx.document.querySelector(OB_SEL);
  return { ...ctx, timers, overlay };
}

// Poll fires, settle elapses, rAF paints: overlay is visible and focused.
const show = t => t.advance(POLL + SETTLE + RAF);

const keydown = (w, el, init) => {
  const e = new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};

function assertDismissed({ window, document, internals, overlay, timers }) {
  assert.equal(window.localStorage.getItem('betterBee_onboardingSeen'), '1');
  assert.equal(internals.onboardingActive, false);
  assert.ok(!overlay.classList.contains('we-visible'));
  assert.ok(document.body.contains(overlay), 'overlay stays for the fade-out');
  timers.advance(199);
  assert.ok(document.body.contains(overlay), 'not removed before 200ms');
  timers.advance(1);
  assert.ok(!document.body.contains(overlay), 'removed at 200ms');
}

// ─── Appearance ────────────────────────────────────────────────────

test('first run: overlay is built hidden, marks onboarding active, and the splash is not shown', () => {
  const { overlay, internals, document } = boot();
  assert.ok(overlay, 'welcome overlay exists');
  assert.equal(overlay.getAttribute('role'), 'dialog');
  assert.equal(overlay.getAttribute('aria-modal'), 'true');
  assert.equal(overlay.style.display, 'none');
  assert.equal(internals.onboardingActive, true);
  assert.equal(document.querySelectorAll('.ob-overlay').length, 1);
  assert.ok(overlay.querySelector('.ob-cta'), 'CTA button');
  assert.ok(overlay.querySelector('.ob-close'), 'close button');
});

test('already seen: no overlay and onboarding is not active', () => {
  const { overlay, internals } = boot({ localStorage: { betterBee_onboardingSeen: '1' } });
  assert.equal(overlay, null);
  assert.equal(internals.onboardingActive, false);
});

test('shows 500ms after the hive input is detected: display flex, then we-visible + CTA focus on the next frame', () => {
  const { overlay, timers, document } = boot();
  timers.advance(POLL - 1);
  assert.equal(overlay.style.display, 'none', 'poll has not fired yet');
  timers.advance(1);
  assert.equal(overlay.style.display, 'none', 'poll fired; settle pending');
  timers.advance(SETTLE - 1);
  assert.equal(overlay.style.display, 'none');
  timers.advance(1);
  assert.equal(overlay.style.display, 'flex');
  assert.ok(!overlay.classList.contains('we-visible'), 'class waits for rAF');
  timers.advance(RAF);
  assert.ok(overlay.classList.contains('we-visible'));
  assert.equal(document.activeElement, overlay.querySelector('.ob-cta'));
});

test('waits for the hive input to appear before showing', () => {
  const { overlay, timers, document } = boot({ html: '<body></body>' });
  timers.advance(POLL * 10);
  assert.equal(overlay.style.display, 'none', 'nothing to show while the puzzle DOM is missing');
  const hive = document.createElement('div');
  hive.className = 'sb-hive-input-content';
  document.body.appendChild(hive);
  show(timers);
  assert.equal(overlay.style.display, 'flex');
  assert.ok(overlay.classList.contains('we-visible'));
});

test('gives up polling after 15s: a late hive input no longer shows the overlay', () => {
  const { overlay, timers, document } = boot({ html: '<body></body>' });
  timers.advance(15000);
  const hive = document.createElement('div');
  hive.className = 'sb-hive-input-content';
  document.body.appendChild(hive);
  timers.advance(5000);
  assert.equal(overlay.style.display, 'none');
  assert.ok(!overlay.classList.contains('we-visible'));
});

// ─── Dismissal ─────────────────────────────────────────────────────

test('CTA click dismisses: flag set, class removed, overlay removed at +200ms, bee flies in +300ms later', () => {
  const ctx = boot();
  const { overlay, timers, document } = ctx;
  show(timers);
  const bee = document.getElementById('bee-buddy');
  assert.ok(bee, 'bee buddy present');
  assert.ok(!bee.classList.contains('we-arrived'), 'fly-in suppressed while onboarding is open');

  overlay.querySelector('.ob-cta').click();
  assertDismissed(ctx);

  assert.ok(!bee.classList.contains('we-arrived'), 'fly-in scheduled, not immediate');
  timers.advance(299);
  assert.ok(!bee.classList.contains('we-arrived'));
  timers.advance(1);
  assert.ok(bee.classList.contains('we-arrived'), 'bee arrives 300ms after the overlay is removed');
});

test('close button dismisses', () => {
  const ctx = boot();
  show(ctx.timers);
  ctx.overlay.querySelector('.ob-close').click();
  assertDismissed(ctx);
});

test('backdrop click (target is the overlay itself) dismisses', () => {
  const ctx = boot();
  show(ctx.timers);
  ctx.overlay.click();
  assertDismissed(ctx);
});

test('clicks inside the panel do not dismiss', () => {
  const { overlay, timers, internals, window } = boot();
  show(timers);
  overlay.querySelector('.ob-panel').click();
  overlay.querySelector('.ob-title').click();
  overlay.querySelector('.ob-features li').click();
  assert.equal(internals.onboardingActive, true);
  assert.ok(overlay.classList.contains('we-visible'));
  assert.equal(window.localStorage.getItem('betterBee_onboardingSeen'), null);
});

test('Escape dismisses and is stopped before it reaches document-level listeners', () => {
  const ctx = boot();
  const { overlay, timers, document, window } = ctx;
  show(timers);
  let seenByDocument = 0;
  document.addEventListener('keydown', () => { seenByDocument++; });

  keydown(window, overlay.querySelector('.ob-cta'), { key: 'Escape' });

  assert.equal(seenByDocument, 0, 'stopPropagation keeps Escape off the page');
  assertDismissed(ctx);
});

test('a non-Escape key inside the overlay still propagates to the document', () => {
  const { overlay, timers, document, window, internals } = boot();
  show(timers);
  let seenByDocument = 0;
  document.addEventListener('keydown', () => { seenByDocument++; });
  const e = keydown(window, overlay.querySelector('.ob-cta'), { key: 'a' });
  assert.equal(seenByDocument, 1);
  assert.equal(e.defaultPrevented, false);
  assert.equal(internals.onboardingActive, true, 'not dismissed');
});

// ─── Focus trap ────────────────────────────────────────────────────

test('focus trap: Tab on the last focusable wraps to the first (preventDefault)', () => {
  const { overlay, timers, document, window } = boot();
  show(timers);
  const close = overlay.querySelector('.ob-close');
  const cta = overlay.querySelector('.ob-cta');
  const focusables = [...overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')];
  assert.equal(focusables[0], close);
  assert.equal(focusables[focusables.length - 1], cta);

  cta.focus();
  const e = keydown(window, cta, { key: 'Tab' });
  assert.equal(e.defaultPrevented, true);
  assert.equal(document.activeElement, close);
});

test('focus trap: Shift+Tab on the first focusable wraps to the last (preventDefault)', () => {
  const { overlay, timers, document, window } = boot();
  show(timers);
  const close = overlay.querySelector('.ob-close');
  const cta = overlay.querySelector('.ob-cta');

  close.focus();
  const e = keydown(window, close, { key: 'Tab', shiftKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(document.activeElement, cta);
});

test('focus trap: Tab from the first and Shift+Tab from the last are left to the browser', () => {
  const { overlay, timers, document, window } = boot();
  show(timers);
  const close = overlay.querySelector('.ob-close');
  const cta = overlay.querySelector('.ob-cta');

  close.focus();
  let e = keydown(window, close, { key: 'Tab' });
  assert.equal(e.defaultPrevented, false);
  assert.equal(document.activeElement, close);

  cta.focus();
  e = keydown(window, cta, { key: 'Tab', shiftKey: true });
  assert.equal(e.defaultPrevented, false);
  assert.equal(document.activeElement, cta);
});
