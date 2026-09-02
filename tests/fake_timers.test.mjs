import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeTimers } from './fake_timers.mjs';

test('setTimeout fires at its due time, in order, including timers scheduled by callbacks', () => {
  const t = makeFakeTimers();
  const log = [];
  t.setTimeout(() => { log.push('a'); t.setTimeout(() => log.push('nested'), 10); }, 100);
  t.setTimeout(() => log.push('b'), 50);
  t.advance(99);
  assert.deepEqual(log, ['b']);
  t.advance(1);
  assert.deepEqual(log, ['b', 'a']);
  t.advance(10);
  assert.deepEqual(log, ['b', 'a', 'nested']);
  assert.equal(t.pending(), 0);
});

test('clearTimeout cancels a pending timer', () => {
  const t = makeFakeTimers();
  let ran = false;
  const id = t.setTimeout(() => { ran = true; }, 10);
  t.clearTimeout(id);
  t.advance(100);
  assert.equal(ran, false);
});

test('setInterval repeats every period until cleared, even from inside its own callback', () => {
  const t = makeFakeTimers();
  let n = 0;
  const id = t.setInterval(() => { n++; if (n === 3) t.clearInterval(id); }, 10);
  t.advance(25);
  assert.equal(n, 2);
  t.advance(100);
  assert.equal(n, 3);
  assert.equal(t.pending(), 0);
});

test('install() replaces the window clock and rAF', () => {
  const t = makeFakeTimers();
  const win = {};
  t.install(win);
  let frame = null;
  win.requestAnimationFrame(ts => { frame = ts; });
  t.advance(16);
  assert.equal(frame, 16);
  assert.equal(win.setInterval, t.setInterval);
});
