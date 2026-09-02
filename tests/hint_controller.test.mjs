// The hint controller is a factory inside the IIFE: all hint state and logic behind
// a small interface, with every side effect injected. These tests build their own
// instance with recording fakes, so no DOM and no real timers are involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, plain } from './harness.mjs';
import { makeFakeTimers } from './fake_timers.mjs';

const ANSWERS = ['heel', 'hello', 'other', 'relate', 'tether', 'theater'];

function build({
  answers = ANSWERS,
  found = [],
  puzzleId = 1,
  clues = null,          // array for fetchClueData to resolve with, or null
  clueLatency = 0,       // ms before fetchClueData resolves (0 = next microtask)
  random = () => 0.999,  // keeps buildHintQueue in answer order
} = {}) {
  const { internals } = loadScript();
  const timers = makeFakeTimers();
  const calls = [];
  const record = name => (...args) => calls.push({ name, args: plain(args), at: timers.now() });
  const uiNames = ['showToast', 'hideToast', 'showClueLoading', 'showClue', 'collapseClue',
    'showCheck', 'markGotIt', 'beeExit', 'beeExited', 'beeReset', 'beeReturn'];
  const ui = Object.fromEntries(uiNames.map(n => [n, record(n)]));
  let expanded = false;
  ui.isClueExpanded = () => expanded;
  ui.showClueLoading = (...a) => { expanded = true; record('showClueLoading')(...a); };
  ui.collapseClue = (...a) => { expanded = false; record('collapseClue')(...a); };

  const env = { answers, found: new Set(found), puzzleId, clues, fetches: 0 };
  const deps = {
    getAnswers: () => env.answers,
    getFoundWords: () => env.found,
    getPuzzleId: () => env.puzzleId,
    fetchClueData: () => {
      env.fetches++;
      return new Promise(resolve => {
        if (clueLatency > 0) timers.setTimeout(() => resolve(env.clues), clueLatency);
        else resolve(env.clues);
      });
    },
    ui,
    setTimeout: timers.setTimeout,
    random,
  };
  const hints = internals.createHintController(deps);
  const names = () => calls.map(c => c.name);
  const toasts = () => calls.filter(c => c.name === 'showToast').map(c => c.args[0]);
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  return { hints, ui, calls, names, toasts, timers, env, flush };
}

// ─── start ──────────────────────────────────────────────────────────

test('start with no puzzle data shows "Hints unavailable", stays inactive, hides at exactly 3s', () => {
  const b = build({ answers: null });
  b.hints.start();
  assert.deepEqual(b.toasts(), ['Hints unavailable']);
  assert.equal(b.hints.state.active, false);
  b.timers.advance(2999);
  assert.ok(!b.names().includes('hideToast'));
  b.timers.advance(1);
  assert.ok(b.names().includes('hideToast'));
  assert.ok(!b.names().includes('beeExit'));
});

test('start with everything found congratulates and does not activate', () => {
  const b = build({ found: ANSWERS });
  b.hints.start();
  assert.deepEqual(b.toasts(), ['You found them all!']);
  assert.equal(b.hints.state.active, false);
  b.timers.advance(3000);
  assert.ok(b.names().includes('hideToast'));
  assert.ok(!b.names().includes('beeExit'));
});

test('start happy path: bee exits now, exited at +600, first hint toast at +450', () => {
  const b = build();
  b.hints.start();
  assert.equal(b.hints.state.active, true);
  assert.deepEqual(b.names(), ['beeExit']);
  b.timers.advance(449);
  assert.deepEqual(b.toasts(), []);
  b.timers.advance(1);
  assert.deepEqual(plain(b.toasts()), [{ word: 'heel', hint: 'HE.. 4' }]);
  assert.equal(b.hints.state.index, 1);
  b.timers.advance(150);
  assert.equal(b.calls.find(c => c.name === 'beeExited').at, 600);
});

