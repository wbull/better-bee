// Loads the REAL better_bee.user.js into a jsdom window and hands back the
// internals it exposes through `unsafeWindow.__bbInternals`.
//
// The script is evaluated with vm.Script + a real filename (not window.eval) so
// that `node --test --experimental-test-coverage` attributes its lines to
// better_bee.user.js. Each call builds a fresh jsdom, so tests never share state.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { JSDOM } from 'jsdom';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// BB_USERSCRIPT lets you point the suite at a mutated copy to prove a test bites.
export const USERSCRIPT = process.env.BB_USERSCRIPT || join(ROOT, 'better_bee.user.js');
export const SHIMS = join(ROOT, '.claude', 'snippets', 'gm-shims.js');
export const BEE_URL = 'https://www.nytimes.com/puzzles/spelling-bee';

export const FIXTURE_GAME = Object.freeze({
  today: {
    id: 20260901,
    centerLetter: 'e',
    outerLetters: ['a', 'h', 'l', 'o', 'r', 't'],
    answers: ['heel', 'hello', 'other', 'relate', 'tether', 'theater'],
  },
});

export function versionFromHeader(text = readFileSync(USERSCRIPT, 'utf8')) {
  const m = /^\/\/\s*@version\s+(\S+)/m.exec(text);
  if (!m) throw new Error('no @version header in better_bee.user.js');
  return m[1];
}

// Markup matching WORD_LIST_SELECTORS in the script.
export function wordListHtml(words = []) {
  return `<ul class="sb-wordlist-items-pag">${words.map(w => `<li>${w}</li>`).join('')}</ul>`;
}

// Values produced inside the jsdom realm have that realm's prototypes, which strict
// deepEqual rejects. Round-trip through JSON before comparing structure.
export const plain = x => JSON.parse(JSON.stringify(x));

// Every window opened by loadScript is closed at the end of the test file so the
// process exits as soon as the tests do (jsdom timers would otherwise keep it alive).
// Observers are disconnected first: window.close() tears the document down and would
// otherwise deliver mutation records to the script's observers with `document` gone.
const openWindows = new Map(); // window → Set<MutationObserver>
export function closeAll() {
  for (const [w, observers] of openWindows) {
    for (const o of observers) o.disconnect();
    w.close();
  }
  openWindows.clear();
}
after(closeAll);

function trackObservers(w) {
  const observers = new Set();
  const Real = w.MutationObserver;
  w.MutationObserver = class extends Real {
    constructor(cb) { super(cb); observers.add(this); }
  };
  return observers;
}

const runFile = (ctx, file) =>
  new vm.Script(readFileSync(file, 'utf8'), { filename: file }).runInContext(ctx);

/**
 * @param {object} [opts]
 * @param {string} [opts.url]        page URL (default: the Spelling Bee page)
 * @param {string} [opts.html]       body markup present before the script runs
 * @param {object} [opts.gameData]   value of window.gameData (default FIXTURE_GAME)
 * @param {object} [opts.gmValues]   GM_getValue seed: { key: value }
 * @param {Function} [opts.fetchImpl]  replacement for window.fetch
 * @param {Function} [opts.gmXhrImpl]  replacement for GM_xmlhttpRequest (after shims)
 * @param {object} [opts.timers]     a makeFakeTimers() instance to install on the window
 * @param {string} [opts.version]    GM_info.script.version (default: parsed from the header)
 */
export function loadScript({
  url = BEE_URL,
  html = '<body></body>',
  gameData = FIXTURE_GAME,
  gmValues = {},
  fetchImpl,
  gmXhrImpl,
  timers,
  version,
} = {}) {
  // No pretendToBeVisual: it starts a perpetual rAF loop that never lets the
  // process exit. The script's only rAF use is a class toggle, so a timer stub is enough.
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  openWindows.set(w, trackObservers(w));
  w.requestAnimationFrame = fn => w.setTimeout(() => fn(Date.now()), 16);
  w.cancelAnimationFrame = id => w.clearTimeout(id);
  w.gameData = gameData;
  for (const [k, v] of Object.entries(gmValues)) {
    w.localStorage.setItem('GM_' + k, JSON.stringify(v));
  }
  w.__bbScriptVersion = version ?? versionFromHeader();
  if (fetchImpl) w.fetch = fetchImpl;
  if (timers) timers.install(w);

  const ctx = dom.getInternalVMContext();
  runFile(ctx, SHIMS);
  if (gmXhrImpl) w.GM_xmlhttpRequest = gmXhrImpl;

  let internals;
  w.__bbInternals = i => { internals = i; };
  runFile(ctx, USERSCRIPT);

  return { dom, window: w, document: w.document, internals };
}
