// Live check for the definition tooltip: loads real NYT Spelling Bee, injects
// the userscript, submits a real answer word, clicks it in the word list, and
// asserts the tooltip resolves to a definition (or an honest error) — never a
// stuck "Loading…".
//
// Modes (3rd arg):
//   hang         — GM_xmlhttpRequest callbacks silently dropped (TM MV3 regression);
//                  the page-fetch fallback must still deliver the definition.
//   ratelimit    — GM leg answers HTTP 429; the retry message must render and NO
//                  page fetch to either chain host may fire (no load doubling).
//   fallbackchain — Datamuse answers HTTP 503; the script must fall through to
//                  Wiktionary and still resolve a definition.
//
// Usage:
//   node scripts/live-check-definition.mjs [userscript-path] [width] [hang|ratelimit|fallbackchain]

import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://www.nytimes.com/puzzles/spelling-bee';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2).filter(Boolean);
const hangGm = args.includes('hang');
const rateLimit = args.includes('ratelimit');
const fallbackChain = args.includes('fallbackchain');
if ([hangGm, rateLimit, fallbackChain].filter(Boolean).length > 1) {
  console.error('modes are mutually exclusive: pass at most one of hang|ratelimit|fallbackchain');
  process.exit(2);
}
const rest = args.filter((a) => a !== 'hang' && a !== 'ratelimit' && a !== 'fallbackchain');
const userscript = readFileSync(resolve(rest.find((a) => !/^\d+$/.test(a)) || `${ROOT}/better_bee.user.js`), 'utf8');
const width = Number(rest.find((a) => /^\d+$/.test(a)) || 1100);
const shims = readFileSync(resolve(ROOT, '.claude/snippets/gm-shims.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  const dictRequests = [];
  page.on('request', (req) => {
    if (/api\.datamuse\.com|en\.wiktionary\.org/.test(req.url())) dictRequests.push(req.url());
  });

  await page.setViewport({ width, height: 920 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, .pz-moment__button')];
    const play = btns.find((b) => /^(play|continue|got it)\b/i.test((b.textContent || '').trim()));
    if (play) play.click();
  });
  await sleep(1500);
  await page.waitForSelector('.sb-hive', { timeout: 20000 });

  // NYT sometimes opens a "Spelling Bee badges" tip popover (immediately, or a
  // beat later) that steals keyboard focus, silently swallowing the typed
  // answer. dismissBadgesPopover() is re-run right before typing too.
  const dismissBadgesPopover = () => page.evaluate(() => {
    document.querySelector('[class*="Popover-module_popover__x"]')?.click();
  });
  await dismissBadgesPopover();
  await sleep(300);

  await page.addScriptTag({ content: shims });
  if (hangGm) {
    // Request silently vanishes: no onload, no onerror — like broken TM MV3.
    await page.addScriptTag({ content: 'window.GM_xmlhttpRequest = () => {};' });
  }
  if (rateLimit) {
    // GM leg gets a definitive server answer; gmFetch must NOT re-issue it.
    await page.addScriptTag({ content: 'window.GM_xmlhttpRequest = (o) => o.onload({ status: 429, responseText: "" });' });
  }
  if (fallbackChain) {
    // Datamuse answers 503 so the script must fall through to Wiktionary.
    await page.addScriptTag({ content: `
      const realGm = window.GM_xmlhttpRequest;
      window.GM_xmlhttpRequest = (o) => o.url.includes('api.datamuse.com')
        ? o.onload({ status: 503, responseText: '' })
        : realGm(o);
    ` });
  }
  await page.addScriptTag({ content: userscript });
  await sleep(1000);

  // Submit a non-pangram answer so a decorated word exists in the list.
  // Submitting the pangram triggers NYT's full-screen "Pangram!" congrats
  // overlay, which blanks the puzzle DOM for several seconds and races the
  // click/tooltip assertions below.
  const { word, answersCount } = await page.evaluate(() => {
    const { answers, pangrams } = window.gameData?.today || {};
    return {
      word: (answers || []).find((a) => !(pangrams || []).includes(a)) || '',
      answersCount: (answers || []).length,
    };
  });
  if (!word) {
    throw new Error(answersCount > 0
      ? 'no non-pangram answer available in gameData.today'
      : 'gameData.today.answers unavailable');
  }
  await dismissBadgesPopover();
  await page.click('.sb-hive-input-content'); // the word-display box, not a hive letter cell — guarantees keyboard focus
  await sleep(200);
  await page.keyboard.type(word, { delay: 60 });
  // A stray popover/overlay can still eat keystrokes; verify the word landed
  // before submitting, and retry once rather than pressing Enter on nothing.
  let typed = await page.evaluate(() => document.querySelector('.sb-hive-input-content')?.textContent || '');
  if (!typed.toLowerCase().includes(word.toLowerCase())) {
    await dismissBadgesPopover();
    await page.click('.sb-hive-input-content');
    await sleep(200);
    await page.keyboard.type(word, { delay: 60 });
    typed = await page.evaluate(() => document.querySelector('.sb-hive-input-content')?.textContent || '');
  }
  if (!typed.toLowerCase().includes(word.toLowerCase())) {
    throw new Error(`Typed word did not register in hive input (got "${typed}")`);
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('.we-word', { timeout: 10000 });
  await sleep(2500); // let the submit animation / emoji feedback clear the word

  // Dispatch the click on the element directly: NYT overlays (word-list popover,
  // upsell tips) can cover the li and steal a hit-tested mouse click, and this
  // check is about the fetch path, not NYT's z-order.
  await page.$eval('.we-word', (el) => el.click());
  await sleep(hangGm ? 6000 : 3000); // hang path: GM watchdog (2.5s) + fetch fallback

  const state = await page.evaluate(() => {
    const body = document.querySelector('.we-tooltip-body');
    const li = document.querySelector('.we-word');
    const r = li?.getBoundingClientRect();
    const atPoint = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      visible: !!document.querySelector('.we-tooltip')?.className.includes('we-visible'),
      stuckLoading: !!body?.querySelector('.we-tooltip-loading'),
      hasDef: !!body?.querySelector('.we-tooltip-def'),
      nodefText: body?.querySelector('.we-tooltip-nodef')?.textContent || '',
      weWordCount: document.querySelectorAll('.we-word').length,
      clickTargetOk: !!(atPoint && (atPoint === li || li?.contains(atPoint) || atPoint.closest('.we-word'))),
      liRect: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
      covering: atPoint ? `${atPoint.tagName}.${atPoint.className}` : 'none',
    };
  });
  await page.screenshot({ path: '/tmp/bee-live/def-check.png' });

  let pass;
  if (rateLimit) {
    pass = state.visible && !state.stuckLoading &&
      state.nodefText.includes('rate limit') && state.nodefText.includes('retry') &&
      dictRequests.length === 0; // no page-fetch doubling on a real 429
  } else if (fallbackChain) {
    pass = state.visible && !state.stuckLoading && state.hasDef &&
      dictRequests.some((u) => u.includes('en.wiktionary.org'));
  } else {
    pass = state.visible && !state.stuckLoading && state.hasDef;
  }

  console.log(JSON.stringify({
    verdict: pass ? 'PASS' : 'FAIL', width, hangGm, rateLimit, fallbackChain, word, ...state,
    pageDictRequests: dictRequests.length,
  }, null, 2));
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
}
