// Live verification harness for Better Bee.
//
// Drives a REAL headless Chrome (reusing the installed Chrome.app, no download)
// against the live NYT Spelling Bee page, injects the GM_* shims and a given
// userscript build, forces a viewport width that triggers NYT's drawer layout,
// then screenshots the board and measures the vertical position of the
// "Type or click" prompt. A smaller prompt-top after the change means the
// whitespace band above it shrank.
//
// This deliberately does NOT use Claude-in-Chrome — that agent is blocked from
// nytimes.com by a safety shield. Puppeteer is a plain local test harness and
// is not subject to that restriction.
//
// Usage:
//   node scripts/live-check.mjs <userscript-path> <label> [width]
// Example (before/after for PR #3):
//   git show main:better_bee.user.js > /tmp/bb_v139.js
//   node scripts/live-check.mjs /tmp/bb_v139.js before 760
//   node scripts/live-check.mjs ./better_bee.user.js after 760

import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://www.nytimes.com/puzzles/spelling-bee';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = '/tmp/bee-live';

const userscriptPath = process.argv[2];
const label = process.argv[3] || 'run';
const width = Number(process.argv[4] || 760);

if (!userscriptPath) {
  console.error('usage: node scripts/live-check.mjs <userscript-path> <label> [width]');
  process.exit(2);
}

const shims = readFileSync(resolve(ROOT, '.claude/snippets/gm-shims.js'), 'utf8');
const userscript = readFileSync(resolve(userscriptPath), 'utf8');
mkdirSync(OUT_DIR, { recursive: true });
const shot = `${OUT_DIR}/live-${label}.png`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 920, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });

  // Dismiss the intro / "Play" moment if present so the board renders.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, .pz-moment__button')];
    const play = btns.find((b) => /^(play|continue|got it)\b/i.test((b.textContent || '').trim()));
    if (play) play.click();
  });
  await sleep(1500);

  // Board must exist, and gameData must be readable (the userscript needs it).
  await page.waitForSelector('.sb-hive', { timeout: 20000 });
  const hasGameData = await page.evaluate(() => !!(window.gameData && window.gameData.today));

  // Inject shims FIRST, then the userscript IIFE.
  await page.addScriptTag({ content: shims });
  await page.addScriptTag({ content: userscript });
  await sleep(2000); // let the userscript render its ribbon / styles

  const metrics = await page.evaluate(() => {
    const drawerEl = document.querySelector('.sb-wordlist-drawer');
    const drawerOpen = !!document.querySelector('.sb-wordlist-drawer[aria-hidden="false"]');
    // The "Type or click" prompt: find the element whose own text is exactly that.
    let promptTop = null, promptText = null;
    const all = [...document.querySelectorAll('div, span, p')];
    const prompt = all.find((el) => /type or click/i.test(el.textContent || '') &&
      el.children.length === 0);
    if (prompt) {
      promptTop = Math.round(prompt.getBoundingClientRect().top);
      promptText = prompt.textContent.trim();
    }
    const layout = document.querySelector('.sb-layout-box');
    const layoutH = layout ? Math.round(layout.getBoundingClientRect().height) : null;
    return {
      drawerPresent: !!drawerEl,
      drawerOpen,
      promptTop,
      promptText,
      layoutHeight: layoutH,
    };
  });

  await page.screenshot({ path: shot, fullPage: false });

  console.log(JSON.stringify({
    label, width, hasGameData, screenshot: shot, ...metrics,
  }, null, 2));
} finally {
  await browser.close();
}
