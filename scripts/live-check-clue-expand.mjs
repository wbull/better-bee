// Live check for the "." clue-expand path: loads real NYT Spelling Bee,
// injects the userscript, presses "?" then ".", and asserts the clue panel
// expands with real clue text.
//
// Pass "hang" as the 3rd arg to simulate Tampermonkey MV3 on Chrome dropping
// GM_xmlhttpRequest callbacks entirely (the v1.41 regression scenario) — the
// script must still show clues via its page-fetch fallback.
//
// Usage:
//   node scripts/live-check-clue-expand.mjs [userscript-path] [width] [hang]

import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://www.nytimes.com/puzzles/spelling-bee';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2).filter(Boolean);
const hangGm = args.includes('hang');
const rest = args.filter((a) => a !== 'hang');
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
  const clueRequests = [];
  page.on('response', (res) => {
    if (res.url().includes('spelling-bee-buddy')) clueRequests.push({ url: res.url(), status: res.status() });
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
  await page.addScriptTag({ content: userscript });
  await sleep(1500);

  await page.keyboard.press('?');
  await sleep(1500); // startHints delays first hint by 450ms
  await page.keyboard.press('.');
  await sleep(hangGm ? 5000 : 2000); // hang path: GM watchdog (2.5s) + fetch fallback

  const state = await page.evaluate(() => {
    const toast = document.querySelector('.we-hint-toast');
    const clue = toast?.querySelector('.we-hint-toast-clue');
    const cs = clue ? getComputedStyle(clue) : null;
    const r = clue?.getBoundingClientRect();
    return {
      toastClasses: toast?.className,
      clueText: clue?.textContent,
      clueOpacity: cs?.opacity,
      clueHeight: r ? Math.round(r.height) : null,
    };
  });

  const pass = !!(
    state.toastClasses?.includes('we-expanded') &&
    state.clueText && state.clueText !== '…' &&
    !state.clueText.includes('no clue available') &&
    state.clueOpacity === '1' && (state.clueHeight ?? 0) > 10
  );

  console.log(JSON.stringify({ verdict: pass ? 'PASS' : 'FAIL', width, hangGm, ...state, clueRequests }, null, 2));
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
}
