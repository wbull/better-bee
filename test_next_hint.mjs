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

// nextHint now calls showHintToastFn(entry.hint) directly (always compact).
function nextHint(state, buildHintQueueFn, showHintToastFn, stopHintsFn) {
  if (!state.hintActive) return;

  // If queue exhausted, rebuild
  if (state.hintIndex >= state.hintQueue.length) {
    state.hintQueue = buildHintQueueFn();
    state.hintIndex = 0;

    if (state.hintQueue === null) {
      showHintToastFn('Hints unavailable');
      setTimeout(() => { stopHintsFn(); }, 3000);
      return;
    }
    if (state.hintQueue.length === 0) {
      showHintToastFn('You found them all!');
      setTimeout(() => { stopHintsFn(); }, 3000);
      return;
    }
  }

  state.hintIndex++;
  const entry = state.hintQueue[state.hintIndex - 1];
  showHintToastFn(entry.hint);
}

console.log('\nnextHint:');

const makeQueue = (...words) => words.map(w => ({ word: w.toLowerCase(), hint: w.toUpperCase().slice(0, 2) + '.. ' + w.length }));

test('advances hintIndex on each call', () => {
  const shown = [];
  const state = { hintActive: true, hintQueue: makeQueue('batch', 'crackle', 'amble'), hintIndex: 0 };
  nextHint(state, () => null, (t) => shown.push(t), () => {});
  assert.strictEqual(state.hintIndex, 1);
  nextHint(state, () => null, (t) => shown.push(t), () => {});
  assert.strictEqual(state.hintIndex, 2);
});

test('calls showHintToast with the hint string', () => {
  const shown = [];
  const state = { hintActive: true, hintQueue: makeQueue('batch', 'crackle'), hintIndex: 0 };
  nextHint(state, () => null, (t) => shown.push(t), () => {});
  assert.strictEqual(shown[0], 'BA.. 5');
  nextHint(state, () => null, (t) => shown.push(t), () => {});
  assert.strictEqual(shown[1], 'CR.. 7');
});

test('rebuilds queue when index exceeds length', () => {
  const shown = [];
  const newQueue = makeQueue('xyz');
  const state = { hintActive: true, hintQueue: makeQueue('batch'), hintIndex: 1 }; // exhausted
  nextHint(state, () => newQueue, (t) => shown.push(t), () => {});
  assert.deepStrictEqual(state.hintQueue, newQueue);
  assert.strictEqual(shown[0], 'XY.. 3');
  assert.strictEqual(state.hintIndex, 1);
});

test('shows "Hints unavailable" when rebuild returns null', () => {
  const shown = [];
  const state = { hintActive: true, hintQueue: [], hintIndex: 0 }; // will trigger rebuild
  nextHint(state, () => null, (t) => shown.push(t), () => {});
  assert.strictEqual(shown[0], 'Hints unavailable');
});

test('shows "You found them all!" when rebuild returns []', () => {
  const shown = [];
  const state = { hintActive: true, hintQueue: [], hintIndex: 0 }; // will trigger rebuild
  nextHint(state, () => [], (t) => shown.push(t), () => {});
  assert.strictEqual(shown[0], 'You found them all!');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
