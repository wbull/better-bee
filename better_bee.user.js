// ==UserScript==
// @name         Better Bee
// @namespace    https://wilsonbull.local/spelling-bee
// @version      1.44
// @description  NYT Spelling Bee enhancements: dock hiding, emoji feedback, hint system, Word Explorer
// @match        https://www.nytimes.com/puzzles/spelling-bee*
// @match        https://www.nytimes.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/wbull/better-bee/main/better_bee.user.js
// @downloadURL  https://raw.githubusercontent.com/wbull/better-bee/main/better_bee.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.dictionaryapi.dev
// @connect      dictionaryapi.com
// @connect      media.merriam-webster.com
// @connect      static01.nyt.com
// ==/UserScript==

(function () {
  'use strict';


  // ─── Shared: Constants & State ──────────────────────────────────────
  // Twemoji SVGs (CC-BY 4.0, twitter/twemoji v14.0.2) embedded as data URIs
  const EMOJIS = {
    success: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzc3QjI1NSIgZD0iTTM2IDMyYzAgMi4yMDktMS43OTEgNC00IDRINGMtMi4yMDkgMC00LTEuNzkxLTQtNFY0YzAtMi4yMDkgMS43OTEtNCA0LTRoMjhjMi4yMDkgMCA0IDEuNzkxIDQgNHYyOHoiLz48cGF0aCBmaWxsPSIjRkZGIiBkPSJNMjkuMjggNi4zNjJjLTEuMTU2LS43NTEtMi43MDQtLjQyMi0zLjQ1OC43MzZMMTQuOTM2IDIzLjg3N2wtNS4wMjktNC42NWMtMS4wMTQtLjkzOC0yLjU5Ni0uODc1LTMuNTMzLjEzOC0uOTM3IDEuMDE0LS44NzUgMi41OTYuMTM5IDMuNTMzbDcuMjA5IDYuNjY2Yy40OC40NDUgMS4wOS42NjUgMS42OTYuNjY1LjY3MyAwIDEuNTM0LS4yODIgMi4wOTktMS4xMzkuMzMyLS41MDYgMTIuNS0xOS4yNyAxMi41LTE5LjI3Ljc1MS0xLjE1OS40MjEtMi43MDctLjczNy0zLjQ1OHoiLz48L3N2Zz4=',
    duplicate: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iI0VGOTY0NSIgZD0iTTI2Ljk5MiAxOS4wMTZjLS4yNTUtLjI1NS0uNzk5LS42MTEtMS40NC0uOTYybC0xLjkxMS0yLTIuMTEzIDJoLS41OGwtMi41MDktMy42MzRjLTEuMzc5LjAxLTIuNDk3IDEuMTM2LTIuNDg3IDIuNTE1bC0zLjU1Ni0yLjExMmMtLjgxNy4zNjQtMS4zODkgMS4xOC0xLjM4OSAyLjEzM3YuOTZsLTQgNC4xNjguMDE2IDIuMTg1IDkuOTg0IDEwLjcyOVMyNy41MjUgMTkuNzEgMjcuNTUgMTkuNzRjLS4xMjktLjIyMy0uNTEzLS43MDItLjU1OC0uNzI0eiIvPjxnIGZpbGw9IiNGRkRDNUQiPjxwYXRoIGQ9Ik0yNS41NTIgNS44MWMwLTEuMTA3LS45MDYtMi4wMTMtMi4wMTMtMi4wMTMtMS4xMDcgMC0yLjAxMy45MDYtMi4wMTMgMi4wMTN2MTIuMjQ1aDQuMDI1VjUuODF6bS00LjYwNSAxMi4yNDRWMTYuMDFjLS4wMDgtMS4xMDMtLjkwOS0xLjk5MS0yLjAxMi0xLjk4My0xLjEwMy4wMDgtMS45OTEuOTA5LTEuOTgzIDIuMDEybC4wMTIgMi4wMTZoMy45ODN6TTguOTE2IDE2aC4xNjhjMS4wNTkgMCAxLjkxNi44NTggMS45MTYgMS45MTd2NC4xNjZDMTEgMjMuMTQyIDEwLjE0MyAyNCA5LjA4NCAyNGgtLjE2OEM3Ljg1NyAyNCA3IDIzLjE0MiA3IDIyLjA4M3YtNC4xNjZDNyAxNi44NTggNy44NTcgMTYgOC45MTYgMTZ6bTYuOTE4IDIuOTZsLS4wNTYuMDYyQzE1LjMwNCAxOS41NTEgMTUgMjAuMjMzIDE1IDIxYzAgLjA2My4wMTMuMTIzLjAxOC4xODUuMDQ0LjY3OC4zMDggMS4yOTIuNzI4IDEuNzc0LS4wNzEuMTI5LS4xNjMuMjQzLS4yNTkuMzUzLS4zNjYuNDE3LS44OS42ODgtMS40ODcuNjg4LTEuMTA0IDAtMi0uODk2LTItMnYtNmMwLS40NDEuMTQ3LS44NDUuMzg5LTEuMTc2LjM2NC0uNDk3Ljk0Ny0uODI0IDEuNjExLS44MjQgMS4xMDQgMCAyIC44OTYgMiAydjIuNzc4Yy0uMDYxLjA1NS0uMTA5LjEyMy0uMTY2LjE4MnoiLz48cGF0aCBkPSJNOS4wNjIgMjVjMS4wMjQgMCAxLjkyNS0uNTI2IDIuNDUtMS4zMjIuMTIzLjE4My4yNzEuMzQ2LjQzMS40OTcgMS4xODUgMS4xMTUgMy4wMzQgMS4wNDQgNC4xNjctLjA4Ni4xNTItLjE1Mi4zMDMtLjMwNS40MTktLjQ4OGwtLjAwMy0uMDAzQzE2LjcyNyAyMy43MTMgMTcgMjQgMTggMjRoMi41MzdjLS4zNy4yNzktLjcwOC42MjMtMS4wMjQgMS0xLjIyOCAxLjQ2Ny0yLjAxMyAzLjYwNi0yLjAxMyA2IDAgLjI3Ni4yMjQuNS41LjVzLjUtLjIyNC41LS41YzAtMi41NDguOTU2LTQuNzc1IDIuMzc3LTYgLjczMi0uNjMxIDEuNTg0LTEgMi40OTgtMSAuNzEzLjA3OS44NDctMSAuMTI1LTFIMThjLTEuMTA0IDAtMi0uODk2LTItMnMuODk2LTIgMi0yaDhjLjg1OCAwIDEuNjYuNTk2IDEuOTEzIDEuNDE1TDI5IDI0Yy4xMDMuMzM1LjQ3OSAxLjg3MS40MTEgMi4xOTFDMjkuNDExIDMxIDI0LjcxNSAzNiAxOSAzNmMtNi41MzcgMC0xMS44NDQtNS4yMzEtMTEuOTg2LTExLjczNGwuMDE0LjAxYy41MTUuNDQ1IDEuMTc2LjcyNCAxLjkxLjcyNGguMTI0eiIvPjwvZz48L3N2Zz4=',
    error: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iI0JFMTkzMSIgZD0iTTM2IDE4YzAgOS45NDEtOC4wNTkgMTgtMTggMThTMCAyNy45NDEgMCAxOCA4LjA1OSAwIDE4IDBzMTggOC4wNTkgMTggMTh6Ii8+PHBhdGggZmlsbD0iI0ZGRiIgZD0iTTMyIDIwYzAgMS4xMDQtLjg5NiAyLTIgMkg2Yy0xLjEwNCAwLTItLjg5Ni0yLTJ2LTRjMC0xLjEwNC44OTYtMiAyLTJoMjRjMS4xMDQgMCAyIC44OTYgMiAydjR6Ii8+PC9zdmc+',
  };
  const MIN_WORD_LENGTH = 4; // Spelling Bee words are 4+ letters
  const WORD_LIST_SELECTORS = [
    '.sb-wordlist-items-pag li',
    '.sb-wordlist-window li',
    '.sb-recent-words li',
  ];
  const apiCache = new Map();
  let requestCounter = 0;

  // ─── Merriam-Webster API Key (optional) ─────────────────────────────
  let mwApiKey = GM_getValue('mw_api_key', '');
  GM_registerMenuCommand('Set Dictionary API Key', () => {
    const key = prompt('Enter your Merriam-Webster Collegiate API key:\n(Get one free at dictionaryapi.com)', mwApiKey);
    if (key !== null) {
      mwApiKey = key.trim();
      GM_setValue('mw_api_key', mwApiKey);
      apiCache.clear();
      defInflight.clear();
      prefetchFailures = 0; // host changed — give prefetch a fresh start
    }
  });
  GM_registerMenuCommand('Clear Dictionary API Key', () => {
    mwApiKey = '';
    GM_setValue('mw_api_key', '');
    apiCache.clear();
    defInflight.clear();
    prefetchFailures = 0;
  });
  // Label reflects state at registration; refreshes on next page load (same
  // low-tech fidelity as the API-key commands above).
  GM_registerMenuCommand(
    `Update news: ${GM_getValue('bb_update_news_optout', false) ? 'Off — click to enable' : 'On — click to disable'}`,
    () => { GM_setValue('bb_update_news_optout', !GM_getValue('bb_update_news_optout', false)); }
  );
  GM_registerMenuCommand('Preview update news', () => {
    if (onboardingActive) return; // never stack on an open overlay
    // Pure preview: render every noted version; never writes last-seen or opt-out.
    showUpdateSplash(collectUnseenNotes('0', '9999', RELEASE_NOTES));
  });

  // ─── Shared: CSS ────────────────────────────────────────────────────
  GM_addStyle(`
    /* Word Explorer: clickable words */
    .we-word {
      text-decoration: underline dotted;
      text-decoration-color: #888;
      text-underline-offset: 3px;
      cursor: pointer;
      transition: color 0.15s;
    }
    .we-word:hover, .we-word:focus, .we-word:active {
      color: #f8cd05;
      outline: none !important;
      box-shadow: none !important;
      border-color: transparent !important;
    }

    /* Tooltip container */
    .we-tooltip {
      position: absolute;
      z-index: 10000;
      max-width: 300px;
      background: #333;
      color: #f0f0f0;
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      opacity: 0;
      transform: scale(0.95);
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
    .we-tooltip.we-visible { opacity: 1; transform: scale(1); }

    /* Arrow pointing at word */
    .we-tooltip-arrow {
      position: absolute;
      top: -6px;
      width: 12px; height: 12px;
      background: #333;
      transform: rotate(45deg);
    }
    .we-tooltip.we-above .we-tooltip-arrow {
      top: auto;
      bottom: -6px;
    }

    .we-tooltip-word {
      font-size: 16px;
      font-weight: 700;
      margin: 0 0 4px;
      text-transform: capitalize;
    }

    .we-tooltip-meta {
      font-size: 13px;
      color: #aaa;
      font-style: italic;
      margin-bottom: 6px;
    }

    .we-tooltip-audio {
      background: none;
      border: 1px solid #666;
      border-radius: 12px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 14px;
      color: #f0f0f0;
      margin-bottom: 6px;
      transition: border-color 0.15s;
    }
    .we-tooltip-audio:hover { border-color: #f8cd05; }

    .we-tooltip-def {
      font-size: 13px;
      line-height: 1.4;
      margin: 3px 0 3px 8px;
      color: #ddd;
    }

    .we-tooltip-nodef {
      font-size: 13px;
      color: #999;
      margin: 4px 0;
    }

    .we-tooltip-loading {
      font-size: 13px;
      color: #999;
      padding: 4px 0;
    }

    /* Hint toast — pyramid layout */
    .we-hint-toast {
      position: fixed; bottom: clamp(10px, 1.8vw, 14px); left: clamp(10px, 1.8vw, 14px); z-index: 10001;
      display: flex; flex-direction: column; align-items: flex-start;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2));
      transform: translateY(120%) scale(0.8); opacity: 0;
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
    }
    .we-hint-toast.we-visible {
      transform: translateY(0) scale(1); opacity: 1;
    }
    .we-hint-toast.we-got-it {
      animation: hint-got-it 0.6s ease forwards;
    }
    @keyframes hint-got-it {
      0% { transform: translateY(0) scale(1); opacity: 1; }
      30% { transform: translateY(0) scale(1.08); }
      100% { transform: translateY(-20px) scale(0.9); opacity: 0; }
    }
    .we-hint-toast-header {
      display: flex; align-items: center; gap: 4px;
      background: #fff; border-radius: 8px; padding: clamp(6px, 1.2vw, 9px) clamp(8px, 1.4vw, 11px);
    }
    .we-hint-toast.we-expanded .we-hint-toast-header {
      border-radius: 8px 8px 0 0;
    }
    .we-hint-tiles { display: flex; gap: clamp(2px, 0.39vw, 3px); align-items: center; }
    .we-hint-tile {
      display: flex; align-items: center; justify-content: center;
      width: clamp(26px, 4.6vw, 35px); height: clamp(30px, 5.3vw, 41px); font-size: clamp(17px, 3vw, 23px);
      font-family: monospace; font-weight: 700; text-transform: uppercase;
      border-radius: 3px; box-sizing: border-box;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .we-hint-tile.filled { color: #000; background: #f8cd05; }
    .we-hint-tile.hint { color: #999; background: #f0f0f0; border: 2px solid #ddd; }
    .we-hint-tile.empty { color: transparent; border: 2px solid #ddd; }
    .we-hint-tile.typed { color: #000; border: 2px solid #f8cd05; background: #fef9e7; }
    .we-hint-toast-check {
      font-size: 22px; line-height: 1;
      opacity: 0; transform: scale(0);
      width: 0; overflow: hidden;
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.25s ease;
    }
    .we-hint-toast-check.we-visible { opacity: 1; transform: scale(1); width: auto; }
    .we-hint-toast-clue {
      background: #fff; border-radius: 0 8px 8px 8px;
      max-height: 0; opacity: 0; overflow: hidden;
      transition: max-height 0.15s ease-in, opacity 0.15s ease-in, padding 0.15s ease-in;
      font-size: clamp(15px, 2.6vw, 20px); font-weight: 400; line-height: 1.4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #333; word-wrap: break-word;
      padding: 0 clamp(14px, 2.5vw, 19px); max-width: clamp(320px, 56vw, 432px);
      border-top: 1px solid transparent;
    }
    .we-hint-toast.we-expanded .we-hint-toast-clue {
      max-height: 200px; opacity: 1;
      padding: clamp(10px, 1.8vw, 14px) clamp(14px, 2.5vw, 19px);
      border-top-color: #e0e0e0;
      transition: max-height 0.25s ease-out, opacity 0.2s ease-out, padding 0.25s ease-out;
    }
    .we-hint-toast-credit {
      display: block; font-size: clamp(11px, 1.9vw, 15px); font-style: italic;
      color: #888; margin-top: 4px;
    }
    /* Bee fly-in on page load */
    @keyframes bee-fly-in {
      0%   { transform: translate(60px, 40px) rotate(0deg); opacity: 0; }
      15%  { opacity: 1; }
      30%  { transform: translate(-10px, -15px) rotate(-8deg); }
      50%  { transform: translate(5px, 8px) rotate(5deg); }
      70%  { transform: translate(-3px, -4px) rotate(-3deg); }
      85%  { transform: translate(1px, 2px) rotate(1deg); }
      100% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
    }
    #bee-buddy { opacity: 0; }
    #bee-buddy.we-arrived {
      animation: bee-fly-in 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
    }
    /* Bee flies off downward (wiggly exit) */
    @keyframes bee-fly-out {
      0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
      15%  { transform: translate(12px, 8px) rotate(15deg); opacity: 1; }
      30%  { transform: translate(-15px, 35px) rotate(-18deg); opacity: 1; }
      45%  { transform: translate(18px, 70px) rotate(14deg); opacity: 0.9; }
      60%  { transform: translate(-12px, 110px) rotate(-12deg); opacity: 0.7; }
      75%  { transform: translate(8px, 150px) rotate(8deg); opacity: 0.4; }
      100% { transform: translate(-3px, 200px) rotate(-5deg); opacity: 0; }
    }
    #bee-buddy.we-exiting {
      animation: bee-fly-out 0.7s cubic-bezier(0.45, 0.05, 0.55, 0.95) forwards;
    }
    /* Bee returns from below (bouncy re-entrance) */
    @keyframes bee-return {
      0%   { transform: translate(0, 200px) rotate(0deg); opacity: 0; }
      10%  { opacity: 1; }
      25%  { transform: translate(14px, 60px) rotate(12deg); }
      40%  { transform: translate(-10px, -20px) rotate(-14deg); }
      55%  { transform: translate(8px, 10px) rotate(10deg); }
      70%  { transform: translate(-5px, -6px) rotate(-6deg); }
      82%  { transform: translate(3px, 3px) rotate(3deg); }
      92%  { transform: translate(-1px, -1px) rotate(-1deg); }
      100% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
    }
    #bee-buddy.we-returning {
      animation: bee-return 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
    }
    /* Bee hidden during hints (no ghost clicks) */
    #bee-buddy.we-exited {
      opacity: 0;
      pointer-events: none;
    }
    @keyframes finger-wag {
      0%, 100% { transform: translateY(-50%) rotate(0deg); }
      20%      { transform: translateY(-50%) rotate(15deg); }
      40%      { transform: translateY(-50%) rotate(-15deg); }
      60%      { transform: translateY(-50%) rotate(10deg); }
      80%      { transform: translateY(-50%) rotate(-5deg); }
    }
    /* Onboarding overlay */
    .ob-overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.2s ease;
    }
    .ob-overlay.we-visible { opacity: 1; }
    .ob-panel {
      background: #fff; color: #222; border-radius: 12px;
      padding: clamp(16px, 4.2vw, 32px);
      max-width: min(440px, 90vw); width: 90vw;
      position: relative;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      transform: scale(0.95); transition: transform 0.2s ease;
    }
    .ob-overlay.we-visible .ob-panel { transform: scale(1); }
    .ob-close {
      position: absolute; top: 12px; right: 16px;
      font-size: clamp(24px, 3.6vw, 28px);
      background: none; border: none; cursor: pointer; color: #666;
      line-height: 1; padding: clamp(8px, 1.3vw, 10px);
      min-height: 44px; min-width: 44px;
      display: flex; align-items: center; justify-content: center;
    }
    .ob-close:hover { color: #000; }
    .ob-title {
      font-size: clamp(22px, 3.6vw, 28px);
      font-weight: 700;
      margin: 0 0 4px;
      text-align: center;
    }
    .ob-subtitle {
      font-size: clamp(14px, 2.1vw, 16px);
      color: #666;
      text-align: center;
      margin-bottom: 20px;
      font-style: italic;
    }
    .ob-nyt-note {
      border-left: 4px solid #f8cd05;
      background: #fef9e7;
      padding: clamp(8px, 1.3vw, 10px) clamp(10px, 1.8vw, 14px);
      border-radius: 0 8px 8px 0;
      font-size: clamp(13px, 1.8vw, 14px);
      color: #555;
      margin-bottom: 20px;
      line-height: 1.5;
    }
    .ob-features {
      list-style: none;
      padding: 0;
      margin: 0 0 24px;
    }
    .ob-features li {
      font-size: clamp(14px, 2vw, 15px);
      padding: clamp(4px, 0.8vw, 6px) 0;
      line-height: 1.4;
    }
    .ob-features li strong { font-weight: 600; }
    .ob-cta {
      display: block;
      width: 100%;
      padding: clamp(12px, 1.8vw, 14px);
      font-size: clamp(16px, 2.3vw, 18px);
      font-weight: 700;
      background: #f8cd05;
      color: #000;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .ob-cta:hover { background: #e6bc00; }
    .ob-cta:focus { outline: 2px solid #000; outline-offset: 2px; }

    /* Update splash: release-notes sections (reuses .ob-* panel chrome) */
    .us-notes { margin: 8px 0 20px; }
    .us-version-heading {
      font-size: clamp(16px, 2.3vw, 18px);
      font-weight: 700;
      margin: 12px 0 4px;
    }
    .us-version-block:first-child .us-version-heading { margin-top: 0; }
    .us-section-title {
      font-size: clamp(13px, 1.8vw, 14px);
      font-weight: 600;
      color: #555;
      margin: 8px 0 2px;
    }
    .us-note-list {
      list-style: disc;
      margin: 0 0 8px;
      padding-left: 20px;
    }
    .us-note-list li {
      font-size: clamp(14px, 2vw, 15px);
      padding: 2px 0;
      line-height: 1.4;
    }
    .us-optout {
      display: block;
      width: 100%;
      margin-top: 10px;
      padding: 6px;
      background: none;
      border: none;
      color: #888;
      font-size: clamp(12px, 1.6vw, 13px);
      text-decoration: underline;
      cursor: pointer;
    }
    .us-optout:hover { color: #555; }

    @media (max-width: 600px) {
      .we-tooltip { max-width: min(280px, 90vw); }
      .we-hint-toast-clue { max-width: min(360px, 85vw); }
    }

    /* Collapse the empty vertical band above the "Type or click" prompt in the
       zoomed / narrow layout so the hex grid stays above the fold. NYT gives
       .sb-controls-box flex-grow:1, so it expands to fill the leftover column
       height and vertically centers the hive, pushing the prompt and grid down.
       Dropping the growth lets it size to its content. Verified on the live
       page: at narrow/zoomed widths this lifts the hive ~166px and brings the
       full grid above the fold; at desktop width it is a no-op (.sb-controls-box
       does not grow there), so no media-query / :has() scoping is needed. */
    .sb-controls-box {
      flex-grow: 0;
    }
  `);

  // ─── Module 1: Hide NYT Dock (runs on ALL NYT pages) ───────────────
  function hideDock() {
    const dock = document.querySelector(
      '#dock-container[data-testid="onsite-messaging-unit-dock"]'
    );
    if (dock) {
      dock.style.display = 'none';
      dock.remove();
      dockObserver.disconnect();
    }
  }

  hideDock();
  const dockObserver = new MutationObserver(hideDock);
  dockObserver.observe(document.body, { childList: true, subtree: true });

  // ─── Guard: Only run modules 2+ on Spelling Bee page ───────────────
  if (!location.pathname.includes('/puzzles/spelling-bee')) return;

  // ─── Hint State (hoisted for bee click handler access) ────────────
  let hintActive = false;
  let hintQueue = [];
  let hintIndex = 0;
  let hintDismissing = false;
  let clueCache = null;      // Map<word, {text, user, url}> — fetched once per puzzle
  let cluePromise = null;    // In-flight clue fetch, shared so prefetch + "." don't double-request
  let lastPuzzleId = null;   // Tracks current puzzle to detect navigation to back-catalog
  let onboardingActive = false;

  // ─── Module 2: Bee Buddy Button ───────────────────────────────────
  if (!document.getElementById('bee-buddy')) {
    const bee = document.createElement('div');
    bee.id = 'bee-buddy';
    bee.textContent = '\uD83D\uDC1D';
    bee.setAttribute('role', 'link');
    bee.setAttribute('aria-label', 'Open Spelling Bee Buddy');
    bee.tabIndex = 0;

    bee.style.cssText = `
      position: fixed;
      bottom: clamp(10px, 1.8vw, 14px);
      right: clamp(10px, 1.8vw, 14px);
      cursor: pointer;
      font-size: clamp(30px, 5.3vw, 41px);
      z-index: 9999;
      user-select: none;
    `;

    function goToBeeBuddy() {
      if (!hintActive) {
        window.open('https://www.nytimes.com/interactive/2023/upshot/spelling-bee-buddy.html', '_blank');
      }
    }
    bee.addEventListener('click', goToBeeBuddy);
    bee.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToBeeBuddy(); }
    });

    document.body.appendChild(bee);
  }

  // ─── Auto-dismiss Play/Resume interstitials ─────────────────────────
  // NYT shows a yellow loading screen (#js-hook-pz-moment__loading) and/or
  // a Play/Resume modal. Poll and remove whatever we find.
  const interstitialTimer = setInterval(() => {
    const btns = document.querySelectorAll('button.pz-moment__button.primary, .pz-moment__close');
    const btn = Array.from(btns).find(b => {
      const text = b.textContent.trim().toLowerCase();
      return text === 'play' || text === 'resume' || text === 'continue' || b.classList.contains('pz-moment__close');
    });
    if (btn) btn.click();
    const splash = document.querySelector('#js-hook-pz-moment__loading, .pz-moment');
    if (splash) splash.remove();
    if (btn || splash) clearInterval(interstitialTimer);
  }, 200);
  setTimeout(() => clearInterval(interstitialTimer), 10000);

  // ─── Onboarding Overlay (one-time welcome) ────────────────────────
  if (!localStorage.getItem('betterBee_onboardingSeen')) {
    onboardingActive = true;

    const obOverlay = document.createElement('div');
    obOverlay.className = 'ob-overlay';
    obOverlay.setAttribute('role', 'dialog');
    obOverlay.setAttribute('aria-modal', 'true');
    obOverlay.setAttribute('aria-label', 'Welcome to Better Bee');
    obOverlay.innerHTML = `
      <div class="ob-panel">
        <button class="ob-close" aria-label="Close">&times;</button>
        <div style="text-align: center; font-size: clamp(36px, 6.25vw, 48px); margin-bottom: 8px;">🐝</div>
        <h2 class="ob-title">Welcome to Better Bee</h2>
        <p class="ob-subtitle">A few small enhancements for Spelling Bee</p>
        <div class="ob-nyt-note">
          Spelling Bee is created by The New York Times. Better Bee is an unofficial fan project &mdash; thank you, NYT, for making such a great game!
        </div>
        <ul class="ob-features">
          <li>😊 <strong>Emoji feedback</strong> &mdash; visual reactions to your guesses</li>
          <li>📖 <strong>Word Explorer</strong> &mdash; tap found words for definitions</li>
          <li>💡 <strong>Hints</strong> &mdash; press <kbd>?</kbd> for a gentle nudge</li>
          <li>🐝 <strong>Bee Buddy</strong> &mdash; quick access to NYT&rsquo;s hint companion</li>
        </ul>
        <button class="ob-cta">Let's Play!</button>
      </div>`;
    obOverlay.style.display = 'none';
    document.body.appendChild(obOverlay);

    const obCloseBtn = obOverlay.querySelector('.ob-close');
    const obCtaBtn = obOverlay.querySelector('.ob-cta');

    function dismissOnboarding() {
      localStorage.setItem('betterBee_onboardingSeen', '1');
      onboardingActive = false;
      obOverlay.classList.remove('we-visible');
      setTimeout(() => {
        obOverlay.remove();
        // Trigger bee fly-in now that onboarding is done
        const bee = document.getElementById('bee-buddy');
        if (bee && !bee.classList.contains('we-arrived')) {
          setTimeout(() => bee.classList.add('we-arrived'), 300);
        }
      }, 200);
    }

    obCtaBtn.addEventListener('click', dismissOnboarding);
    obCloseBtn.addEventListener('click', dismissOnboarding);
    obOverlay.addEventListener('click', e => {
      if (e.target === obOverlay) dismissOnboarding();
    });
    obOverlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismissOnboarding();
        return;
      }
      // Focus trap
      if (e.key !== 'Tab') return;
      const focusables = obOverlay.querySelectorAll(
        'button, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // Show after puzzle DOM is ready
    const obTimer = setInterval(() => {
      if (document.querySelector('.sb-hive-input-content')) {
        clearInterval(obTimer);
        setTimeout(() => {
          obOverlay.style.display = 'flex';
          requestAnimationFrame(() => {
            obOverlay.classList.add('we-visible');
            obCtaBtn.focus();
          });
        }, 500);
      }
    }, 200);
    setTimeout(() => clearInterval(obTimer), 15000);
  }

  // ─── Update Splash (post-update "what's new" news) ─────────────────
  // Per-release opt-in: a version with no entry here updates silently.
  // Keep only the ~5 newest versions; prune older entries when shipping.
  const RELEASE_NOTES = {
    '1.44': {
      features: [],
      fixes: [
        '📖 Word definitions are much more reliable: failed lookups now retry when you click the word instead of staying broken all session',
        '🐝 The definition tooltip can no longer get stuck on "Loading…" or pop back open after you dismiss it',
      ],
    },
    '1.43': {
      features: [],
      fixes: [
        '⌨️ Chrome: pressing "." to reveal a hint\'s clue text no longer hangs — the clue loads reliably now (quietly fixed in v1.41) 🎉',
      ],
    },
    '1.42': {
      features: [
        'Update news: see what changed when Better Bee updates',
        'Re-read these notes anytime: Tampermonkey menu → Preview update news',
      ],
      fixes: [],
    },
  };

  // Segment-wise numeric compare: '1.9' < '1.10' (parseFloat would get this wrong).
  function compareVersions(a, b) {
    const as = String(a).split('.');
    const bs = String(b).split('.');
    const len = Math.max(as.length, bs.length);
    for (let i = 0; i < len; i++) {
      const an = Number(as[i] || 0);
      const bn = Number(bs[i] || 0);
      if (an !== bn) return an < bn ? -1 : 1;
    }
    return 0;
  }

  // Noted versions with lastSeen < v <= current, newest first.
  function collectUnseenNotes(lastSeen, current, notes) {
    return Object.keys(notes)
      .filter(v => compareVersions(lastSeen, v) < 0 && compareVersions(v, current) <= 0)
      .sort((a, b) => compareVersions(b, a))
      .map(v => ({
        version: v,
        features: notes[v].features || [],
        fixes: notes[v].fixes || [],
      }));
  }

  // createElement + textContent only — note strings must never hit innerHTML.
  function buildSplashContent(doc, entries) {
    const container = doc.createElement('div');
    container.className = 'us-notes';
    for (const entry of entries) {
      const block = doc.createElement('div');
      block.className = 'us-version-block';
      const heading = doc.createElement('h3');
      heading.className = 'us-version-heading';
      heading.textContent = `v${entry.version}`;
      block.appendChild(heading);
      const sections = [
        ['✨ New', entry.features],
        ['🐛 Fixed', entry.fixes],
      ];
      for (const [label, items] of sections) {
        if (!items || items.length === 0) continue;
        const title = doc.createElement('div');
        title.className = 'us-section-title';
        title.textContent = label;
        block.appendChild(title);
        const list = doc.createElement('ul');
        list.className = 'us-note-list';
        for (const item of items) {
          const li = doc.createElement('li');
          li.textContent = item;
          list.appendChild(li);
        }
        block.appendChild(list);
      }
      container.appendChild(block);
    }
    return container;
  }

  // Shared render path for the normal post-update flow and the menu preview.
  // `onShown` (optional) runs when the splash becomes visible — the normal
  // flow uses it to mark the version seen; the preview passes nothing.
  function showUpdateSplash(entries, onShown) {
    if (!entries || entries.length === 0) return;

    const usOverlay = document.createElement('div');
    usOverlay.className = 'ob-overlay';
    usOverlay.setAttribute('role', 'dialog');
    usOverlay.setAttribute('aria-modal', 'true');
    usOverlay.setAttribute('aria-label', 'Better Bee update news');
    usOverlay.innerHTML = `
      <div class="ob-panel">
        <button class="ob-close" aria-label="Close">&times;</button>
        <h2 class="ob-title"></h2>
        <button class="ob-cta">Got it</button>
        <button class="us-optout" type="button">Don't show update news again</button>
      </div>`;
    usOverlay.querySelector('.ob-title').textContent =
      `Better Bee updated — v${entries[0].version}`;
    const usCtaBtn = usOverlay.querySelector('.ob-cta');
    usOverlay.querySelector('.ob-panel')
      .insertBefore(buildSplashContent(document, entries), usCtaBtn);
    usOverlay.style.display = 'none';
    document.body.appendChild(usOverlay);

    function dismissUpdateSplash() {
      onboardingActive = false;
      usOverlay.classList.remove('we-visible');
      setTimeout(() => usOverlay.remove(), 200);
    }

    usCtaBtn.addEventListener('click', dismissUpdateSplash);
    usOverlay.querySelector('.ob-close').addEventListener('click', dismissUpdateSplash);
    usOverlay.querySelector('.us-optout').addEventListener('click', () => {
      GM_setValue('bb_update_news_optout', true);
      dismissUpdateSplash();
    });
    usOverlay.addEventListener('click', e => {
      if (e.target === usOverlay) dismissUpdateSplash();
    });
    usOverlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismissUpdateSplash();
        return;
      }
      // Focus trap
      if (e.key !== 'Tab') return;
      const focusables = usOverlay.querySelectorAll(
        'button, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // Show after puzzle DOM is ready (same wait pattern as onboarding)
    const usTimer = setInterval(() => {
      if (document.querySelector('.sb-hive-input-content')) {
        clearInterval(usTimer);
        setTimeout(() => {
          // Modules that suppress behavior under the onboarding modal treat
          // the splash identically; seen-on-render so a crash can't re-show.
          onboardingActive = true;
          if (onShown) onShown();
          usOverlay.style.display = 'flex';
          requestAnimationFrame(() => {
            usOverlay.classList.add('we-visible');
            usCtaBtn.focus();
          });
        }, 500);
      }
    }, 200);
    setTimeout(() => clearInterval(usTimer), 15000);
  }

  (function maybeShowUpdateSplash() {
    const current = GM_info?.script?.version;
    if (!current) return;
    const lastSeen = GM_getValue('bb_last_seen_version', null);
    if (lastSeen === null) {
      // First install: onboarding covers the intro; seed silently.
      GM_setValue('bb_last_seen_version', current);
      return;
    }
    // Keep last-seen advancing while opted out so re-enabling shows no backlog.
    if (GM_getValue('bb_update_news_optout', false) || onboardingActive) {
      GM_setValue('bb_last_seen_version', current);
      return;
    }
    const entries = collectUnseenNotes(lastSeen, current, RELEASE_NOTES);
    if (entries.length === 0) {
      GM_setValue('bb_last_seen_version', current);
      return;
    }
    showUpdateSplash(entries, () => GM_setValue('bb_last_seen_version', current));
  })();

  // ─── Module 3: Visual Feedback Emojis ──────────────────────────────
  const emojiEl = document.createElement('img');
  Object.assign(emojiEl.style, {
    position: 'fixed',
    top: '50%',
    right: '5%',
    transform: 'translateY(-50%) scale(0)',
    width: '25vw',
    height: '25vw',
    pointerEvents: 'none',
    zIndex: '9999',
    opacity: '0',
    transition: 'none',
  });
  emojiEl.alt = '';
  document.body.appendChild(emojiEl);

  let emojiTimer = null;

  function showEmoji(emoji, type) {
    clearTimeout(emojiTimer);
    emojiEl.style.transition = 'none';
    emojiEl.style.animation = 'none';
    emojiEl.style.opacity = '0';
    emojiEl.style.transform = 'translateY(-50%) scale(0)';
    emojiEl.style.transformOrigin = '';
    emojiEl.src = emoji;
    emojiEl.offsetHeight; // reflow

    emojiEl.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out';
    emojiEl.style.opacity = '1';
    emojiEl.style.transform = 'translateY(-50%) scale(1)';

    if (type === 'duplicate') {
      emojiEl.style.transformOrigin = 'bottom center';
      emojiEl.style.animation = 'finger-wag 600ms ease-in-out';
    }

    emojiTimer = setTimeout(() => {
      emojiEl.style.animation = 'none';
      emojiEl.offsetHeight; // reflow so browser registers animation-cleared state
      emojiEl.style.transition = 'opacity 300ms ease-in, transform 300ms ease-in';
      emojiEl.style.opacity = '0';
      emojiEl.style.transform = 'translateY(-50%) scale(0.5)';
    }, 600);
  }

  function classifyMessage(text) {
    if (!text) return null;
    text = text.toLowerCase();
    if (/already\s*found/.test(text) || text.includes('already') || text.includes('found it')) {
      return 'duplicate';
    }
    if (/^(nice|great|awesome|good|solid|amazing|wonderful|excellent|genius|pangram|queen bee)/.test(text)) {
      return 'success';
    }
    return 'error';
  }

  // Hide NYT game header
  document
    .querySelectorAll('.pz-header.pz-hide-loading.pz-game-header')
    .forEach(e => (e.style.display = 'none'));

  // ─── Module 4: Word Explorer ────────────────────────────────────────

  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'we-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.innerHTML = '<div class="we-tooltip-arrow"></div><div class="we-tooltip-body"></div>';
  document.body.appendChild(tooltip);
  const tooltipBody = tooltip.querySelector('.we-tooltip-body');

  function hideTooltip() {
    requestCounter++; // dismissal outranks any in-flight showTooltip resolution
    tooltip.classList.remove('we-visible');
    setTimeout(() => { tooltip.style.display = 'none'; }, 150);
  }

  function positionTooltip(anchor) {
    const rect = anchor.getBoundingClientRect();
    const arrow = tooltip.querySelector('.we-tooltip-arrow');
    tooltip.style.display = 'block';
    tooltip.classList.remove('we-above');

    // Measure tooltip
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;

    // Place below by default; flip above if not enough room
    const gap = 8;
    let top = rect.bottom + gap + window.scrollY;
    let above = false;
    if (rect.bottom + gap + th > window.innerHeight && rect.top - gap - th > 0) {
      top = rect.top - th - gap + window.scrollY;
      above = true;
      tooltip.classList.add('we-above');
    }

    // Horizontally center on word, clamped to viewport
    let left = rect.left + rect.width / 2 - tw / 2 + window.scrollX;
    const margin = 8;
    left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin + window.scrollX));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Position arrow to point at center of word
    const arrowLeft = rect.left + rect.width / 2 - left - window.scrollX;
    arrow.style.left = `${Math.max(12, Math.min(arrowLeft, tw - 12))}px`;
  }

  // Dismiss on click outside or Escape
  document.addEventListener('pointerdown', e => {
    if (tooltip.style.display !== 'none' && !tooltip.contains(e.target) && !e.target.closest('.we-word')) {
      hideTooltip();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Dismiss hints first
    if (hintActive) {
      e.preventDefault();
      stopHints();
      return;
    }
    // Close tooltip
    if (tooltip.style.display !== 'none') {
      e.preventDefault();
      hideTooltip();
      return;
    }
    // Close NYT native modals (e.g. "Keep playing" screen)
    const nytClose = document.querySelector('.pz-icon-close, .sb-modal-close, .pz-moment__close');
    if (nytClose) {
      e.preventDefault();
      nytClose.click();
    }
  });
  tooltip.style.display = 'none';

  // API helpers
  const GM_FETCH_TIMEOUT_MS = 2500;

  // Watchdog timer is ours, not the extension's: Tampermonkey MV3 on Chrome can
  // drop GM_xmlhttpRequest callbacks entirely (no onload OR onerror), which
  // would otherwise hang callers forever.
  function gmRequest(url) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('GM timeout')), GM_FETCH_TIMEOUT_MS);
      const ok = v => { clearTimeout(timer); resolve(v); };
      const fail = e => { clearTimeout(timer); reject(e); };
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: GM_FETCH_TIMEOUT_MS,
          onload: res => {
            if (res.status >= 200 && res.status < 300) {
              try { ok(JSON.parse(res.responseText)); }
              catch { fail(new Error('Invalid JSON')); }
            } else {
              const err = new Error(`HTTP ${res.status}`);
              err.status = res.status; // real server answer — lets gmFetch skip a pointless retry
              fail(err);
            }
          },
          onerror: () => fail(new Error('Network error')),
          ontimeout: () => fail(new Error('GM timeout')),
        });
      } catch (e) { fail(e); }
    });
  }

  async function gmFetch(url) {
    try {
      return await gmRequest(url);
    } catch (e) {
      // Any real HTTP status means the server answered; page fetch would just
      // repeat the same answer and double the load.
      if (e && e.status) throw e;
      // Every host we call serves Access-Control-Allow-Origin: *, so page
      // fetch works when the GM transport is broken or slow.
      const res = await fetch(url, { signal: AbortSignal.timeout(GM_FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }
  }

  function fetchDictionary(word) {
    if (mwApiKey) {
      return gmFetch(`https://dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${encodeURIComponent(mwApiKey)}`);
    }
    return gmFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  }

  const defInflight = new Map(); // word → in-flight promise: dedups prefetch vs click

  // Resolves to a dictResult; never rejects. Caches success and definitive
  // not-found (HTTP 404); transient failures are NOT cached so a later click retries.
  function getDefinition(word) {
    const key = word.toLowerCase();
    if (apiCache.has(key)) return Promise.resolve(apiCache.get(key).dictResult);
    if (defInflight.has(key)) return defInflight.get(key);
    const p = (async () => {
      try {
        const result = await fetchDictionary(word);
        const dictResult = { status: 'fulfilled', value: result, source: mwApiKey ? 'mw' : 'free' };
        apiCache.set(key, { dictResult });
        return dictResult;
      } catch (e) {
        const dictResult = { status: 'rejected', notFound: !!(e && e.status === 404) };
        if (dictResult.notFound) apiCache.set(key, { dictResult });
        return dictResult;
      } finally {
        defInflight.delete(key);
      }
    })();
    defInflight.set(key, p);
    return p;
  }

  // Pre-fetch definitions for instant tooltip display — bounded so we never
  // burst-hammer the dictionary API, with a breaker that stops background
  // prefetching during an outage/rate-limit (clicks still fetch on demand).
  const prefetchQueue = [];
  let prefetchActive = 0;
  let prefetchFailures = 0; // consecutive transient failures; success resets
  const PREFETCH_CONCURRENCY = 2;
  const PREFETCH_MAX_FAILURES = 3;

  function prefetchDefinition(word) {
    const key = word.toLowerCase();
    if (apiCache.has(key) || defInflight.has(key) || prefetchQueue.includes(key)) return;
    prefetchQueue.push(key);
    pumpPrefetch();
  }

  async function pumpPrefetch() {
    if (prefetchActive >= PREFETCH_CONCURRENCY || prefetchFailures >= PREFETCH_MAX_FAILURES) return;
    const key = prefetchQueue.shift();
    if (!key) return;
    prefetchActive++;
    const dictResult = await getDefinition(key);
    if (dictResult.status === 'rejected' && !dictResult.notFound) prefetchFailures++;
    else prefetchFailures = 0;
    prefetchActive--;
    pumpPrefetch();
  }

  async function fetchClues() {
    if (clueCache) return clueCache;
    if (!cluePromise) {
      cluePromise = (async () => {
        try {
          const puzzleId = unsafeWindow.gameData.today.id;
          const url = `https://static01.nyt.com/newsgraphics/2023-01-18-spelling-bee-buddy/clues/${puzzleId}.json`;
          const data = await gmFetch(url).catch(() => null);
          if (data && Array.isArray(data)) {
            clueCache = new Map(data.map(c => [c.word, c]));
          }
        } catch { /* silent fail — Level 2 will show fallback */ }
        cluePromise = null;
        return clueCache;
      })();
    }
    return cluePromise;
  }

  function getMwAudioUrl(audio) {
    if (!audio) return '';
    let subdir;
    if (audio.startsWith('bix')) subdir = 'bix';
    else if (audio.startsWith('gg')) subdir = 'gg';
    else if (/^[0-9\W]/.test(audio)) subdir = 'number';
    else subdir = audio.charAt(0);
    return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audio}.mp3`;
  }

  function buildTooltipContent(word, dictResult) {
    let html = '';

    // Word heading
    html += `<div class="we-tooltip-word">${escapeHTML(word)}</div>`;

    // Dictionary content
    if (dictResult.status === 'fulfilled' && Array.isArray(dictResult.value)) {
      // MW returns array of strings when word not found (suggestions)
      if (dictResult.source === 'mw' && typeof dictResult.value[0] === 'string') {
        html += `<div class="we-tooltip-nodef">No definition found.</div>`;
        return html;
      }

      if (dictResult.source === 'mw') {
        // Merriam-Webster format
        const entry = dictResult.value[0];
        const pos = entry.fl || '';
        const phonetic = entry.hwi?.prs?.[0]?.mw ? `/${entry.hwi.prs[0].mw}/` : '';
        const metaParts = [pos, phonetic].filter(Boolean);
        if (metaParts.length) {
          html += `<div class="we-tooltip-meta">${metaParts.map(escapeHTML).join(' \u00b7 ')}</div>`;
        }

        // Audio
        const audioFile = entry.hwi?.prs?.[0]?.sound?.audio;
        const audioUrl = getMwAudioUrl(audioFile);
        if (audioUrl) {
          html += `<button class="we-tooltip-audio" data-audio="${escapeHTML(audioUrl)}">&#128264;</button>`;
        }

        // Definitions
        const defs = entry.shortdef || [];
        for (const def of defs.slice(0, 2)) {
          html += `<div class="we-tooltip-def">&bull; ${escapeHTML(def)}</div>`;
        }
      } else {
        // Free dictionary API format (default)
        const entry = dictResult.value[0];

        // Part of speech + phonetic on one line
        const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '';
        const firstPos = entry.meanings?.[0]?.partOfSpeech || '';
        const metaParts = [firstPos, phonetic].filter(Boolean);
        if (metaParts.length) {
          html += `<div class="we-tooltip-meta">${metaParts.map(escapeHTML).join(' \u00b7 ')}</div>`;
        }

        // Audio button (small, inline)
        const audioUrl = entry.phonetics
          ?.map(p => p.audio)
          .filter(a => a && a.length > 0)[0];
        if (audioUrl) {
          html += `<button class="we-tooltip-audio" data-audio="${escapeHTML(audioUrl)}">&#128264;</button>`;
        }

        // 1-2 definitions from first meaning group
        const defs = entry.meanings?.[0]?.definitions;
        if (defs) {
          for (const def of defs.slice(0, 2)) {
            html += `<div class="we-tooltip-def">&bull; ${escapeHTML(def.definition)}</div>`;
          }
        }
      }
    } else if (dictResult.status === 'rejected' && !dictResult.notFound) {
      html += `<div class="we-tooltip-nodef">Couldn’t load definition — click the word to retry.</div>`;
    } else {
      html += `<div class="we-tooltip-nodef">No definition found.</div>`;
    }

    return html;
  }

  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function showTooltip(word, anchor) {
    const myRequest = ++requestCounter;

    const cacheKey = word.toLowerCase();

    if (!apiCache.has(cacheKey)) {
      // Show loading state while fetching
      tooltipBody.innerHTML = '<div class="we-tooltip-loading">Loading\u2026</div>';
      tooltip.style.display = 'block';
      positionTooltip(anchor);
      requestAnimationFrame(() => tooltip.classList.add('we-visible'));
    }
    const dictResult = await getDefinition(word);

    // Discard stale responses
    if (myRequest !== requestCounter) return;

    tooltipBody.innerHTML = buildTooltipContent(word, dictResult);
    tooltip.style.display = 'block';
    positionTooltip(anchor);
    requestAnimationFrame(() => tooltip.classList.add('we-visible'));

    // Wire up audio button
    const audioBtn = tooltipBody.querySelector('.we-tooltip-audio');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        const audio = new Audio(audioBtn.dataset.audio);
        audio.play().catch(() => {});
      });
    }
  }

  // Word list processor
  function processWordList() {
    for (const sel of WORD_LIST_SELECTORS) {
      document.querySelectorAll(sel).forEach(li => {
        if (li.dataset.weProcessed) return;
        li.dataset.weProcessed = '1';

        // NYT renders each word as <span class="sb-anagram">word</span><span class="visually-hidden">word</span>,
        // so li.textContent concatenates to "wordword" (and the pangram appends " (pangram)" to the hidden span).
        const wordText = (li.querySelector('.sb-anagram')?.textContent || li.textContent).trim().toLowerCase();
        if (!wordText || wordText.length < MIN_WORD_LENGTH) return;

        li.classList.add('we-word');
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', `Look up ${wordText}`);
        li.tabIndex = 0;
        prefetchDefinition(wordText);

        li.addEventListener('pointerdown', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
        }, true);
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
        }, true);
        li.addEventListener('click', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          li.blur();
          showTooltip(wordText, li);
        }, true);
        li.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            showTooltip(wordText, li);
          }
        });
      });
    }
  }

  // ─── Track input so we have the word even after NYT clears it ──────
  let lastInputText = '';
  let inputObserverAttached = false;
  function hookInputObserver() {
    if (inputObserverAttached) return;
    const el = document.querySelector('.sb-hive-input-content');
    if (!el) return;
    inputObserverAttached = true;
    // Puzzle is ready — wait for layout to settle, then trigger bee fly-in
    // (suppressed during onboarding; dismissOnboarding() triggers it instead)
    const bee = document.getElementById('bee-buddy');
    if (bee && !bee.classList.contains('we-arrived') && !onboardingActive) {
      setTimeout(() => bee.classList.add('we-arrived'), 1000);
    }
    new MutationObserver(() => {
      const text = el.textContent?.trim();
      if (text) lastInputText = text;
      // Update hint tiles with current input
      if (hintActive && hintIndex > 0 && !hintDismissing) {
        const tiles = hintTiles.querySelectorAll('.we-hint-tile');
        const input = (text || '').toUpperCase();
        const word = (hintQueue[hintIndex - 1]?.word || '').toUpperCase();
        for (let i = 0; i < tiles.length; i++) {
          if (i < input.length) {
            tiles[i].textContent = input[i];
            tiles[i].className = 'we-hint-tile ' + (i < 2 ? 'filled' : 'typed');
          } else if (i < 2) {
            // Restore prefix placeholder
            tiles[i].textContent = word[i] || '';
            tiles[i].className = 'we-hint-tile hint';
          } else {
            tiles[i].textContent = '';
            tiles[i].className = 'we-hint-tile empty';
          }
        }
      }
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }
  hookInputObserver();

  // ─── Shared MutationObserver (emoji feedback + word list) ───────────
  const mainObserver = new MutationObserver(mutations => {
    let shouldProcessWords = false;
    hookInputObserver(); // retry if element wasn't ready at script init

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Emoji feedback: detect .sb-message
        const targets = [];
        if (node.classList?.contains('sb-message')) targets.push(node);
        if (node.querySelectorAll) targets.push(...node.querySelectorAll('.sb-message'));

        for (const target of targets) {
          // Use tracked input (reliable) with direct read as fallback
          const input = document.querySelector('.sb-hive-input-content');
          const directRead = input?.textContent?.trim() || '';
          const capturedWord = directRead.length >= MIN_WORD_LENGTH ? directRead : lastInputText;
          // Preemptively guard tiles if this looks like a successful hint match
          const pendingGotIt = hintActive && !hintDismissing && currentHintMatches(capturedWord);
          if (pendingGotIt) hintDismissing = true;
          setTimeout(() => {
            const text = target.textContent?.trim();
            const type = classifyMessage(text);
            if (type) showEmoji(EMOJIS[type], type);
            if (type === 'success' && pendingGotIt) {
              hintToastCheck.classList.add('we-visible');
              setTimeout(() => {
                hintToast.classList.add('we-got-it');
                setTimeout(() => {
                  hideHintToast();
                  setTimeout(() => {
                    hintDismissing = false;
                    nextHint();
                  }, 400);
                }, 600);
              }, 400);
            } else if (pendingGotIt) {
              hintDismissing = false;  // Wasn't success — release guard
            }
          }, 100);
        }

        // Word list: check if new words were added
        shouldProcessWords = true;
      }
    }

    if (shouldProcessWords) processWordList();
  });

  mainObserver.observe(document.body, { childList: true, subtree: true });

  // ─── Module 5: Hint System ───────────────────────────────────────────

  // Create hint toast element
  const hintToast = document.createElement('div');
  hintToast.className = 'we-hint-toast';
  hintToast.innerHTML = `
    <div class="we-hint-toast-header">
      <div class="we-hint-tiles"></div>
      <span class="we-hint-toast-check">\u2705</span>
    </div>
    <div class="we-hint-toast-clue"></div>`;
  document.body.appendChild(hintToast);

  const hintTiles = hintToast.querySelector('.we-hint-tiles');
  const hintToastCheck = hintToast.querySelector('.we-hint-toast-check');
  const hintToastClue = hintToast.querySelector('.we-hint-toast-clue');

  function getAnswers() {
    try {
      return unsafeWindow.gameData.today.answers;
    } catch {
      return null;
    }
  }

  function getFoundWords() {
    const found = new Set();
    for (const sel of WORD_LIST_SELECTORS) {
      document.querySelectorAll(sel).forEach(li => {
        const word = (li.querySelector('.sb-anagram')?.textContent || li.textContent).trim().toLowerCase();
        if (word) found.add(word);
      });
    }
    return found;
  }

  function currentHintMatches(word) {
    if (!word || hintIndex === 0 || hintIndex > hintQueue.length) return false;
    const entry = hintQueue[hintIndex - 1];
    // Exact word match (more reliable)
    if (entry.word && word.toLowerCase() === entry.word) return true;
    // Fallback: prefix + length match
    const prefix = entry.hint.slice(0, 2);
    const len = parseInt(entry.hint.split(' ').pop(), 10);
    const upper = word.toUpperCase();
    return upper.length === len && upper.startsWith(prefix);
  }

  function buildHintQueue() {
    const currentId = unsafeWindow.gameData?.today?.id;
    if (currentId && currentId !== lastPuzzleId) {
      lastPuzzleId = currentId;
      clueCache = null;   // Invalidate clues for old puzzle
      cluePromise = null; // Drop any in-flight fetch for the old puzzle too
    }

    const answers = getAnswers();
    if (!answers) return null;
    const found = getFoundWords();
    const remaining = answers.filter(w => !found.has(w.toLowerCase()));
    if (remaining.length === 0) return [];

    // Build hints: objects with word + display hint
    const hints = remaining.map(w => ({
      word: w.toLowerCase(),
      hint: w.toUpperCase().slice(0, 2) + '.. ' + w.length,
    }));

    // Shuffle (Fisher-Yates)
    for (let i = hints.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [hints[i], hints[j]] = [hints[j], hints[i]];
    }
    return hints;
  }

  function renderHintTiles(word) {
    hintTiles.innerHTML = '';
    for (let i = 0; i < word.length; i++) {
      const tile = document.createElement('span');
      tile.className = 'we-hint-tile ' + (i < 2 ? 'hint' : 'empty');
      tile.textContent = i < 2 ? word[i].toUpperCase() : '';
      hintTiles.appendChild(tile);
    }
  }

  function showHintToast(entryOrText) {
    if (typeof entryOrText === 'object' && entryOrText.word) {
      renderHintTiles(entryOrText.word);
    } else {
      hintTiles.innerHTML = '';
      const span = document.createElement('span');
      span.style.cssText = 'font-size: 14px; font-weight: 700; white-space: nowrap;';
      span.textContent = entryOrText;
      hintTiles.appendChild(span);
    }
    hintToastClue.innerHTML = '';
    hintToast.classList.remove('we-expanded');
    hintToastCheck.classList.remove('we-visible');
    hintToast.classList.remove('we-got-it', 'we-visible');
    hintToast.offsetHeight; // reflow
    hintToast.classList.add('we-visible');
  }

  function hideHintToast() {
    hintToast.classList.remove('we-visible', 'we-got-it', 'we-expanded');
    hintToastCheck.classList.remove('we-visible');
  }

  async function expandHint() {
    if (!hintActive || hintIndex === 0 || hintIndex > hintQueue.length) return;
    const entry = hintQueue[hintIndex - 1];
    // Expand with a loading state BEFORE awaiting: the clue fetch can stall
    // (see gmRequest), and "." must always visibly respond.
    hintToastClue.textContent = '\u2026';
    hintToast.classList.add('we-expanded');
    const clues = await fetchClues();
    if (!hintActive || hintQueue[hintIndex - 1] !== entry) return;
    const clue = clues?.get(entry.word);
    if (clue?.text) {
      hintToastClue.textContent = '';
      const q = document.createElement('span');
      q.textContent = `\u201C${clue.text}\u201D`;
      hintToastClue.appendChild(q);
      if (clue.user) {
        const cr = document.createElement('span');
        cr.className = 'we-hint-toast-credit';
        cr.textContent = `Clue by ${clue.user}`;
        hintToastClue.appendChild(cr);
      }
    } else {
      hintToastClue.textContent = '(no clue available)';
    }
    // No re-add of we-expanded here: if the user collapsed while loading,
    // the resolved clue must not pop the panel back open.
  }

  function collapseHint() {
    hintToast.classList.remove('we-expanded');
  }

  function nextHint() {
    if (!hintActive || hintDismissing) return;

    // Try up to 2 passes: skip found words, rebuild if needed
    for (let pass = 0; pass < 2; pass++) {
      if (hintIndex >= hintQueue.length) {
        hintQueue = buildHintQueue();
        hintIndex = 0;

        if (hintQueue === null) {
          showHintToast('Hints unavailable');
          setTimeout(() => { stopHints(); }, 3000);
          return;
        }
        if (hintQueue.length === 0) {
          showHintToast('You found them all!');
          setTimeout(() => { stopHints(); }, 3000);
          return;
        }
      }

      // Skip any entries the user has since found
      const found = getFoundWords();
      while (hintIndex < hintQueue.length && found.has(hintQueue[hintIndex].word)) {
        hintIndex++;
      }

      if (hintIndex < hintQueue.length) {
        hintIndex++;
        showHintToast(hintQueue[hintIndex - 1]);
        return;
      }
      // All remaining were found — loop back to rebuild
    }

    // Both passes failed — everything found
    showHintToast('You found them all!');
    setTimeout(() => { stopHints(); }, 3000);
  }

  function startHints() {
    hintQueue = buildHintQueue();
    hintIndex = 0;

    if (hintQueue === null) {
      showHintToast('Hints unavailable');
      setTimeout(() => { hideHintToast(); }, 3000);
      return;
    }
    if (hintQueue.length === 0) {
      showHintToast('You found them all!');
      setTimeout(() => { hideHintToast(); }, 3000);
      return;
    }

    hintActive = true;
    const bee = document.getElementById('bee-buddy');
    if (bee) {
      bee.classList.remove('we-hinting', 'we-arrived', 'we-returning');
      bee.classList.add('we-exiting');
      setTimeout(() => { if (hintActive) bee.classList.add('we-exited'); }, 600);
    }
    fetchClues(); // pre-fetch in background
    setTimeout(() => { if (hintActive) nextHint(); }, 450);
  }

  function stopHints() {
    hintActive = false;
    hideHintToast();
    const bee = document.getElementById('bee-buddy');
    if (bee) {
      bee.classList.remove('we-hinting', 'we-exiting', 'we-exited');
      setTimeout(() => {
        bee.classList.add('we-returning');
        bee.addEventListener('animationend', function onReturn() {
          bee.removeEventListener('animationend', onReturn);
          bee.classList.remove('we-returning');
          bee.classList.add('we-arrived');
        });
      }, 400);
    }
  }

  // Keyboard shortcuts: ? = start/next hint, . = expand/collapse clue
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === '?') {
      e.preventDefault();
      if (!hintActive) { startHints(); }
      else { nextHint(); }
    } else if (e.key === '.' && hintActive) {
      e.preventDefault();
      hintToast.classList.contains('we-expanded') ? collapseHint() : expandHint();
    }
  });

  // ─── Init ───────────────────────────────────────────────────────────
  processWordList();

})();
