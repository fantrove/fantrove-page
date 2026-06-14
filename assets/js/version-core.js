// version-core.js — Fantrove Verse
// v4: อ่าน current.md (หลัก) หรือ whats-new.json (fallback) โดยตรง
//     ไม่ใช้ localStorage — อ่านจากไฟล์จริงทุกอย่าง
//     ใช้ PopupSystem.container() เป็น shell

(function () {
  'use strict';

  var CFG = {
    CURRENT_MD_URL:  '/assets/md/current.md',
    LEGACY_JSON_URL: '/assets/json/whats-new.json',
    WHATS_NEW_PAGE:  '/info/whats_new/',

    KEY_SHOWN_BUILD: 'fv_shown_build',
    KEY_DISMISSED:   'fv_dismissed_v',
    KEY_DISABLE:     'fv_noupdate',

    SS_SHOWN:       'fv_ss_shown_',
    SS_LAST_ACTIVE: 'fv_last_active',
    IDLE_MS:        90 * 60 * 1000,

    TOGGLE_ID:  'auto-update-toggle-btn',
    SWITCH_ID:  'auto-update-switch',

    POPUP_GROUP: 'update-notification',
  };

  // ── ตรวจว่าอยู่หน้า What's New หรือไม่ ──────────────────────────────────

  function isOnWhatsNewPage() {
    var meta = document.querySelector('meta[name="fv-page"]');
    return meta && meta.getAttribute('content') === 'whats-new';
  }

  // ── Storage (เฉพาะ state เล็กๆ — dismissed, disabled, session) ────────────

  function ls(k)       { try { return localStorage.getItem(k);   } catch(e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v);       } catch(e) {} }
  function ss(k)       { try { return sessionStorage.getItem(k); } catch(e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v);     } catch(e) {} }

  function isDisabled()      { return ls(CFG.KEY_DISABLE) === '1'; }
  function setDisabled(v)    { lsSet(CFG.KEY_DISABLE, v ? '1' : '0'); }
  function isDismissed(ver)  { return ls(CFG.KEY_DISMISSED + ver) === '1'; }
  function setDismissed(ver) { lsSet(CFG.KEY_DISMISSED + ver, '1'); }

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

  // ── Fetch ────────────────────────────────────────────────────────────────────

  function fetchText(url) {
    return fetch(url + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.text() : null; })
      .catch(function() { return null; });
  }

  function fetchJSON(url) {
    return fetch(url + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  // ── MD Parser (same logic as new.js) ────────────────────────────────────────

  function parseMD(mdText) {
    var result = { version: '', date: null, title: null, subtitle: null, notify: true, sections: [] };
    try {
      var body = mdText;
      var fmMatch = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      if (fmMatch) {
        body = mdText.substring(fmMatch[0].length);
        var fm = fmMatch[1];
        var vMatch = fm.match(/^version:\s*(.+)$/m);
        if (vMatch) result.version = String(vMatch[1]).trim();
        var dMatch = fm.match(/^date:\s*(.+)$/m);
        if (dMatch) {
          var parsed = Date.parse(String(dMatch[1]).trim());
          if (!isNaN(parsed)) result.date = new Date(parsed).toISOString();
        }
        var nMatch = fm.match(/^notify:\s*(false|true)$/m);
        if (nMatch) result.notify = nMatch[1] !== 'false';
        var titleBlock = fm.match(/^(title:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
        if (titleBlock) result.title = parseI18nBlock(titleBlock[2]);
        else { var titleLine = fm.match(/^title:\s*(.+)$/m); if (titleLine) result.title = { en: String(titleLine[1]).trim() }; }
        var subBlock = fm.match(/^(subtitle:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
        if (subBlock) result.subtitle = parseI18nBlock(subBlock[2]);
        else { var subLine = fm.match(/^subtitle:\s*(.+)$/m); if (subLine) result.subtitle = { en: String(subLine[1]).trim() }; }
      }
      var lines = body.split('\n');
      var currentSection = null, currentItem = null;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var headingMatch = line.match(/^###\s+(New|Improved|Fixed)\s*$/i);
        if (headingMatch) {
          if (currentSection) result.sections.push(currentSection);
          currentSection = { type: headingMatch[1].toLowerCase(), items: [] };
          currentItem = null; continue;
        }
        if (line.match(/^\s*-\s+\*\*/)) {
          if (currentItem && currentSection) currentSection.items.push(currentItem);
          currentItem = parseItemLine(line); continue;
        }
        if (currentItem && line.trim() && !line.match(/^---/) && !line.match(/^###/)) {
          if (!currentItem.desc) currentItem.desc = { en: '', th: '' };
          currentItem.desc.en += (currentItem.desc.en ? ' ' : '') + line.trim();
          currentItem.desc.th += (currentItem.desc.th ? ' ' : '') + line.trim();
        }
      }
      if (currentItem && currentSection) currentSection.items.push(currentItem);
      if (currentSection) result.sections.push(currentSection);
    } catch(e) {}
    return result;
  }

  function parseI18nBlock(block) {
    var obj = {}; var re = /^\s+(\w+):\s*(.+)$/gm; var m;
    while ((m = re.exec(block)) !== null) obj[m[1]] = m[2].trim();
    return Object.keys(obj).length ? obj : null;
  }

  function parseItemLine(line) {
    var item = { title: { en: '', th: '' }, desc: null };
    var match = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*(.*)?$/);
    if (match) {
      item.title = { en: match[1].trim(), th: match[1].trim() };
      if (match[2] && match[2].trim()) item.desc = { en: match[2].trim(), th: match[2].trim() };
    }
    return item;
  }

  // ── Normalize — ทำให้ MD และ JSON อยู่ format เดียวกัน ────────────────────

  var SECTION_CFG = {
    'new': 'new', 'improved': 'improved', 'fixed': 'fixed'
  };

  function normalizeRelease(r) {
    if (!r || !r.version) return null;
    return {
      version:  String(r.version),
      date:     r.date || r.timestamp || null,
      title:    r.title    || null,
      subtitle: r.subtitle || null,
      notify:   r.notify !== false,
      sections: (r.sections || []).map(function(s) {
        return {
          type: SECTION_CFG[s.type] || 'improved',
          items: (s.items || []).map(function(item) {
            var clean = { title: item.title || { en: '', th: '' } };
            if (item.desc) clean.desc = item.desc;
            else if (item.description) clean.desc = item.description;
            return clean;
          })
        };
      })
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function t(obj) {
    if (!obj) return '';
    var lang = ls('selectedLang') || 'en';
    return esc(obj[lang] || obj['en'] || '');
  }

  // ── Build popup content ─────────────────────────────────────────────────────

  function buildContent(wn) {
    var isTh = (ls('selectedLang') || 'en') === 'th';
    var ver  = esc(wn.version || '');
    var dateStr = wn.date ? (isTh ? esc(wn.date.th) : esc(wn.date.en)) : '';
    var title = t(wn.title);
    var sub   = t(wn.subtitle) || (isTh ? 'มีการปรับปรุงและอัปเดตระบบ' : 'System improvements and updates.');

    var items = [];
    (wn.sections || []).forEach(function(s) {
      (s.items || []).slice(0, 4).forEach(function(item) {
        var txt = t(item.title);
        if (txt) items.push(txt);
      });
    });

    var L = {
      badge:   isTh ? 'อัพเดทใหม่'                   : 'New update',
      ver:     isTh ? 'เวอร์ชัน '                     : 'Version ',
      more:    isTh ? 'ดูรายละเอียด'                  : "See what's new",
      dismiss: isTh ? 'ไม่แสดงอีกสำหรับการอัพเดทนี้' : "Don't show again for this update"
    };

    var itemsHTML = '';
    if (items.length) {
      itemsHTML = '<ul class="fv-update-list">';
      items.forEach(function(item) {
        itemsHTML += '<li class="fv-update-item"><span class="fv-update-dot"></span>' + item + '</li>';
      });
      itemsHTML += '</ul>';
    }

    var html = '<div class="fv-update-header">'
      + '<div class="fv-update-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></div>'
      + '<div class="fv-update-info">'
        + '<div class="fv-update-badge">' + L.badge + '</div>'
        + '<div class="fv-update-version">' + L.ver + ver + (title ? ' \u2014 ' + title : '') + '</div>'
        + (dateStr ? '<div class="fv-update-date">' + dateStr + '</div>' : '')
      + '</div></div>'
      + (sub ? '<p class="fv-update-sub">' + sub + '</p>' : '')
      + itemsHTML
      + '<a href="' + CFG.WHATS_NEW_PAGE + '" class="fv-update-cta">' + L.more + '</a>'
      + '<div class="fv-update-dismiss-wrap"><button class="fv-update-dismiss-btn" data-fp-action="dismiss">' + L.dismiss + '</button></div>';

    return { html: html, version: wn.version, lang: isTh ? 'th' : 'en' };
  }

  // ── Inject content styles (once) ────────────────────────────────────────────

  var _stylesInjected = false;
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var css = ''
      + '.fv-update-header{display:flex;align-items:center;gap:12px;margin-bottom:14px}'
      + '.fv-update-icon{width:40px;height:40px;border-radius:12px;flex-shrink:0;background:linear-gradient(135deg,#13b47f,#0d8f65);display:flex;align-items:center;justify-content:center}'
      + '.fv-update-info{min-width:0}'
      + '.fv-update-badge{font-size:.95em;font-weight:600;color:var(--fv-text-primary,#111)}'
      + '.fv-update-version{font-size:.78em;color:#13b47f;font-weight:500;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.fv-update-date{font-size:.72em;color:var(--fv-text-tertiary,#aaa);margin-top:2px}'
      + '.fv-update-sub{font-size:.85em;color:var(--fv-text-secondary,#666);margin:0 0 14px;line-height:1.55}'
      + '.fv-update-list{list-style:none;margin:0 0 16px;padding:0}'
      + '.fv-update-item{display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:.85em;color:var(--fv-text-secondary,#555);line-height:1.5}'
      + '.fv-update-dot{flex-shrink:0;margin-top:5px;width:6px;height:6px;border-radius:50%;background:#13b47f;display:inline-block}'
      + '.fv-update-cta{display:block;width:100%;padding:11px 0;background:linear-gradient(135deg,#13b47f,#0d8f65);color:#fff !important;border-radius:11px;font-size:.95em;font-weight:600;text-align:center;text-decoration:none !important;box-shadow:0 2px 12px rgba(19,180,127,.35);margin-bottom:10px;transition:transform .15s ease,box-shadow .15s ease}'
      + '.fv-update-cta:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(19,180,127,.45)}'
      + '.fv-update-dismiss-wrap{text-align:center}'
      + '.fv-update-dismiss-btn{border:none;background:none;cursor:pointer;font-size:.78em;color:var(--fv-text-tertiary,#aaa);font-family:inherit;padding:4px 8px;border-radius:5px;transition:color .15s}'
      + '.fv-update-dismiss-btn:hover{color:var(--fv-text-secondary,#666)}';
    css += '.fp-theme-dark .fv-update-badge{color:var(--fv-text-primary,#f5f5f7)}'
      + '.fp-theme-dark .fv-update-sub{color:var(--fv-text-secondary,#aeaeb2)}'
      + '.fp-theme-dark .fv-update-item{color:var(--fv-text-secondary,#aeaeb2)}'
      + '.fp-theme-dark .fv-update-date{color:var(--fv-text-tertiary,#636366)}'
      + '.fp-theme-dark .fv-update-dismiss-btn{color:var(--fv-text-tertiary,#636366)}'
      + '.fp-theme-dark .fv-update-dismiss-btn:hover{color:var(--fv-text-secondary,#aeaeb2)}';
    var style = document.createElement('style');
    style.id = 'fv-update-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Show popup via PopupSystem ─────────────────────────────────────────────

  function showPopup(wn, buildId) {
    if (typeof window.PopupSystem === 'undefined' || !window.PopupSystem._initialized) {
      window.addEventListener('fp:ready', function() { _doShow(wn, buildId); }, { once: true });
      setTimeout(function() {
        if (typeof window.PopupSystem === 'undefined') {
          console.warn('[version-core] PopupSystem not available, skipping update popup');
        }
      }, 5000);
      return;
    }
    _doShow(wn, buildId);
  }

  function _doShow(wn, buildId) {
    var version = wn.version;
    lsSet(CFG.KEY_SHOWN_BUILD, buildId);
    markSession(buildId);
    injectStyles();
    var content = buildContent(wn);

    PopupSystem.container({
      id: 'fv-update-' + version, title: null, content: content.html,
      size: 'sm', position: 'center', group: CFG.POPUP_GROUP,
      blocking: true, closable: true, theme: 'light',
      onMount: function(bodyEl, handle) {
        var cta = bodyEl.querySelector('.fv-update-cta');
        if (cta) cta.addEventListener('click', function() { handle.close({ action: 'navigate' }); });
        var dismissBtn = bodyEl.querySelector('[data-fp-action="dismiss"]');
        if (dismissBtn) dismissBtn.addEventListener('click', function() { setDismissed(version); handle.close({ action: 'dismissed' }); });
      },
      onClose: function() {}
    });
  }

  // ── Toggle ────────────────────────────────────────────────────────────────────

  function setupToggle() {
    var btn = document.getElementById(CFG.TOGGLE_ID);
    var sw  = document.getElementById(CFG.SWITCH_ID);
    if (!btn || !sw) return;
    sw.checked = !isDisabled();
    function apply() { setDisabled(!sw.checked); }
    sw.addEventListener('change', apply);
    btn.addEventListener('click', function(e) { if (e.target !== sw) { sw.checked = !sw.checked; apply(); } });
  }

  function trySetupToggle() {
    if (document.getElementById(CFG.TOGGLE_ID)) setupToggle();
    else setTimeout(trySetupToggle, 50);
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  function initWithRelease(wn) {
    if (!wn || !wn.version) return;
    var buildId    = wn.version;
    var shownBuild = ls(CFG.KEY_SHOWN_BUILD);
    if (wn.notify === false) return;
    if (isDismissed(buildId)) return;
    var isBrandNew = (shownBuild !== buildId);
    if (!isBrandNew && !isSessionFresh(buildId)) return;
    showPopup(wn, buildId);
  }

  function init() {
    updateLastActive();
    if (isOnWhatsNewPage()) return;
    if (isDisabled()) return;

    // ลอง fetch current.md ก่อน (MD format ใหม่)
    fetchText(CFG.CURRENT_MD_URL).then(function(mdText) {
      if (mdText && mdText.trim()) {
        var parsed = parseMD(mdText);
        if (parsed.version) {
          initWithRelease(normalizeRelease(parsed));
          return;
        }
      }
      // Fallback: whats-new.json (เก่า)
      return fetchJSON(CFG.LEGACY_JSON_URL).then(function(json) {
        if (json && json.version) initWithRelease(normalizeRelease(json));
      });
    });
  }

  // ── Kickoff ───────────────────────────────────────────────────────────────────

  trySetupToggle();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();