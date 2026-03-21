// version-core.js — Fantrove Verse
// ─────────────────────────────────────────────────────────────────────────────
// ระบบตรวจสอบ version และแจ้งเตือน update แบบ real-time
//
// Features:
//   • Instant detection via visibilitychange, focus, pageshow events
//   • BroadcastChannel — tab หนึ่งเจอ update ทุก tab รู้ทันที
//   • Dual-interval polling: 15s (active) / 60s (hidden)
//   • notify field — admin ควบคุมว่าจะแสดง popup หรือไม่
//   • Changelog popup พร้อม UI ที่สะอาดและ accessible
//   • Toggle button support
//   • ตรวจสอบด้วย build ID (version + date) เพื่อความแม่นยำ
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────────────────

  var CFG = {
    URL:           '/assets/json/version.json',
    T_ACTIVE:      15000,   // interval เมื่อ tab active (ms)
    T_IDLE:        60000,   // interval เมื่อ tab hidden (ms)
    KEY_BUILD:     'fv_build',
    KEY_DISABLE:   'fv_noupdate',
    POPUP_ID:      'fv-update-popup',
    TOGGLE_ID:     'auto-update-toggle-btn',
    SWITCH_ID:     'auto-update-switch',
    BC_NAME:       'fv_version_sync'
  };

  // ── State ──────────────────────────────────────────────────────────────────

  var state = {
    currentBuild:  null,   // build ID ที่ user กำลัง run อยู่ (baseline)
    timer:         null,
    checking:      false,
    channel:       null    // BroadcastChannel instance
  };

  // ── Storage helpers ────────────────────────────────────────────────────────

  function ls(k)    { try { return localStorage.getItem(k);    } catch(e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v);     } catch(e) {} }

  function isDisabled() { return ls(CFG.KEY_DISABLE) === '1'; }
  function setDisabled(v) { lsSet(CFG.KEY_DISABLE, v ? '1' : '0'); }

  // ── Fetch version.json ─────────────────────────────────────────────────────
  // ใช้ cache: 'no-store' เสมอ — Cloudflare จะส่งข้อมูลสดทุกครั้ง (ตาม _headers)

  function fetchVer() {
    return fetch(CFG.URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // ── HTML escape ────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Popup ──────────────────────────────────────────────────────────────────

  function buildPopupHTML(data) {
    var ver       = esc(data.version || '');
    var changelog = Array.isArray(data.changelog) ? data.changelog : [];

    var listHTML = '';
    if (changelog.length) {
      listHTML = '<ul style="'
        + 'list-style:none;margin:0 0 20px;padding:0'
        + '">';
      for (var i = 0; i < changelog.length; i++) {
        listHTML += '<li style="'
          + 'display:flex;align-items:flex-start;gap:9px;'
          + 'padding:5px 0;font-size:.86em;line-height:1.55;'
          + 'color:var(--fv-text2,#555)'
          + '">'
          + '<span style="'
            + 'flex-shrink:0;margin-top:4px;width:7px;height:7px;'
            + 'border-radius:50%;background:#13b47f;display:inline-block'
          + '"></span>'
          + esc(changelog[i])
          + '</li>';
      }
      listHTML += '</ul>';
    }

    return ''
      // ── Overlay backdrop ──
      + '<div id="fv-backdrop" style="'
        + 'position:fixed;inset:0;'
        + 'background:rgba(0,0,0,0.42);'
        + 'backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);'
        + 'z-index:99998;animation:fv-fade-in .18s ease'
      + '"></div>'

      // ── Card ──
      + '<div id="fv-card" role="dialog" aria-modal="true" aria-label="Update available" style="'
        + 'position:fixed;'
        + 'left:50%;top:50%;transform:translate(-50%,-50%);'
        + 'z-index:99999;'
        + 'background:var(--fv-bg,#fff);'
        + 'border-radius:18px;'
        + 'padding:26px 24px 22px;'
        + 'width:min(340px,calc(100vw - 32px));'
        + 'box-shadow:0 8px 48px rgba(0,0,0,.22);'
        + 'font-family:inherit;'
        + 'animation:fv-slide-in .22s cubic-bezier(.22,1,.36,1)'
      + '">'

        // close button
        + '<button id="fv-close" aria-label="Close" style="'
          + 'position:absolute;top:13px;right:14px;'
          + 'border:none;background:none;cursor:pointer;'
          + 'color:var(--fv-text3,#aaa);font-size:22px;'
          + 'line-height:1;padding:4px 6px;border-radius:6px;'
          + 'transition:color .15s,background .15s'
        + '" onmouseover="this.style.background=\'var(--fv-hover,#f0f0f0)\'"'
        + ' onmouseout="this.style.background=\'none\'"'
        + '>&times;</button>'

        // header: icon + title
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'
          + '<div style="'
            + 'width:40px;height:40px;border-radius:12px;flex-shrink:0;'
            + 'background:linear-gradient(135deg,#13b47f,#0d8f65);'
            + 'display:flex;align-items:center;justify-content:center'
          + '">'
            + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"'
            + ' stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
            + '<polyline points="23 4 23 10 17 10"/>'
            + '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'
            + '</svg>'
          + '</div>'
          + '<div>'
            + '<div style="'
              + 'font-size:.97em;font-weight:600;'
              + 'color:var(--fv-text1,#111);line-height:1.3'
            + '">New update available</div>'
            + '<div style="'
              + 'font-size:.78em;color:#13b47f;font-weight:500;margin-top:1px'
            + '">v' + ver + ' is ready</div>'
          + '</div>'
        + '</div>'

        // changelog list (ถ้ามี)
        + listHTML

        // Refresh button
        + '<button id="fv-reload" style="'
          + 'width:100%;padding:12px 0;'
          + 'background:linear-gradient(135deg,#13b47f,#0d8f65);'
          + 'color:#fff;border:none;border-radius:11px;'
          + 'font-size:.95em;font-weight:600;cursor:pointer;'
          + 'font-family:inherit;letter-spacing:.01em;'
          + 'transition:opacity .15s,transform .1s;'
          + 'box-shadow:0 2px 12px rgba(19,180,127,.35)'
        + '"'
        + ' onmouseover="this.style.opacity=\'.88\'"'
        + ' onmouseout="this.style.opacity=\'1\'"'
        + ' onmousedown="this.style.transform=\'scale(.98)\'"'
        + ' onmouseup="this.style.transform=\'scale(1)\'"'
        + '>Refresh now</button>'

        // dismiss link
        + '<div style="text-align:center;margin-top:11px">'
          + '<button id="fv-dismiss" style="'
            + 'border:none;background:none;cursor:pointer;'
            + 'font-size:.8em;color:var(--fv-text3,#aaa);'
            + 'font-family:inherit;padding:4px 8px;border-radius:5px;'
            + 'transition:color .15s'
          + '" onmouseover="this.style.color=\'var(--fv-text2,#777)\'"'
          + ' onmouseout="this.style.color=\'var(--fv-text3,#aaa)\'"'
          + '>Remind me later</button>'
        + '</div>'

      + '</div>'

      // Animations
      + '<style>'
        + '@keyframes fv-fade-in{from{opacity:0}to{opacity:1}}'
        + '@keyframes fv-slide-in{from{opacity:0;transform:translate(-50%,-44%)}to{opacity:1;transform:translate(-50%,-50%)}}'
        // Dark mode vars
        + '@media(prefers-color-scheme:dark){'
          + '#fv-card{--fv-bg:#1c1c1e;--fv-text1:#f5f5f7;--fv-text2:#aeaeb2;--fv-text3:#636366;--fv-hover:#2c2c2e}'
        + '}'
      + '</style>';
  }

  function showPopup(data) {
    // ถ้า popup กำลังแสดงอยู่ → อัปเดต content (กรณีมี deploy ใหม่ซ้อนกัน)
    var existing = document.getElementById(CFG.POPUP_ID);
    if (existing) {
      var badge = existing.querySelector && existing.querySelector('[id="fv-card"] div div + div div');
      if (badge) badge.textContent = 'v' + esc(data.version || '') + ' is ready';
      return;
    }

    var wrap = document.createElement('div');
    wrap.id = CFG.POPUP_ID;
    wrap.innerHTML = buildPopupHTML(data);
    document.body.appendChild(wrap);

    // Wire buttons
    function dismiss() {
      wrap.parentNode && wrap.parentNode.removeChild(wrap);
    }

    document.getElementById('fv-reload').onclick = function () {
      // Hard-reload: เพิ่ม timestamp เพื่อ bypass ทุก HTTP cache layer
      var u = location.pathname + '?reload=' + Date.now() + location.hash;
      location.replace(u);
    };

    var closeBtn    = document.getElementById('fv-close');
    var dismissBtn  = document.getElementById('fv-dismiss');
    var backdrop    = document.getElementById('fv-backdrop');

    if (closeBtn)   closeBtn.onclick   = dismiss;
    if (dismissBtn) dismissBtn.onclick = dismiss;
    if (backdrop)   backdrop.onclick   = dismiss;

    // Keyboard: Escape closes
    function onKey(e) {
      if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);

    // Focus trap: ให้ focus อยู่ที่ปุ่ม refresh
    setTimeout(function () {
      var btn = document.getElementById('fv-reload');
      if (btn) btn.focus();
    }, 50);
  }

  // ── BroadcastChannel — cross-tab instant sync ──────────────────────────────

  function setupChannel() {
    if (!window.BroadcastChannel) return;
    try {
      state.channel = new BroadcastChannel(CFG.BC_NAME);
      state.channel.onmessage = function (e) {
        var msg = e.data;
        if (!msg || msg.type !== 'fv_update') return;
        var d = msg.data;
        if (!d || !d.build || d.build === state.currentBuild) return;

        // Tab อื่นพบ update → update baseline ในตัวเอง
        state.currentBuild = d.build;
        lsSet(CFG.KEY_BUILD, d.build);

        if (d.notify !== false) showPopup(d);
      };
    } catch (e) {}
  }

  function broadcast(data) {
    if (!state.channel) return;
    try {
      state.channel.postMessage({ type: 'fv_update', data: data });
    } catch (e) {}
  }

  // ── Core check ─────────────────────────────────────────────────────────────

  function check() {
    if (state.checking || isDisabled()) return;
    state.checking = true;

    fetchVer().then(function (data) {
      state.checking = false;
      if (!data) return;

      var newBuild = data.build || data.version;

      // ครั้งแรก (init ยังไม่เสร็จ) → เซ็ต baseline เฉยๆ
      if (!state.currentBuild) {
        state.currentBuild = newBuild;
        lsSet(CFG.KEY_BUILD, newBuild);
        return;
      }

      // พบ build ใหม่
      if (newBuild !== state.currentBuild) {
        state.currentBuild = newBuild;
        lsSet(CFG.KEY_BUILD, newBuild);

        if (data.notify !== false) {
          showPopup(data);
          broadcast(data);      // แจ้ง tabs อื่น
        }
        // notify=false → silent update; user จะได้ version ใหม่ตอน reload ครั้งถัดไป
      }
    }).catch(function () {
      state.checking = false;
    });
  }

  // ── Polling (dynamic interval) ─────────────────────────────────────────────
  // ใช้ setTimeout แทน setInterval เพื่อให้ interval เปลี่ยนได้ตาม visibility

  function clearTimer() {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  }

  function scheduleNext() {
    clearTimer();
    if (isDisabled()) return;
    var delay = document.hidden ? CFG.T_IDLE : CFG.T_ACTIVE;
    state.timer = setTimeout(function () {
      check();
      scheduleNext();
    }, delay);
  }

  function startPolling() { clearTimer(); scheduleNext(); }
  function stopPolling()  { clearTimer(); }

  // ── Event listeners — ทำให้ detect ทันที ──────────────────────────────────

  // Tab กลับมา active → ตรวจทันที (สำคัญมาก: ทำให้ user ได้รับแจ้งทันทีที่กลับมา)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !isDisabled()) {
      clearTimer();
      check();
      scheduleNext();
    }
  });

  // Window focus (switch application แล้วกลับมา)
  window.addEventListener('focus', function () {
    if (!isDisabled()) {
      clearTimer();
      check();
      scheduleNext();
    }
  });

  // Back-forward cache restore (user กด Back แล้ว page โหลดจาก bfcache)
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && !isDisabled()) {
      check();
    }
  });

  // ── Toggle button ──────────────────────────────────────────────────────────

  function setupToggle() {
    var btn = document.getElementById(CFG.TOGGLE_ID);
    var sw  = document.getElementById(CFG.SWITCH_ID);
    if (!btn || !sw) return;

    sw.checked = !isDisabled();

    function apply() {
      var enabled = sw.checked;
      setDisabled(!enabled);
      if (enabled) { startPolling(); check(); }
      else { stopPolling(); }
    }

    sw.addEventListener('change', apply);
    btn.addEventListener('click', function (e) {
      if (e.target !== sw) { sw.checked = !sw.checked; apply(); }
    });
  }

  function trySetupToggle() {
    if (document.getElementById(CFG.TOGGLE_ID)) { setupToggle(); }
    else { setTimeout(trySetupToggle, 50); }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    var stored = ls(CFG.KEY_BUILD);

    fetchVer().then(function (data) {
      if (!data) return;

      var newBuild = data.build || data.version;

      // Defense-in-depth: ถ้า HTML เก่าหลุดมาทั้งที่ตั้ง no-cache ไว้
      // stored คือ build ที่ user เพิ่ง reload มาหรือ session ก่อน
      // ถ้า stored !== newBuild และ notify → แสดง popup ทันทีตอน page load
      if (stored && stored !== newBuild && data.notify !== false) {
        showPopup(data);
      }

      state.currentBuild = newBuild;
      lsSet(CFG.KEY_BUILD, newBuild);

      if (!isDisabled()) startPolling();
    });
  }

  // ── Kickoff ────────────────────────────────────────────────────────────────

  setupChannel();
  trySetupToggle();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();