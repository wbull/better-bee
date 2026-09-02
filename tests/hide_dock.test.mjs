// Module 1 (hideDock) through the real script on a NON-Bee nytimes.com URL:
// the dock is removed on arrival, the observer disconnects after the first
// removal, and nothing from the Bee-only modules is created.
//
// A dock already present when the script runs must be removed synchronously and
// must not disturb the rest of the IIFE (v1.50 fixed a TDZ ReferenceError here:
// hideDock() used to run before `const dockObserver` was initialised).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, BEE_URL } from './harness.mjs';

const CROSSWORDS = 'https://www.nytimes.com/crosswords';
const DOCK_SEL = '#dock-container[data-testid="onsite-messaging-unit-dock"]';

function dockHtml(testid = 'onsite-messaging-unit-dock') {
  return `<div id="dock-container" data-testid="${testid}"><p>Subscribe now</p></div>`;
}

function page({ html = '<body></body>', url = CROSSWORDS } = {}) {
  const ctx = loadScript({ url, html });
  const addDock = (testid) => {
    const wrap = ctx.document.createElement('div');
    wrap.innerHTML = dockHtml(testid);
    const dock = wrap.firstElementChild;
    ctx.document.body.appendChild(dock);
    return dock;
  };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  return { ...ctx, addDock, flush };
}

test('a dock injected after load is removed by the MutationObserver', async () => {
  const p = page();
  const dock = p.addDock();
  assert.ok(dock.isConnected, 'removal is async (observer delivery), not synchronous');
  await p.flush();
  assert.equal(dock.isConnected, false);
  assert.equal(dock.style.display, 'none');
  assert.equal(p.document.querySelector(DOCK_SEL), null);
});

test('after the first removal the observer is disconnected: a second dock survives', async () => {
  const p = page();
  const first = p.addDock();
  await p.flush();
  assert.equal(first.isConnected, false);
  const second = p.addDock();
  await p.flush();
  assert.equal(second.isConnected, true, 'observer no longer watching');
  assert.equal(p.document.querySelector(DOCK_SEL), second);
});

test('a #dock-container with a different data-testid is untouched', async () => {
  const p = page({ html: `<body>${dockHtml('some-other-unit')}</body>` });
  const dock = p.document.getElementById('dock-container');
  assert.ok(dock, 'still present after load');
  assert.equal(dock.style.display, '');
  // Observer is live (nothing matched yet) and still ignores it after churn.
  dock.appendChild(p.document.createElement('span'));
  await p.flush();
  assert.equal(dock.isConnected, true);
  // …and still catches a real dock arriving afterwards. (Removed first: jsdom's
  // selector engine short-circuits `#id[attr]` on the first element with that id.)
  dock.remove();
  const real = p.addDock();
  await p.flush();
  assert.equal(real.isConnected, false);
});

test('on a non-Bee URL nothing from the later modules exists', () => {
  const p = page();
  assert.equal(p.internals, undefined, 'seam is only reached on the Bee page');
  assert.equal(p.document.getElementById('bee-buddy'), null);
  assert.equal(p.document.querySelector('.we-hint-toast, .ob-overlay, .bb-splash, #we-tooltip'), null);
  assert.equal(p.document.body.children.length, 0);
  assert.ok(p.document.head.querySelector('style'), 'module 1 still installs the shared CSS');
});

test('a dock present at load is removed synchronously', () => {
  const p = page({ html: `<body>${dockHtml()}<main id="content">puzzle</main></body>` });
  assert.equal(p.document.querySelector(DOCK_SEL), null);
  assert.ok(p.document.getElementById('content'), 'sibling content untouched');
});

test('a dock present at load on the Bee page must not abort the rest of the script', () => {
  const p = page({ url: BEE_URL, html: `<body>${dockHtml()}</body>` });
  assert.equal(p.document.querySelector(DOCK_SEL), null);
  assert.ok(p.document.getElementById('bee-buddy'), 'Module 2 ran');
  assert.ok(p.internals, 'seam reached');
});
