// Live verification for Better Bee's update-news splash (v1.42+).
//
// Default: headless Chrome (reusing the installed Chrome.app, no download)
// against the live NYT Spelling Bee page. Injects the GM_* shims then the
// userscript, runs five scenarios, prints PASS/FAIL per scenario with
// screenshots in /tmp/bee-live, and exits non-zero if any scenario fails.
//
//   a. old install (last-seen 1.40)  -> splash shows, marks seen, "Got it" dismisses
//   b. last-seen == current          -> no splash
//   c. first install (no key)        -> no splash, key seeded
//   d. old install + opt-out         -> no splash, key still advances
//   e. onboarding pending + old key  -> onboarding only, exactly one overlay
//
// --show: opens a VISIBLE Chrome pre-seeded as an old (v1.40) install and
// leaves it open so a human can look at and click the splash. No assertions.
//
// Usage:
//   node scripts/live-check-splash.mjs         # headless, asserts
//   node scripts/live-check-splash.mjs --show  # visible, manual inspection

import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://www.nytimes.com/puzzles/spelling-bee';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = '/tmp/bee-live';
const SHOW = process.argv.includes('--show');

const shims = readFileSync(resolve(ROOT, '.claude/snippets/gm-shims.js'), 'utf8');
const userscript = readFileSync(resolve(ROOT, 'better_bee.user.js'), 'utf8');
// Same header regex as scripts/check-version-bump.mjs: expectations track the
// real @version, so this harness survives future bumps unchanged.
const CURRENT = /^\s*\/\/\s*@version\s+(.+?)\s*$/m.exec(userscript)?.[1];
if (!CURRENT) {
  console.error('could not parse @version from better_bee.user.js');
  process.exit(2);
}
const OLD = '1.40'; // any pre-release-notes version: splash triggers on lastSeen < current
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: SHOW ? false : 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

// Load the SB page, dismiss the Play/Continue moment, seed localStorage.
async function preparePage(ctx, seed) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 740, height: 920, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, .pz-moment__button')];
    const play = btns.find((b) => /^(play|continue|got it)\b/i.test((b.textContent || '').trim()));
    if (play) play.click();
  });
  await sleep(1500);
  await page.waitForSelector('.sb-hive', { timeout: 20000 });
  await page.evaluate((kv) => {
    localStorage.removeItem('GM_bb_last_seen_version');
    localStorage.removeItem('GM_bb_update_news_optout');
    localStorage.removeItem('betterBee_onboardingSeen');
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, seed);
  return page;
}

async function inject(page) {
  // gm-shims reads __bbScriptVersion for GM_info.script.version.
  await page.evaluate((v) => { window.__bbScriptVersion = v; }, CURRENT);
  await page.addScriptTag({ content: shims });
  await page.addScriptTag({ content: userscript });
  await sleep(3000); // hive already present: 200ms poll + 500ms show delay + fade
}

const splashState = (page) => page.evaluate(() => {
  const overlays = [...document.querySelectorAll('.ob-overlay')];
  const ov = overlays[0] || null;
  return {
    overlayCount: overlays.length,
    overlayVisible: !!ov && getComputedStyle(ov).display !== 'none',
    ariaLabel: ov ? ov.getAttribute('aria-label') : null,
    title: ov ? (ov.querySelector('.ob-title')?.textContent || null) : null,
    lastSeen: localStorage.getItem('GM_bb_last_seen_version'),
  };
});

// ── --show: visible browser for a human, no assertions ────────────────
if (SHOW) {
  const page = await preparePage(browser, {
    betterBee_onboardingSeen: '1',
    GM_bb_last_seen_version: JSON.stringify(OLD),
  });
  await inject(page);
  console.log(`Visible Chrome is open, pre-seeded as a v${OLD} install (current: v${CURRENT}).`);
  console.log('Look at / click the splash. Close the browser window to finish.');
  await new Promise((r) => browser.on('disconnected', r));
  process.exit(0);
}

