// version-core.js — Fantrove Verse

(function () {
  'use strict';

  var CFG = {
    VERSION_URL:   '/assets/json/version.json',
    WHATS_NEW_URL: '/assets/json/whats-new.json',
    WHATS_NEW_PAGE:'/info/whats_new/',
    KEY_BUILD:     'fv_build',
    KEY_DISMISSED: 'fv_dismissed_',
    KEY_DISABLE:   'fv_noupdate',
    SS_SHOWN:      'fv_shown_',       // sessionStorage key per build
    SS_LAST_ACTIVE:'fv_last_active',
    IDLE_MS:       90 * 60 * 1000,   // 90 นาที
    POPUP_ID:      'fv-update-popup',
    TOGGLE_ID:     'auto-update-toggle-btn',
    SWITCH_ID:     'auto-update-switch'
  };

  // ── Storage ──────────────────────────────────────────────────────────────

  function ls(k)       { try { return localStorage.getItem(k);   } catch(e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v);       } catch(e) {} }
  function ss(k)       { try { return sessionStorage.getItem(k); } catch(e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v);     } catch(e) {} }

  function isDisabled()    { return ls(CFG.KEY_DISABLE) === '1'; }
  function setDisabled(v)  { lsSet(CFG.KEY_DISABLE, v ? '1' : '0'); }
  function isDismissed(b)  { return ls(CFG.KEY_DISMISSED + b) === '1'; }
  function setDismissed(b) { lsSet(CFG.KEY_DISMISSED + b, '1'); }

  // ── Session logic ────────────────────────────────────────────────────────
  // fresh = ยังไม่เคยแสดง build นี้ใน session หรือ idle เกิน 90 นาที
  // build ID ต่างกัน → session ของ build ใหม่นั้นจะ fresh เสมอ (SS key ต่างกัน)

  function isSessionFresh(buildId) {
    if (ss(CFG.SS_SHOWN + buildId) !== '1') return true;
    var last = parseInt(ss(CFG.SS_LAST_ACTIVE) || '0', 10);
    return !last || (Date.now() - last) >= CFG.IDLE_MS;
  }

  function markSession(buildId) {
    ssSet(CFG.SS_SHOWN + buildId, '1');
    ssSet(CFG.SS_LAST_ACTIVE, String(Date.now()));
  }

  function updateLastActive() {
    ssSet(CFG.SS_LAST_ACTIVE, String(Date.now()));
  }

  // ── Fetch ────────────────────────────────────────────────────────────────
  // ทั้งสองไฟล์ใช้ no-store เพื่อให้ได้ข้อมูลสดเสมอ

  function fetchVersion() {
    return fetch(CFG.VERSION_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  function fetchWhatsNew() {
    return fetch(CFG.WHATS_NEW_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  // ── Popup ────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function t(obj) {
    if (!obj) return '';
    var lang = localStorage.getItem('selectedLang') || 'en';
    return esc(obj[lang] || obj['en'] || '');
  }

  function buildPopup(versionData, wn) {
    var isTh  = (localStorage.getItem('selectedLang') || 'en') === 'th';
    // ✅ ใช้ version จาก versionData (ที่เพิ่ง fetch มาสด) เสมอ
    var ver   = esc(versionData.version || '');
    var title = wn ? t(wn.title) : '';
    var sub   = wn ? t(wn.subtitle) : '';

    var items = [];
    if (wn) {
      (wn.sections || []).forEach(function(s) {
        (s.items || []).slice(0, 4).forEach(function(item) {
          var txt = t(item.title);
          if (txt) items.push(txt);
        });
      });
    }

    var L = {
      badge:   isTh ? 'อัพเดทใหม่'                        : 'New update',
      ver:     isTh ? 'เวอร์ชัน '                          : 'Version ',
      more:    isTh ? 'ดูรายละเอียด'                       : "See what's new",
      dismiss: isTh ? 'ไม่แสดงอีกสำหรับการอัพเดทนี้'      : "Don't show again for this update"
    };

    var itemsHTML = '';
    if (items.length) {
      itemsHTML = '<ul style="list-style:none;margin:0 0 16px;padding:0">';
      items.forEach(function(item) {
        itemsHTML += '<li style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:.85em;color:var(--fv-t2,#555);line-height:1.5">'
          + '<span style="flex-shrink:0;margin-top:5px;width:6px;height:6px;border-radius:50%;background:#13b47f;display:inline-block"></span>'
          + item + '</li>';
      });
      itemsHTML += '</ul>';
    }

    return '<div id="fv-bd" style="position:fixed;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);z-index:99998;animation:fv-fi .18s ease"></div>'
      + '<div id="fv-card" role="dialog" aria-modal="true" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;background:var(--fv-bg,#fff);border-radius:18px;padding:26px 24px 20px;width:min(360px,calc(100vw - 32px));box-shadow:0 8px 48px rgba(0,0,0,.22);font-family:inherit;animation:fv-si .22s cubic-bezier(.22,1,.36,1)">'
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'
          + '<div style="width:40px;height:40px;border-radius:12px;flex-shrink:0;background:linear-gradient(135deg,#13b47f,#0d8f65);display:flex;align-items:center;justify-content:center">'
            + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
          + '</div>'
          + '<div>'
            + '<div style="font-size:.95em;font-weight:600;color:var(--fv-t1,#111)">' + L.badge + '</div>'
            + '<div style="font-size:.78em;color:#13b47f;font-weight:500;margin-top:1px">'
              + L.ver + ver + (title ? ' \u2014 ' + title : '')
            + '</div>'
          + '</div>'
        + '</div>'
        + (sub ? '<p style="font-size:.85em;color:var(--fv-t2,#666);margin:0 0 14px;line-height:1.55">' + sub + '</p>' : '')
        + itemsHTML
        + '<a id="fv-more" href="' + CFG.WHATS_NEW_PAGE + '" style="display:block;width:100%;padding:11px 0;background:linear-gradient(135deg,#13b47f,#0d8f65);color:#fff;border-radius:11px;font-size:.95em;font-weight:600;text-align:center;text-decoration:none;box-sizing:border-box;box-shadow:0 2px 12px rgba(19,180,127,.35);margin-bottom:10px">' + L.more + '</a>'
        + '<div style="text-align:center"><button id="fv-dismiss" style="border:none;background:none;cursor:pointer;font-size:.78em;color:var(--fv-t3,#aaa);font-family:inherit;padding:4px 8px;border-radius:5px">' + L.dismiss + '</button></div>'
      + '</div>'
      + '<style>@keyframes fv-fi{from{opacity:0}to{opacity:1}}@keyframes fv-si{from{opacity:0;transform:translate(-50%,-44%)}to{opacity:1;transform:translate(-50%,-50%)}}@media(prefers-color-scheme:dark){#fv-card{--fv-bg:#1c1c1e;--fv-t1:#f5f5f7;--fv-t2:#aeaeb2;--fv-t3:#636366}}</style>';
  }

  function showPopup(versionData, whatsNewData, buildId) {
    // ✅ ถ้ามี popup เก่าอยู่ (build เก่า) → เอาออกก่อนแสดงอันใหม่
    var existing = document.getElementById(CFG.POPUP_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    markSession(buildId);

    var wrap = document.createElement('div');
    wrap.id  = CFG.POPUP_ID;
    wrap.innerHTML = buildPopup(versionData, whatsNewData);
    document.body.appendChild(wrap);

    function dismiss(permanent) {
      if (permanent) setDismissed(buildId);
      wrap.parentNode && wrap.parentNode.removeChild(wrap);
    }

    document.getElementById('fv-dismiss').onclick = function() { dismiss(true); };
    document.getElementById('fv-bd').onclick       = function() { dismiss(false); };
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { dismiss(false); document.removeEventListener('keydown', onKey); }
    });
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  function setupToggle() {
    var btn = document.getElementById(CFG.TOGGLE_ID);
    var sw  = document.getElementById(CFG.SWITCH_ID);
    if (!btn || !sw) return;
    sw.checked = !isDisabled();
    function apply() { setDisabled(!sw.checked); }
    sw.addEventListener('change', apply);
    btn.addEventListener('click', function(e) {
      if (e.target !== sw) { sw.checked = !sw.checked; apply(); }
    });
  }

  function trySetupToggle() {
    if (document.getElementById(CFG.TOGGLE_ID)) setupToggle();
    else setTimeout(trySetupToggle, 50);
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    updateLastActive();
    if (isDisabled()) return;

    // ✅ fetch version.json สดทุกครั้ง ไม่อ่านจาก localStorage ก่อน
    fetchVersion().then(function(versionData) {
      if (!versionData) return;

      var newBuild = versionData.build || versionData.version;

      // บันทึก build ใหม่ลง localStorage
      var knownBuild = ls(CFG.KEY_BUILD);
      lsSet(CFG.KEY_BUILD, newBuild);

      // silent deploy → ข้าม
      if (versionData.notify === false) return;

      // dismiss ถาวรสำหรับ build นี้ → ข้าม
      if (isDismissed(newBuild)) return;

      // ✅ build ใหม่กว่าที่รู้จัก → session ของ build นี้จะ fresh เสมอ
      // (SS key ต่างกัน → isSessionFresh คืน true อัตโนมัติ)
      // ✅ build เดิม + session ยังไม่ fresh → ข้าม
      if (!isSessionFresh(newBuild)) return;

      // ✅ fetch whats-new.json สดทุกครั้ง เพื่อให้ได้เนื้อหาของ version ใหม่เสมอ
      fetchWhatsNew().then(function(whatsNewData) {
        showPopup(versionData, whatsNewData, newBuild);
      });
    });
  }

  // ── Kickoff ───────────────────────────────────────────────────────────────

  trySetupToggle();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();