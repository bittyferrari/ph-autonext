(() => {
  'use strict';
  const DEFAULTS = { enabled: true, countdown: 3, minDuration: 30, skipWatched: true };
  const HISTORY_KEY = 'phAutoNextHistory';
  const HISTORY_MAX = 50;
  let cfg = { ...DEFAULTS };

  chrome.storage.sync.get(DEFAULTS, (v) => { cfg = v; });
  chrome.storage.onChanged.addListener((ch) => {
    for (const k in ch) cfg[k] = ch[k].newValue;
  });

  const viewkeyOf = (url) => {
    try { return new URL(url, location.href).searchParams.get('viewkey'); } catch { return null; }
  };
  const currentKey = viewkeyOf(location.href);

  // 記錄這個分頁看過的影片，避免互跳迴圈
  const loadHistory = () => {
    try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  };
  const history = loadHistory();
  if (currentKey && !history.includes(currentKey)) {
    history.push(currentKey);
    while (history.length > HISTORY_MAX) history.shift();
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  }

  function findNext() {
    const containers = ['#relatedVideosCenter', '#relatedVideos', '.relatedVideos',
      '#recommendedVideos', '.recommendedVideosContainer', '.videos-list'];
    const sel = 'a[href*="view_video.php?viewkey="]';
    let links = [];
    for (const c of containers) {
      document.querySelectorAll(`${c} ${sel}`).forEach((a) => links.push(a));
      if (links.length) break;
    }
    if (!links.length) links = [...document.querySelectorAll(sel)];
    for (const a of links) {
      const key = viewkeyOf(a.href);
      if (!key || key === currentKey) continue;
      if (cfg.skipWatched && history.includes(key)) continue;
      if (!a.offsetParent) continue; // 隱藏元素
      return a.href;
    }
    return null;
  }

  let timer = null;
  function showCountdown(url) {
    if (timer) return;
    let left = Math.max(0, Number(cfg.countdown) || 0);
    if (left === 0) { location.href = url; return; }

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:rgba(0,0,0,.88);' +
      'color:#fff;padding:12px 16px;border-radius:8px;font:14px sans-serif;display:flex;gap:10px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    const text = document.createElement('span');
    const mkBtn = (label, bg, fg) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `background:${bg};color:${fg};border:0;border-radius:4px;padding:5px 10px;cursor:pointer;font:13px sans-serif`;
      return b;
    };
    const go = mkBtn('立即播放', '#ff9000', '#000');
    const cancel = mkBtn('取消', '#444', '#fff');
    box.append(text, go, cancel);
    document.body.appendChild(box);

    const render = () => (text.textContent = `${left} 秒後播放下一部`);
    const stop = () => { clearInterval(timer); timer = null; box.remove(); };
    render();
    cancel.onclick = stop;
    go.onclick = () => { stop(); location.href = url; };
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) { stop(); location.href = url; } else render();
    }, 1000);
  }

  // ended 不會冒泡，用 capture 抓頁面上任何 <video>
  document.addEventListener('ended', (e) => {
    if (!cfg.enabled) return;
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (new URL(location.href).searchParams.has('pkey')) return; // 播放清單交給網站
    if (v.duration && v.duration < cfg.minDuration) return;      // 略過前置廣告
    const next = findNext();
    if (next) showCountdown(next);
  }, true);
})();