test('start pre-fetches clues in the background', async () => {
  const b = build({ clues: [] });
  b.hints.start();
  await b.flush();
  assert.equal(b.env.fetches, 1);
});

test('stop before the 450ms first-hint timer cancels both the hint and the bee-exited step', () => {
  const b = build();
  b.hints.start();
  b.timers.advance(300);
  b.hints.stop();
  b.timers.advance(1000);
  assert.deepEqual(b.toasts(), []);
  assert.ok(!b.names().includes('beeExited'));
  assert.equal(b.hints.state.active, false);
});

// ─── stop ───────────────────────────────────────────────────────────

test('stop hides the toast, resets the bee immediately and returns it at +400', () => {
  const b = build();
  b.hints.start();
  b.calls.length = 0;
  b.hints.stop();
  assert.deepEqual(b.names(), ['hideToast', 'beeReset']);
  b.timers.advance(399);
  assert.ok(!b.names().includes('beeReturn'));
  b.timers.advance(1);
  assert.ok(b.names().includes('beeReturn'));
});

// ─── next ───────────────────────────────────────────────────────────

test('next does nothing while inactive', () => {
  const b = build();
  b.hints.next();
  assert.deepEqual(b.calls, []);
  assert.equal(b.hints.state.index, 0);
});

test('next advances through the queue in order', () => {
  const b = build();
  b.hints.start();
  b.timers.advance(450);
  b.hints.next();
  b.hints.next();
  assert.deepEqual(b.toasts().map(t => t.word), ['heel', 'hello', 'other']);
  assert.equal(b.hints.state.index, 3);
});

test('next skips queued words found since the queue was built', () => {
  const b = build();
  b.hints.start();
  b.timers.advance(450);
  b.env.found.add('hello');
  b.env.found.add('other');
  b.hints.next();
  assert.equal(b.toasts().at(-1).word, 'relate');
  assert.equal(b.hints.state.index, 4);
});

test('next rebuilds the queue when it is exhausted', () => {
  const b = build({ answers: ['heel', 'hello'] });
  b.hints.start();
  b.timers.advance(450);
  b.hints.next();
  assert.equal(b.hints.state.index, 2);
  b.hints.next(); // exhausted → rebuild → first entry again
  assert.equal(b.hints.state.index, 1);
  assert.equal(b.toasts().at(-1).word, 'heel');
  assert.equal(b.hints.state.queueLength, 2);
});

test('next: when the rebuilt queue is exhausted on the second pass it congratulates and stops at +3s', () => {
  const b = build({ answers: ['heel', 'hello'] });
  b.hints.start();
  b.timers.advance(450);
  b.env.found.add('heel');
  b.env.found.add('hello');
  b.hints.next();
  assert.equal(b.toasts().at(-1), 'You found them all!');
  assert.equal(b.hints.state.active, true);
  b.timers.advance(3000);
  assert.equal(b.hints.state.active, false);
  assert.ok(b.names().includes('beeReset'));
});

test('next with puzzle data gone mid-session says hints unavailable and stops at +3s', () => {
  const b = build({ answers: ['heel'] });
  b.hints.start();
  b.timers.advance(450);
  b.env.answers = null;
  b.hints.next();
  assert.equal(b.toasts().at(-1), 'Hints unavailable');
  b.timers.advance(3000);
  assert.equal(b.hints.state.active, false);
});

test('next is a no-op while a got-it dismissal is armed, and resumes after release', () => {
  const b = build();
  b.hints.start();
  b.timers.advance(450);
  assert.equal(b.hints.armGotIt('heel'), true);
  b.hints.next();
  assert.equal(b.hints.state.index, 1);
  b.hints.releaseGotIt();
  b.hints.next();
  assert.equal(b.hints.state.index, 2);
});

// ─── matches / currentEntry / armGotIt ──────────────────────────────

