// Live check for the definition tooltip: loads real NYT Spelling Bee, injects
// the userscript, submits a real answer word, clicks it in the word list, and
// asserts the tooltip resolves to a definition (or an honest error) — never a
// stuck "Loading…".
//
// Modes (3rd arg):
//   hang       — GM_xmlhttpRequest callbacks silently dropped (TM MV3 regression);
//                the page-fetch fallback must still deliver the definition.
//   ratelimit  — GM leg answers HTTP 429; the retry message must render and NO
//                page fetch to api.dictionaryapi.dev may fire (no load doubling).
//
// Usage:
//   node scripts/live-check-definition.mjs [userscript-path] [width] [hang|ratelimit]

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
const rest = args.filter((a) => a !== 'hang' && a !== 'ratelimit');
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
    if (req.url().includes('api.dictionaryapi.dev')) dictRequests.push(req.url());
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

  await page.addScriptTag({ content: shims });
  if (hangGm) {
    // Request silently vanishes: no onload, no onerror — like broken TM MV3.
    await page.addScriptTag({ content: 'window.GM_xmlhttpRequest = () => {};' });
  }
  if (rateLimit) {
    // GM leg gets a definitive server answer; gmFetch must NOT re-issue it.
    await page.addScriptTag({ content: 'window.GM_xmlhttpRequest = (o) => o.onload({ status: 429, responseText: "" });' });
  }
  await page.addScriptTag({ content: userscript });
  await sleep(1000);

  // Submit the first answer so a decorated word exists in the list.
  const word = await page.evaluate(() => window.gameData?.today?.answers?.[0] || '');
  if (!word) throw new Error('gameData.today.answers unavailable');
  await page.keyboard.type(word, { delay: 60 });
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
  } else {
    pass = state.visible && !state.stuckLoading &&
      (state.hasDef || state.nodefText.length > 0);
  }

  console.log(JSON.stringify({
    verdict: pass ? 'PASS' : 'FAIL', width, hangGm, rateLimit, word, ...state,
    pageDictRequests: dictRequests.length,
  }, null, 2));
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
}
