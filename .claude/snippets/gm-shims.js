// Minimal greasemonkey shims so better_bee.user.js can run when injected into a
// normal page during verification. Define BEFORE injecting the userscript IIFE.
// When a new @grant is added to the header, add a matching shim here.
window.unsafeWindow = window;
window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); return s; };
window.GM_getValue = (k, d) => { const v = localStorage.getItem('GM_' + k); return v === null ? d : JSON.parse(v); };
window.GM_setValue = (k, v) => localStorage.setItem('GM_' + k, JSON.stringify(v));
window.GM_registerMenuCommand = (label) => { (window.__gmMenu = window.__gmMenu || []).push(label); };
window.GM_xmlhttpRequest = (o) => {
  fetch(o.url, { method: o.method || 'GET', headers: o.headers })
    .then(async (r) => o.onload && o.onload({ status: r.status, responseText: await r.text() }))
    .catch((e) => o.onerror && o.onerror(e));
};
