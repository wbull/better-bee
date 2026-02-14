// ==UserScript==
// @name         Better Bee
// @namespace    https://wilsonbull.local/spelling-bee
// @version      1.1
// @description  NYT Spelling Bee enhancements: dock hiding, emoji feedback, hint system, Word Explorer
// @match        https://www.nytimes.com/puzzles/spelling-bee*
// @match        https://www.nytimes.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/wbull/better-bee/main/better_bee.user.js
// @downloadURL  https://raw.githubusercontent.com/wbull/better-bee/main/better_bee.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      api.dictionaryapi.dev
// @connect      en.wikipedia.org
// ==/UserScript==

(function () {
  'use strict';

  // ─── Shared: Constants & State ──────────────────────────────────────
  const EMOJIS = { success: '\u2705', duplicate: '\uD83D\uDD95', error: '\u274C' };
  const apiCache = new Map();
  let requestCounter = 0;

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
    .we-word:hover, .we-word:focus {
      color: #f8cd05;
      outline: 2px solid #f8cd05;
      outline-offset: 2px;
      border-radius: 2px;
    }

    /* Overlay backdrop */
    .we-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .we-overlay.we-visible { opacity: 1; }

    /* Overlay panel */
    .we-panel {
      background: #fff;
      color: #222;
      border-radius: 12px;
      padding: 32px;
      max-width: 560px;
      width: 90vw;
      max-height: 85vh;
      overflow-y: auto;
      position: relative;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      transform: scale(0.95);
      transition: transform 0.2s ease;
    }
    .we-overlay.we-visible .we-panel { transform: scale(1); }

    .we-panel-close {
      position: absolute;
      top: 12px;
      right: 16px;
      font-size: 28px;
      background: none;
      border: none;
      cursor: pointer;
      color: #666;
      line-height: 1;
      padding: 4px 8px;
    }
    .we-panel-close:hover { color: #000; }
    .we-panel-close:focus { outline: 2px solid #f8cd05; outline-offset: 2px; }

    .we-panel-word {
      font-size: 32px;
      font-weight: 700;
      margin: 0 0 8px;
      text-transform: capitalize;
    }

    .we-panel-phonetic {
      font-size: 18px;
      color: #666;
      margin-bottom: 16px;
    }

    .we-panel-audio {
      background: none;
      border: 2px solid #f8cd05;
      border-radius: 20px;
      padding: 6px 16px;
      cursor: pointer;
      font-size: 16px;
      margin-bottom: 16px;
      transition: background 0.15s;
    }
    .we-panel-audio:hover { background: #f8cd05; }
    .we-panel-audio:focus { outline: 2px solid #f8cd05; outline-offset: 2px; }

    .we-panel-pos {
      font-style: italic;
      font-weight: 600;
      color: #555;
      margin: 12px 0 4px;
      font-size: 18px;
    }

    .we-panel-def {
      font-size: 18px;
      line-height: 1.5;
      margin: 4px 0 4px 16px;
      color: #333;
    }

    .we-panel-img {
      margin-top: 20px;
      text-align: center;
    }
    .we-panel-img img {
      max-width: 100%;
      max-height: 300px;
      border-radius: 8px;
    }
    .we-panel-img-caption {
      font-size: 14px;
      color: #888;
      margin-top: 6px;
    }

    .we-panel-nodef {
      font-size: 18px;
      color: #888;
      margin: 16px 0;
    }

    .we-panel-loading {
      text-align: center;
      padding: 40px;
      font-size: 20px;
      color: #888;
    }

    /* Hint toast */
    .we-hint-toast {
      position: fixed; bottom: 20px; left: 20px; z-index: 10001;
      background: #fff; border-radius: 12px; padding: 16px 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25); font-family: monospace;
      display: flex; align-items: center; gap: 12px;
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
    .we-hint-toast-text { font-size: 28px; font-weight: 700; letter-spacing: 2px; }
    .we-hint-toast-check {
      font-size: 32px; line-height: 1;
      opacity: 0; transform: scale(0);
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .we-hint-toast-check.we-visible { opacity: 1; transform: scale(1); }
    /* Bee pulse when hinting */
    #bee-buddy.we-hinting { animation: bee-pulse 1.5s ease-in-out infinite; }
    @keyframes bee-pulse {
      0%, 100% { filter: drop-shadow(0 0 0 transparent); }
      50% { filter: drop-shadow(0 0 8px #f8cd05); }
    }

    /* Word list toggle button */
    #we-wordlist-toggle {
      position: fixed;
      bottom: 10px;
      right: 50px;
      cursor: pointer;
      font-size: 22px;
      z-index: 9999;
      user-select: none;
      line-height: 1;
    }

    /* Word list collapsed state */
    body.we-wordlist-hidden .sb-wordlist-box,
    body.we-wordlist-hidden .sb-wordlist-pag,
    body.we-wordlist-hidden .sb-wordlist-drawer,
    body.we-wordlist-hidden .sb-recent-words {
      display: none !important;
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
    }
  }

  hideDock();
  const dockObserver = new MutationObserver(hideDock);
  dockObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ─── Guard: Only run modules 2–4 on Spelling Bee page ──────────────
  if (!location.pathname.includes('/puzzles/spelling-bee')) return;

  // ─── Module 2: Visual Feedback Emojis ──────────────────────────────
  const emojiEl = document.createElement('div');
  Object.assign(emojiEl.style, {
    position: 'fixed',
    top: '50%',
    right: '5%',
    transform: 'translateY(-50%) scale(0)',
    fontSize: '25vw',
    lineHeight: '1',
    pointerEvents: 'none',
    zIndex: '9999',
    opacity: '0',
    transition: 'none',
  });
  document.body.appendChild(emojiEl);

  let emojiTimer = null;

  function showEmoji(emoji) {
    clearTimeout(emojiTimer);
    emojiEl.style.transition = 'none';
    emojiEl.style.opacity = '0';
    emojiEl.style.transform = 'translateY(-50%) scale(0)';
    emojiEl.textContent = emoji;
    emojiEl.offsetHeight; // reflow

    emojiEl.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out';
    emojiEl.style.opacity = '1';
    emojiEl.style.transform = 'translateY(-50%) scale(1)';

    emojiTimer = setTimeout(() => {
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

  // ─── Module 3: Bee Buddy Button ─────────────────────────────────────
  // Hide NYT game header
  document
    .querySelectorAll('.pz-header.pz-hide-loading.pz-game-header')
    .forEach(e => (e.style.display = 'none'));

  if (!document.getElementById('bee-buddy')) {
    const bee = document.createElement('div');
    bee.id = 'bee-buddy';
    bee.textContent = '\uD83D\uDC1D';
    bee.setAttribute('role', 'button');
    bee.setAttribute('aria-label', 'Toggle spelling bee hints');
    bee.tabIndex = 0;

    bee.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      cursor: pointer;
      font-size: 30px;
      z-index: 9999;
      user-select: none;
    `;

    function toggleHints() {
      hintActive ? stopHints() : startHints();
    }
    bee.addEventListener('click', toggleHints);
    bee.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHints(); }
    });

    document.body.appendChild(bee);
  }

  // Word list expand/collapse toggle
  if (!document.getElementById('we-wordlist-toggle')) {
    const toggle = document.createElement('div');
    toggle.id = 'we-wordlist-toggle';
    toggle.textContent = '\uD83D\uDCCB';
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('aria-label', 'Toggle word list');
    toggle.tabIndex = 0;

    function toggleWordList() {
      document.body.classList.toggle('we-wordlist-hidden');
      toggle.setAttribute('aria-expanded',
        !document.body.classList.contains('we-wordlist-hidden'));
    }
    toggle.addEventListener('click', toggleWordList);
    toggle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWordList(); }
    });

    document.body.appendChild(toggle);
  }

  // ─── Module 4: Word Explorer ────────────────────────────────────────

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'we-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Word Explorer');
  overlay.innerHTML = '<div class="we-panel"><button class="we-panel-close" aria-label="Close">&times;</button><div class="we-panel-body"></div></div>';
  document.body.appendChild(overlay);

  const panelBody = overlay.querySelector('.we-panel-body');
  const closeBtn = overlay.querySelector('.we-panel-close');
  let lastFocused = null;

  function openOverlay() {
    lastFocused = document.activeElement;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Trigger transition, then move focus
    requestAnimationFrame(() => {
      overlay.classList.add('we-visible');
      closeBtn.focus();
    });
  }

  function closeOverlay() {
    overlay.classList.remove('we-visible');
    document.body.style.overflow = '';
    setTimeout(() => { overlay.style.display = 'none'; }, 200);
    if (lastFocused) lastFocused.focus();
  }

  overlay.style.display = 'none';
  closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Close our Word Explorer overlay first
    if (overlay.style.display !== 'none') {
      e.preventDefault();
      closeOverlay();
      return;
    }
    // Close NYT native modals (e.g. "Keep playing" screen)
    const nytClose = document.querySelector('.pz-icon-close, .sb-modal-close, .pz-moment__close');
    if (nytClose) {
      e.preventDefault();
      nytClose.click();
    }
  });

  // Focus trap
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusables = overlay.querySelectorAll(
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

  // API helpers
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: res => {
          if (res.status >= 200 && res.status < 300) {
            try { resolve(JSON.parse(res.responseText)); }
            catch { reject(new Error('Invalid JSON')); }
          } else {
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror: () => reject(new Error('Network error')),
      });
    });
  }

  function fetchDictionary(word) {
    return gmFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  }

  function fetchWikipedia(word) {
    return gmFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`);
  }

  function buildPanelContent(word, dictResult, wikiResult) {
    let html = '';

    // Word heading
    html += `<h2 class="we-panel-word">${escapeHTML(word)}</h2>`;

    // Dictionary content
    if (dictResult.status === 'fulfilled' && Array.isArray(dictResult.value)) {
      const entry = dictResult.value[0];

      // Phonetic
      const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '';
      if (phonetic) {
        html += `<div class="we-panel-phonetic">${escapeHTML(phonetic)}</div>`;
      }

      // Audio button
      const audioUrl = entry.phonetics
        ?.map(p => p.audio)
        .filter(a => a && a.length > 0)[0];
      if (audioUrl) {
        html += `<button class="we-panel-audio" data-audio="${escapeHTML(audioUrl)}">&#128264; Play pronunciation</button>`;
      }

      // Meanings
      if (entry.meanings) {
        for (const meaning of entry.meanings) {
          html += `<div class="we-panel-pos">${escapeHTML(meaning.partOfSpeech)}</div>`;
          for (const def of meaning.definitions.slice(0, 3)) {
            html += `<div class="we-panel-def">&bull; ${escapeHTML(def.definition)}</div>`;
          }
        }
      }
    } else {
      html += `<div class="we-panel-nodef">No definition found for &ldquo;${escapeHTML(word)}&rdquo;</div>`;
    }

    // Wikipedia image
    if (wikiResult.status === 'fulfilled') {
      const wiki = wikiResult.value;
      // Skip disambiguation pages
      if (wiki.type !== 'disambiguation' && wiki.thumbnail?.source) {
        html += `<div class="we-panel-img">`;
        html += `<img src="${escapeHTML(wiki.thumbnail.source)}" alt="${escapeHTML(wiki.title || word)}">`;
        if (wiki.description) {
          html += `<div class="we-panel-img-caption">${escapeHTML(wiki.description)}</div>`;
        }
        html += `</div>`;
      }
    }

    return html;
  }

  function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function showWordExplorer(word) {
    const myRequest = ++requestCounter;
    panelBody.innerHTML = '<div class="we-panel-loading">Loading&hellip;</div>';
    openOverlay();

    const cacheKey = word.toLowerCase();
    let dictResult, wikiResult;

    if (apiCache.has(cacheKey)) {
      ({ dictResult, wikiResult } = apiCache.get(cacheKey));
    } else {
      const [d, w] = await Promise.allSettled([
        fetchDictionary(word),
        fetchWikipedia(word),
      ]);
      dictResult = d;
      wikiResult = w;
      apiCache.set(cacheKey, { dictResult, wikiResult });
    }

    // Discard stale responses
    if (myRequest !== requestCounter) return;

    panelBody.innerHTML = buildPanelContent(word, dictResult, wikiResult);

    // Wire up audio button
    const audioBtn = panelBody.querySelector('.we-panel-audio');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        const audio = new Audio(audioBtn.dataset.audio);
        audio.play().catch(() => {});
      });
    }
  }

  // Word list processor
  function processWordList() {
    const selectors = [
      '.sb-wordlist-items-pag li',
      '.sb-wordlist-window li',
      '.sb-recent-words li',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(li => {
        if (li.dataset.weProcessed) return;
        li.dataset.weProcessed = '1';

        // Find the text node or inner element with the word
        const wordText = li.textContent.trim().toLowerCase();
        if (!wordText || wordText.length < 4) return; // SB words are 4+ letters

        li.classList.add('we-word');
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', `Look up ${wordText}`);
        li.tabIndex = 0;

        li.addEventListener('click', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          showWordExplorer(wordText);
        }, true);
        li.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            showWordExplorer(wordText);
          }
        });
      });
    }
  }

  // ─── Shared MutationObserver (emoji feedback + word list) ───────────
  const mainObserver = new MutationObserver(mutations => {
    let shouldProcessWords = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Emoji feedback: detect .sb-message
        const targets = [];
        if (node.classList?.contains('sb-message')) targets.push(node);
        if (node.querySelectorAll) targets.push(...node.querySelectorAll('.sb-message'));

        for (const target of targets) {
          setTimeout(() => {
            const text = target.textContent?.trim();
            const type = classifyMessage(text);
            if (type) showEmoji(EMOJIS[type]);
            if (type === 'success' && hintActive) {
              const foundWord = getLastFoundWord();
              if (currentHintMatches(foundWord)) {
                // Found the hinted word — show green check, animate out, advance
                hintToastCheck.classList.add('we-visible');
                setTimeout(() => {
                  hintToast.classList.add('we-got-it');
                  setTimeout(() => {
                    hideHintToast();
                    nextHint();
                  }, 600);
                }, 400);
              }
              // Otherwise: found a different word, leave hint as-is
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
  let hintActive = false;
  let hintQueue = [];
  let hintIndex = 0;

  // Create hint toast element
  const hintToast = document.createElement('div');
  hintToast.className = 'we-hint-toast';
  hintToast.innerHTML = '<span class="we-hint-toast-text"></span><span class="we-hint-toast-check">\u2705</span>';
  document.body.appendChild(hintToast);

  const hintToastText = hintToast.querySelector('.we-hint-toast-text');
  const hintToastCheck = hintToast.querySelector('.we-hint-toast-check');

  function getAnswers() {
    try {
      return unsafeWindow.gameData.today.answers;
    } catch {
      return null;
    }
  }

  function getFoundWords() {
    const found = new Set();
    const selectors = [
      '.sb-wordlist-items-pag li',
      '.sb-wordlist-window li',
      '.sb-recent-words li',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(li => {
        const word = li.textContent.trim().toLowerCase();
        if (word) found.add(word);
      });
    }
    return found;
  }

  function currentHintMatches(word) {
    if (!word || hintIndex === 0 || hintIndex > hintQueue.length) return false;
    const hint = hintQueue[hintIndex - 1]; // e.g. "BA.. 5"
    const prefix = hint.slice(0, 2);
    const len = parseInt(hint.split(' ').pop(), 10);
    const upper = word.toUpperCase();
    return upper.length === len && upper.startsWith(prefix);
  }

  function getLastFoundWord() {
    // Try the input area first (may still contain the accepted word)
    const input = document.querySelector('.sb-hive-input-content');
    const inputText = input?.textContent?.trim();
    if (inputText && /^[a-zA-Z]{4,}$/.test(inputText)) return inputText;
    // Fall back to most recent word in the word list
    const items = document.querySelectorAll(
      '.sb-wordlist-items-pag li, .sb-wordlist-window li, .sb-recent-words li'
    );
    if (items.length > 0) return items[items.length - 1].textContent.trim();
    return '';
  }

  function buildHintQueue() {
    const answers = getAnswers();
    if (!answers) return null;
    const found = getFoundWords();
    const remaining = answers.filter(w => !found.has(w.toLowerCase()));
    if (remaining.length === 0) return [];

    // Build hints: first 2 letters + ".." + space + length
    const hints = remaining.map(w => {
      const upper = w.toUpperCase();
      return upper.slice(0, 2) + '.. ' + w.length;
    });

    // Shuffle (Fisher-Yates)
    for (let i = hints.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [hints[i], hints[j]] = [hints[j], hints[i]];
    }
    return hints;
  }

  function showHintToast(text) {
    hintToastText.textContent = text;
    hintToastCheck.classList.remove('we-visible');
    hintToast.classList.remove('we-got-it', 'we-visible');
    hintToast.offsetHeight; // reflow
    hintToast.classList.add('we-visible');
  }

  function hideHintToast() {
    hintToast.classList.remove('we-visible', 'we-got-it');
    hintToastCheck.classList.remove('we-visible');
  }

  function nextHint() {
    if (!hintActive) return;

    // If queue exhausted, rebuild
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

    showHintToast(hintQueue[hintIndex]);
    hintIndex++;
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
    if (bee) bee.classList.add('we-hinting');
    nextHint();
  }

  function stopHints() {
    hintActive = false;
    hideHintToast();
    const bee = document.getElementById('bee-buddy');
    if (bee) bee.classList.remove('we-hinting');
  }

  // Keyboard shortcut: ? to toggle hints
  document.addEventListener('keydown', e => {
    if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      hintActive ? stopHints() : startHints();
    }
  });

  // ─── Init ───────────────────────────────────────────────────────────
  processWordList();

})();
