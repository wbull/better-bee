// Interactive live-dev harness for Better Bee.
//
// Opens a REAL, visible Chrome window on the live NYT Spelling Bee page with
// the current better_bee.user.js injected, then watches the file and
// re-injects on every save — so you can click, type, and play the actual page
// with your in-progress changes, refreshing automatically as you edit.
//
// This is for hands-on iteration; scripts/live-check.mjs is the headless,
// scriptable cousin used by bee-verifier for before/after measurement.
//
// Unlike Claude-in-Chrome (blocked from nytimes.com by a safety shield), this
// is a plain Puppeteer-launched Chrome instance using a throwaway dev profile
// under /tmp — isolated from your everyday Chrome and your NYT account.
//
// Usage:
//   npm run live            # default ~800px wide (drawer/zoomed layout)
//   npm run live -- 1200    # desktop width
// Ctrl+C to quit. Resize the window freely to test layouts.

import puppeteer from 'puppeteer-core';
import { readFileSync, watch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://www.nytimes.com/puzzles/spelling-bee';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USERSCRIPT = resolve(ROOT, 'better_bee.user.js');
const SHIMS = resolve(ROOT, '.claude/snippets/gm-shims.js');
const width = Number(process.argv[2] || 820);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[live-dev] ${m}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: null, // use the real window size, so resizing works
  userDataDir: '/tmp/bee-live-profile', // throwaway, persists onboarding/login between runs
  args: [`--window-size=${width},1000`, '--no-first-run', '--no-default-browser-check'],
});

const [page] = await browser.pages();

async function loadAndInject(reason) {
  log(`${reason} — loading ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  // Dismiss NYT's intro/subscription "moment" if present.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, .pz-moment__button')]
      .find((el) => /^(play|continue|no thanks|maybe later)\b/i.test((el.textContent || '').trim()));
    if (b) b.click();
  }).catch(() => {});
  await page.waitForSelector('.sb-hive', { timeout: 30000 });
  await page.addScriptTag({ content: readFileSync(SHIMS, 'utf8') });
  await page.addScriptTag({ content: readFileSync(USERSCRIPT, 'utf8') });
  log('injected gm-shims + better_bee.user.js — interact away.');
}

await loadAndInject('start');

// Re-inject on save, debounced (editors fire multiple events per write).
let timer = null;
watch(USERSCRIPT, () => {
  clearTimeout(timer);
  timer = setTimeout(() => loadAndInject('change detected').catch((e) => log(`reload error: ${e.message}`)), 250);
});
log('watching better_bee.user.js for changes. Ctrl+C to quit.');

// Quit cleanly, and quit if the user closes the window.
const quit = async () => { try { await browser.close(); } catch {} process.exit(0); };
process.on('SIGINT', quit);
browser.on('disconnected', () => process.exit(0));