// ── Headless scenario runs ────────────────────────────────────────────
let anyFailed = false;
function report(name, errs) {
  if (errs.length > 0) anyFailed = true;
  console.log(`${errs.length === 0 ? 'PASS' : 'FAIL'}  ${name}`);
  for (const e of errs) console.log(`      - ${e}`);
}

async function scenario(name, seed, shot, assertFn) {
  const ctx = await browser.createBrowserContext();
  const errs = [];
  try {
    const page = await preparePage(ctx, seed);
    await inject(page);
    await page.screenshot({ path: `${OUT_DIR}/${shot}` });
    await assertFn(page, errs);
  } catch (e) {
    errs.push(`threw: ${e.message}`);
  }
  report(name, errs);
  await ctx.close();
}

const seenCurrent = JSON.stringify(CURRENT);

await scenario(
  'a: old install shows splash, marks seen on render, "Got it" dismisses',
  { betterBee_onboardingSeen: '1', GM_bb_last_seen_version: JSON.stringify(OLD) },
  'splash-a-shown.png',
  async (page, errs) => {
    const s = await splashState(page);
    if (s.overlayCount !== 1 || !s.overlayVisible) errs.push(`expected one visible overlay, got ${JSON.stringify(s)}`);
    if (!/Better Bee updated/.test(s.title || '')) errs.push(`title missing "Better Bee updated": ${s.title}`);
    if (s.lastSeen !== seenCurrent) errs.push(`lastSeen not advanced on render: ${s.lastSeen} !== ${seenCurrent}`);
    await page.evaluate(() => document.querySelector('.ob-overlay .ob-cta')?.click());
    await sleep(500);
    const after = await splashState(page);
    if (after.overlayCount !== 0) errs.push(`"Got it" did not dismiss overlay (count=${after.overlayCount})`);
  },
);

await scenario(
  'b: last-seen == current shows no splash',
  { betterBee_onboardingSeen: '1', GM_bb_last_seen_version: seenCurrent },
  'splash-b-current.png',
  async (page, errs) => {
    const s = await splashState(page);
    if (s.overlayCount !== 0) errs.push(`unexpected overlay: ${JSON.stringify(s)}`);
    if (s.lastSeen !== seenCurrent) errs.push(`lastSeen changed: ${s.lastSeen}`);
  },
);

await scenario(
  'c: first install (no key) shows no splash and seeds the key',
  { betterBee_onboardingSeen: '1' },
  'splash-c-first-install.png',
  async (page, errs) => {
    const s = await splashState(page);
    if (s.overlayCount !== 0) errs.push(`unexpected overlay: ${JSON.stringify(s)}`);
    if (s.lastSeen !== seenCurrent) errs.push(`key not seeded: ${s.lastSeen} !== ${seenCurrent}`);
  },
);

await scenario(
  'd: opt-out suppresses splash but last-seen still advances',
  {
    betterBee_onboardingSeen: '1',
    GM_bb_last_seen_version: JSON.stringify(OLD),
    GM_bb_update_news_optout: 'true',
  },
  'splash-d-optout.png',
  async (page, errs) => {
    const s = await splashState(page);
    if (s.overlayCount !== 0) errs.push(`unexpected overlay: ${JSON.stringify(s)}`);
    if (s.lastSeen !== seenCurrent) errs.push(`lastSeen not advanced: ${s.lastSeen} !== ${seenCurrent}`);
  },
);

await scenario(
  'e: onboarding pending shows onboarding only, exactly one overlay',
  { GM_bb_last_seen_version: JSON.stringify(OLD) },
  'splash-e-onboarding.png',
  async (page, errs) => {
    const s = await splashState(page);
    if (s.overlayCount !== 1) errs.push(`expected exactly one overlay, got ${s.overlayCount}`);
    if (s.ariaLabel !== 'Welcome to Better Bee') errs.push(`overlay is not onboarding: ${s.ariaLabel}`);
    if (s.lastSeen !== seenCurrent) errs.push(`lastSeen not advanced under onboarding: ${s.lastSeen}`);
  },
);

await browser.close();
console.log(`\nScreenshots: ${OUT_DIR}`);
process.exit(anyFailed ? 1 : 0);
