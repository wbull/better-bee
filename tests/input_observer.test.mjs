// hookInputObserver through the real script: bee fly-in timing (suppressed by
// onboarding), idempotent attachment, the retry from the main observer when the
// hive input shows up late, and lastInputText tracking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const INPUT_HTML = '<div class="sb-hive-input-content"></div>';

function page({ html = '<body></body>', onboardingSeen = true } = {}) {
  const timers = makeFakeTimers();
  // Record every MutationObserver.observe() target so a test can prove that a
  // repeat hookInputObserver() call attaches nothing new.
  const observed = [];
  const ctx = loadScript({
    timers,
    html,
    localStorage: onboardingSeen ? { betterBee_onboardingSeen: '1' } : {},
    onWindow: w => {
      const realObserve = w.MutationObserver.prototype.observe;
      w.MutationObserver.prototype.observe = function (target, opts) {
        observed.push(target);
        return realObserve.call(this, target, opts);
      };
    },
  });
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  const input = () => ctx.document.querySelector('.sb-hive-input-content');
  const observersOn = el => observed.filter(t => t === el).length;
  return { ...ctx, timers, flush, input, observersOn, bee: ctx.document.getElementById('bee-buddy') };
}

test('with the hive input present at load the bee arrives at +1000ms', () => {
  const p = page({ html: `<body>${INPUT_HTML}</body>` });
  assert.equal(p.internals.onboardingActive, false);
  p.timers.advance(999);
  assert.ok(!p.bee.classList.contains('we-arrived'));
  p.timers.advance(1);
  assert.ok(p.bee.classList.contains('we-arrived'));
});

test('the fly-in is suppressed while onboarding is active (first run)', () => {
  const p = page({ html: `<body>${INPUT_HTML}</body>`, onboardingSeen: false });
  assert.equal(p.internals.onboardingActive, true);
  assert.ok(p.document.querySelector('.ob-overlay'), 'onboarding overlay is open');
  p.timers.advance(5000);
  assert.ok(!p.bee.classList.contains('we-arrived'));
});

test('typing into the hive is tracked in lastInputText', async () => {
  const p = page({ html: `<body>${INPUT_HTML}</body>` });
  assert.equal(p.internals.lastInputText, '');
  p.input().textContent = '  heel ';
  await p.flush();
  assert.equal(p.internals.lastInputText, 'heel', 'trimmed');
});

test('clearing the hive keeps the last word (that is the point of tracking it)', async () => {
  const p = page({ html: `<body>${INPUT_HTML}</body>` });
  p.input().textContent = 'hello';
  await p.flush();
  p.input().textContent = '';
  await p.flush();
  assert.equal(p.internals.lastInputText, 'hello');
});

test('hookInputObserver is idempotent: a repeat call attaches no second observer', async () => {
  const p = page({ html: `<body>${INPUT_HTML}</body>` });
  const el = p.input();
  assert.equal(p.observersOn(el), 1, 'attached once at load');
  p.internals.hookInputObserver();
  p.internals.hookInputObserver();
  assert.equal(p.observersOn(el), 1);
  p.input().textContent = 'other';
  await p.flush();
  assert.equal(p.internals.lastInputText, 'other');
});

test('when the hive input appears later, the main observer retry attaches it', async () => {
  const p = page();
  assert.equal(p.input(), null);
  const el = p.document.createElement('div');
  el.className = 'sb-hive-input-content';
  p.document.body.appendChild(el);
  assert.equal(p.observersOn(el), 0, 'not attached synchronously');
  await p.flush(); // main observer delivery → hookInputObserver() retry
  assert.equal(p.observersOn(el), 1);
  el.textContent = 'relate';
  await p.flush();
  assert.equal(p.internals.lastInputText, 'relate');
  // The bee fly-in is scheduled from the retry, not from load.
  p.timers.advance(1000);
  assert.ok(p.bee.classList.contains('we-arrived'));
});

test('with no hive input the bee never arrives on its own', async () => {
  const p = page();
  p.document.body.appendChild(p.document.createElement('div')); // unrelated churn
  await p.flush();
  p.timers.advance(5000);
  assert.ok(!p.bee.classList.contains('we-arrived'));
  assert.equal(p.internals.lastInputText, '');
});
