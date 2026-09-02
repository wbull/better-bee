// Manual clock for the userscript's setTimeout / clearTimeout / requestAnimationFrame.
// The script resolves those identifiers from the jsdom window's global scope at call
// time, so installing replacements on the window BEFORE the script is evaluated makes
// every timer in the file controllable from a test.
export function makeFakeTimers() {
  let now = 0;
  let seq = 0;
  const timers = [];

  const setTimeout = (fn, ms = 0, ...args) => {
    const id = ++seq;
    timers.push({ id, at: now + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  const clearTimeout = id => {
    const i = timers.findIndex(t => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  const setInterval = (fn, ms = 0, ...args) => {
    const period = Math.max(1, Number(ms) || 0);
    const id = ++seq;
    const tick = () => { fn(...args); if (timers.some(t => t.id === id) || cleared.has(id)) return; timers.push({ id, at: now + period, fn: tick, args: [] }); };
    timers.push({ id, at: now + period, fn: tick, args: [] });
    return id;
  };
  const cleared = new Set();
  const clearInterval = id => { cleared.add(id); clearTimeout(id); };
  // Run every timer due at or before now+ms, in due order. Callbacks may schedule
  // more timers; those run too if they fall inside the window (nested chains).
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn(...t.args);
    }
    now = end;
  };

  return {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    advance,
    now: () => now,
    pending: () => timers.length,
    install(win) {
      win.setTimeout = setTimeout;
      win.clearTimeout = clearTimeout;
      win.setInterval = setInterval;
      win.clearInterval = clearInterval;
      win.requestAnimationFrame = fn => setTimeout(() => fn(now), 16);
      win.cancelAnimationFrame = clearTimeout;
      return this;
    },
  };
}