test('matches: exact word, case-insensitive', () => {
  const b = build({ answers: ['batch'] });
  b.hints.start();
  b.timers.advance(450);
  assert.equal(b.hints.matches('batch'), true);
  assert.equal(b.hints.matches('BATCH'), true);
});

test('matches: prefix + length fallback, and rejects wrong prefix or length', () => {
  const b = build({ answers: ['batch'] });
  b.hints.start();
  b.timers.advance(450);
  assert.equal(b.hints.matches('baton'), true);   // BA + 5
  assert.equal(b.hints.matches('bath'), false);   // wrong length
  assert.equal(b.hints.matches('catch'), false);  // wrong prefix
  assert.equal(b.hints.matches(''), false);
  assert.equal(b.hints.matches(null), false);
});

test('matches and currentEntry are false/null before the first hint is shown', () => {
  const b = build();
  assert.equal(b.hints.matches('heel'), false);
  assert.equal(b.hints.currentEntry(), null);
  b.hints.start();
  assert.equal(b.hints.currentEntry(), null); // active but index still 0
  b.timers.advance(450);
  assert.deepEqual(plain(b.hints.currentEntry()), { word: 'heel', hint: 'HE.. 4' });
});

test('armGotIt latches once: true, then false until released; false when inactive', () => {
  const b = build();
  assert.equal(b.hints.armGotIt('heel'), false);
  b.hints.start();
  b.timers.advance(450);
  assert.equal(b.hints.armGotIt('nope'), false);
  assert.equal(b.hints.state.dismissing, false);
  assert.equal(b.hints.armGotIt('heel'), true);
  assert.equal(b.hints.state.dismissing, true);
  assert.equal(b.hints.armGotIt('heel'), false);
  b.hints.releaseGotIt();
  assert.equal(b.hints.state.dismissing, false);
  assert.equal(b.hints.armGotIt('heel'), true);
});

// ─── expand / collapse / toggleClue / fetchClues ────────────────────

test('expand shows the loading state synchronously, then the clue for the current word', async () => {
  const b = build({ clues: [{ word: 'heel', text: 'Back of the foot', user: 'Ann' }] });
  b.hints.start();
  b.timers.advance(450);
  const p = b.hints.expand();
  assert.equal(b.names().at(-1), 'showClueLoading');
  await p;
  const shown = b.calls.find(c => c.name === 'showClue');
  assert.deepEqual(shown.args[0], { word: 'heel', text: 'Back of the foot', user: 'Ann' });
});

test('expand passes undefined to showClue when the word has no clue', async () => {
  const b = build({ clues: [{ word: 'other', text: 'x' }] });
  b.hints.start();
  b.timers.advance(450);
  await b.hints.expand();
  assert.deepEqual(b.calls.find(c => c.name === 'showClue').args, [null]);
});

test('expand does nothing when inactive or before the first hint', async () => {
  const b = build({ clues: [] });
  await b.hints.expand();
  b.hints.start();
  await b.hints.expand();
  assert.ok(!b.names().includes('showClueLoading'));
});

test('a clue that resolves after the hint moved on is never shown', async () => {
  const b = build({ clues: [{ word: 'heel', text: 'x' }], clueLatency: 100 });
  b.hints.start();
  b.timers.advance(450);
  const p = b.hints.expand();
  b.hints.next();
  b.timers.advance(100);
  await p;
  assert.ok(!b.names().includes('showClue'));
});

test('a clue that resolves after stop is never shown', async () => {
  const b = build({ clues: [{ word: 'heel', text: 'x' }], clueLatency: 100 });
  b.hints.start();
  b.timers.advance(450);
  const p = b.hints.expand();
  b.hints.stop();
  b.timers.advance(100);
  await p;
  assert.ok(!b.names().includes('showClue'));
});

