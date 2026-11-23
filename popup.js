const DEFAULTS = { enabled: true, countdown: 3, minDuration: 30, skipWatched: true };
chrome.storage.sync.get(DEFAULTS, (cfg) => {
  for (const [k, v] of Object.entries(cfg)) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
    el.addEventListener('change', () => {
      const val = el.type === 'checkbox' ? el.checked : Math.max(0, Number(el.value) || 0);
      chrome.storage.sync.set({ [k]: val });
    });
  }
});
