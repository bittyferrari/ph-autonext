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

  // ---- 跳轉 + 新頁面自動播放 ----
  const PENDING_KEY = 'phAutoNextPending';
  function navigate(url) {
    try { sessionStorage.setItem(PENDING_KEY, viewkeyOf(url) || ''); } catch {}
    location.href = url;
  }

  function showHint(msg, ms = 6000) {
    const box = document.createElement('div');
    box.textContent = msg;
    box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:rgba(0,0,0,.88);' +
      'color:#fff;padding:10px 14px;border-radius:8px;font:13px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    document.body.appendChild(box);
    setTimeout(() => box.remove(), ms);
    return box;
  }

  const log = (...a) => console.log('[PHAutoNext]', ...a);

  // 只有「由本外掛跳過來」的頁面才主動播放，一般開網頁不受影響
  function autoplayIfPending() {
    let pending = null;
    try { pending = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch {}
    if (!pending || pending !== currentKey || !cfg.enabled) return;

    const PLAYER_SEL = ['.playerFlvContainer', '#player', '.mgp_container'];
    const PLAY_BTNS = ['.mgp_bigPlay', '.mgp_playIcon', '.mgp_play', '[class*="bigPlay"]',
      'button[aria-label*="play" i]'];
    const startAt = Date.now();
    let done = false, ticks = 0, mutedVideo = null, hint = null, clickedBtn = false;
    let kicks = 0, lastKick = 0, lastT = -1, lastV = null, mainSince = 0;

    const isMain = (v) => v.duration && v.duration >= (Number(cfg.minDuration) || 0);
    const hasSrc = (v) => !!(v.currentSrc || v.src || v.querySelector('source[src]'));
    const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
    // 只挑有影片來源的 <video>，最大的那個優先（頁面上常有好幾個廣告空殼）
    const pickVideo = () => [...document.querySelectorAll('video')].filter(hasSrc)
      .sort((a, b) => area(b) - area(a))[0] || null;
    const playerBox = () => {
      for (const s of PLAYER_SEL) { const el = document.querySelector(s); if (el && el.offsetParent) return el; }
      return null;
    };
    const finish = () => { if (!done) log('finish, kicks=' + kicks); done = true; clearInterval(iv); };

    // 使用者一有操作就停手（不跟使用者搶暫停），並解除我們加的靜音
    const onUser = (e) => {
      if (e && !e.isTrusted) return; // 忽略我們自己模擬的點擊
      if (mutedVideo) mutedVideo.muted = false;
      if (hint) hint.remove();
      finish();
      window.removeEventListener('pointerdown', onUser, true);
      window.removeEventListener('keydown', onUser, true);
    };
    window.addEventListener('pointerdown', onUser, true);
    window.addEventListener('keydown', onUser, true);

    const tryPlay = (v) => {
      const p = v.play();
      if (p && p.catch) p.catch((err) => {
        // 瀏覽器擋有聲自動播放 → 改成靜音播放（一定允許）
        if (err && err.name === 'NotAllowedError' && !v.muted && !done) {
          v.muted = true;
          mutedVideo = v;
          v.play().then(() => {
            if (!hint) hint = showHint('已靜音自動播放，點一下頁面任何地方即可開聲音');
          }).catch(() => {});
        }
      });
    };

    // 模擬使用者在播放器中央點一下（Brave 擋廣告後播放器會卡轉圈圈，點一下就會繼續）
    const kick = () => {
      const box = playerBox() || pickVideo();
      if (!box) return;
      const r = box.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const el = document.elementFromPoint(x, y) || box;
      log('kick #' + kicks, 'on', el.tagName + '.' + String(el.className).slice(0, 80));
      const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
      // 如果那一下把影片按成暫停，就再播回來
      setTimeout(() => { const v = pickVideo(); if (v && v.paused && !v.ended) tryPlay(v); }, 800);
    };

    const tick = () => {
      if (done) return;
      if (++ticks > 120) return finish(); // 最多嘗試 60 秒
      const now = Date.now();
      const v = pickVideo();
      // 「真的在走」= 同一支影片沒暫停、而且時間有往前
      const progressing = !!v && v === lastV && !v.paused && v.currentTime > lastT;
      const box = playerBox();
      log('tick', ticks, 'videos=' + document.querySelectorAll('video').length,
        v ? `paused=${v.paused} t=${v.currentTime.toFixed(1)} dur=${(v.duration || 0).toFixed(0)} ready=${v.readyState} muted=${v.muted}` : 'no playable video',
        'progressing=' + progressing,
        'player=' + (box ? String(box.className).slice(0, 120) : 'none'));
      lastV = v; lastT = v ? v.currentTime : -1;

      if (progressing && isMain(v)) {
        if (!mainSince) mainSince = now;
        if (now - mainSince >= 2000) finish(); // 正片穩定播放 2 秒 → 收工
        return;
      }
      mainSince = 0;
      if (progressing) return; // 廣告正在播，別亂點（會點開廣告）

      if (v) {
        if (v.paused && !v.ended) tryPlay(v);
      } else if (!clickedBtn) {
        // 有些播放器要先點它自己的播放鈕才會載入影片
        for (const s of PLAY_BTNS) {
          const b = document.querySelector(s);
          if (b && b.offsetParent) { b.click(); clickedBtn = true; break; }
        }
      }
      // 跳過來 3 秒後畫面還沒在走 → 模擬點一下，每 2.5 秒最多一次，最多 6 次
      if (now - startAt > 3000 && kicks < 6 && now - lastKick > 2500) {
        kicks++; lastKick = now; kick();
      }
    };
    const iv = setInterval(tick, 500);
    tick();
  }
  autoplayIfPending();

  let timer = null;
  function showCountdown(url) {
    if (timer) return;
    let left = Math.max(0, Number(cfg.countdown) || 0);
    if (left === 0) { navigate(url); return; }

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
    go.onclick = () => { stop(); navigate(url); };
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) { stop(); navigate(url); } else render();
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