test('collapse and toggleClue drive the ui expanded state', async () => {
  const b = build({ clues: [] });
  b.hints.start();
  b.timers.advance(450);
  await b.hints.toggleClue();       // not expanded → expand
  assert.ok(b.names().includes('showClueLoading'));
  b.hints.toggleClue();             // expanded → collapse
  assert.equal(b.names().at(-1), 'collapseClue');
  b.hints.collapse();
  assert.equal(b.names().filter(n => n === 'collapseClue').length, 2);
});

test('toggleClue does nothing while inactive', () => {
  const b = build();
  b.hints.toggleClue();
  assert.deepEqual(b.calls, []);
});

test('fetchClues fetches once, dedupes concurrent calls, and caches by word', async () => {
  const b = build({ clues: [{ word: 'heel', text: 'x' }], clueLatency: 50 });
  const p1 = b.hints.fetchClues();
  const p2 = b.hints.fetchClues();
  b.timers.advance(50);
  const [m1, m2] = await Promise.all([p1, p2]);
  assert.equal(b.env.fetches, 1);
  assert.equal(m1, m2);
  assert.equal(m1.get('heel').text, 'x');
  await b.hints.fetchClues();
  assert.equal(b.env.fetches, 1);
});

test('fetchClues resolves null when the clue feed is unavailable, and retries next time', async () => {
  const b = build({ clues: null });
  assert.equal(await b.hints.fetchClues(), null);
  assert.equal(await b.hints.fetchClues(), null);
  assert.equal(b.env.fetches, 2);
});

test('a new puzzle id drops the clue cache and any in-flight fetch', async () => {
  const b = build({ clues: [{ word: 'heel', text: 'x' }] });
  b.hints.start();
  b.timers.advance(450);
  await b.flush();
  assert.equal(b.env.fetches, 1);
  b.env.puzzleId = 2;
  b.env.clues = [{ word: 'heel', text: 'new' }];
  b.hints.stop();
  b.hints.start();               // rebuild → invalidates
  await b.flush();
  assert.equal(b.env.fetches, 2);
  const m = await b.hints.fetchClues();
  assert.equal(m.get('heel').text, 'new');
});

test('the same puzzle id keeps the clue cache across restarts', async () => {
  const b = build({ clues: [] });
  b.hints.start();
  await b.flush();
  b.hints.stop();
  b.hints.start();
  await b.flush();
  assert.equal(b.env.fetches, 1);
});

// ─── buildHintQueue (pure) ──────────────────────────────────────────

test('buildHintQueue: null answers → null; all found → []; otherwise shaped entries', () => {
  const { internals } = loadScript();
  const q = internals.buildHintQueue;
  assert.equal(q(null, new Set(), () => 0), null);
  assert.deepEqual(plain(q(['a'], new Set(['a']), () => 0)), []);
  assert.deepEqual(plain(q(['Hello'], new Set(), () => 0)), [{ word: 'hello', hint: 'HE.. 5' }]);
});

test('buildHintQueue excludes found words (the found set is lowercase, answers may not be)', () => {
  const { internals } = loadScript();
  const q = internals.buildHintQueue(ANSWERS.map(w => w.toUpperCase()), new Set(['hello', 'other']), () => 0.999);
  assert.deepEqual(plain(q).map(e => e.word), ['heel', 'relate', 'tether', 'theater']);
});

test('buildHintQueue shuffles: a zero RNG walks the Fisher-Yates swaps deterministically', () => {
  const { internals } = loadScript();
  const q = internals.buildHintQueue(ANSWERS, new Set(), () => 0);
  assert.deepEqual(plain(q).map(e => e.word), ['hello', 'other', 'relate', 'tether', 'theater', 'heel']);
});

test('buildHintQueue with a real RNG is a permutation of the unfound answers', () => {
  const { internals, window } = loadScript();
  const q = internals.buildHintQueue(ANSWERS, new Set(), window.Math.random);
  assert.deepEqual(plain(q).map(e => e.word).sort(), [...ANSWERS].sort());
});
