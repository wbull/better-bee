// runGotItSequence(controller, ui, setTimeoutFn): the 400/600/400 ms "got it"
// animation chain, driven entirely through injected fakes and a fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

function run({ stopAt } = {}) {
  const { internals } = loadScript();
  const timers = makeFakeTimers();
  const log = [];
  const at = name => () => log.push(`${name}@${timers.now()}`);
  const ui = { showCheck: at('showCheck'), markGotIt: at('markGotIt'), hideToast: at('hideToast') };
  let active = true;
  const controller = {
    releaseGotIt: at('releaseGotIt'),
    next: () => { log.push(`next@${timers.now()}`); if (active) log.push('toast'); },
    stop: () => { active = false; },
  };
  if (stopAt !== undefined) timers.setTimeout(() => controller.stop(), stopAt);
  internals.runGotItSequence(controller, ui, timers.setTimeout);
  return { log, timers, ui };
}

test('shows the check now, marks got-it at 400, hides at 1000, then releases and advances at 1400', () => {
  const r = run();
  assert.deepEqual(r.log, ['showCheck@0']);
  r.timers.advance(399);
  assert.deepEqual(r.log, ['showCheck@0']);
  r.timers.advance(1);
  assert.deepEqual(r.log, ['showCheck@0', 'markGotIt@400']);
  r.timers.advance(600);
  assert.deepEqual(r.log.at(-1), 'hideToast@1000');
  r.timers.advance(399);
  assert.equal(r.log.length, 3);
  r.timers.advance(1);
  assert.deepEqual(r.log.slice(3), ['releaseGotIt@1400', 'next@1400', 'toast']);
});

test('release happens before next, so next is not blocked by the guard', () => {
  const r = run();
  r.timers.advance(1400);
  assert.ok(r.log.indexOf('releaseGotIt@1400') < r.log.indexOf('next@1400'));
});

test('if hints stop mid-sequence the chain still completes but next is a no-op', () => {
  const r = run({ stopAt: 500 });
  r.timers.advance(1400);
  assert.deepEqual(r.log, ['showCheck@0', 'markGotIt@400', 'hideToast@1000', 'releaseGotIt@1400', 'next@1400']);
});

test('uses only the injected timer', () => {
  const { internals } = loadScript();
  let scheduled = 0;
  const fake = (fn, ms) => { scheduled++; return 0; };
  internals.runGotItSequence({ releaseGotIt() {}, next() {} }, { showCheck() {}, markGotIt() {}, hideToast() {} }, fake);
  assert.equal(scheduled, 1); // outer step only; inner steps schedule when it fires
});
