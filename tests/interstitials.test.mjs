// Play/Resume interstitial auto-dismiss through the real script: a 200ms poll
// clicks the right button / removes the splash, stops once it handled something,
// keeps polling past non-matching buttons, and gives up after 10s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

function page(html = '<body></body>') {
  const timers = makeFakeTimers();
  const ctx = loadScript({ timers, html, localStorage: { betterBee_onboardingSeen: '1' } });
  const clicks = [];
  // A button whose click() is recorded instead of dispatched.
  const addButton = ({ text = 'Play', className = 'pz-moment__button primary', parent = ctx.document.body } = {}) => {
    const b = ctx.document.createElement('button');
    b.className = className;
    b.textContent = text;
    b.click = () => clicks.push(text);
    parent.appendChild(b);
    return b;
  };
  const addModal = (opts) => {
    const modal = ctx.document.createElement('div');
    modal.className = 'pz-moment';
    ctx.document.body.appendChild(modal);
    const btn = addButton({ parent: modal, ...opts });
    return { modal, btn };
  };
  return { ...ctx, timers, clicks, addButton, addModal };
}

test('a Play modal present at load is clicked and removed on the first 200ms tick, not before', () => {
  const p = page();
  const { modal } = p.addModal({ text: 'Play' });
  p.timers.advance(199);
  assert.deepEqual(p.clicks, []);
  assert.equal(modal.isConnected, true);
  p.timers.advance(1);
  assert.deepEqual(p.clicks, ['Play']);
  assert.equal(modal.isConnected, false);
});

test('once something was handled the poll stops: a later modal is never touched', () => {
  const p = page();
  p.addModal({ text: 'Play' });
  p.timers.advance(200);
  assert.deepEqual(p.clicks, ['Play']);
  const later = p.addModal({ text: 'Resume' });
  p.timers.advance(2000);
  assert.deepEqual(p.clicks, ['Play']);
  assert.equal(later.modal.isConnected, true);
});

test('button text matches play / resume / continue case-insensitively', () => {
  for (const text of ['RESUME', 'Continue', '  play  ']) {
    const p = page();
    p.addButton({ text });
    p.timers.advance(200);
    assert.deepEqual(p.clicks, [text], `expected "${text}" to be clicked`);
  }
});

test('a .pz-moment__close is clicked regardless of its text', () => {
  const p = page();
  const { modal } = p.addModal({ text: '×', className: 'pz-moment__close' });
  p.timers.advance(200);
  assert.deepEqual(p.clicks, ['×']);
  assert.equal(modal.isConnected, false);
});

test('a primary button with other text (Subscribe) is not clicked and the poll keeps going', () => {
  const p = page();
  const sub = p.addButton({ text: 'Subscribe' });
  p.timers.advance(600);
  assert.deepEqual(p.clicks, []);
  assert.equal(sub.isConnected, true);
  // Still polling: a Play button that shows up now is handled on the next tick.
  p.addButton({ text: 'Play' });
  p.timers.advance(200);
  assert.deepEqual(p.clicks, ['Play']);
});

test('the loading splash is removed even without a button, and that ends the poll', () => {
  const p = page('<body><div id="js-hook-pz-moment__loading">loading</div></body>');
  const splash = p.document.getElementById('js-hook-pz-moment__loading');
  p.timers.advance(200);
  assert.equal(splash.isConnected, false);
  // Poll has stopped: a modal arriving afterwards stays.
  const { modal } = p.addModal({ text: 'Play' });
  p.timers.advance(1000);
  assert.deepEqual(p.clicks, []);
  assert.equal(modal.isConnected, true);
});

test('with nothing to dismiss the poll gives up at 10s: a button appearing at 10.2s is not clicked', () => {
  const p = page();
  p.timers.advance(10000);
  assert.deepEqual(p.clicks, []);
  const { modal } = p.addModal({ text: 'Play' });
  p.timers.advance(200);
  assert.equal(p.timers.now(), 10200);
  assert.deepEqual(p.clicks, []);
  assert.equal(modal.isConnected, true);
});

test('a button appearing just before the deadline is still handled', () => {
  const p = page();
  p.timers.advance(9700);
  p.addModal({ text: 'Play' });
  p.timers.advance(200); // tick at 9800
  assert.deepEqual(p.clicks, ['Play']);
});
