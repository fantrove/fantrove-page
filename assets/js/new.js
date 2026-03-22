(function() {
  'use strict';

  var CURRENT_URL = '/assets/json/whats-new.json';
  var HISTORY_URL = '/assets/json/release-history.json';
  var VERSION_URL = '/assets/json/version.json';
  var LANG = function() { return localStorage.getItem('selectedLang') || 'en'; };

  // ✅ ติดตาม version ที่แสดงล่าสุด เพื่อ detect การอัพเดทแบบ real-time
  var _lastKnownVersion = null;
  var _pollTimer        = null;
  var POLL_INTERVAL_MS  = 60 * 1000; // ตรวจทุก 60 วินาที

  var SECTION_COLORS = { new: '#13b47f', improved: '#3b82f6', fixed: '#f59e0b' };
  var SECTION_LABELS = {
    new:      { en: 'New',      th: 'มีอะไรใหม่' },
    improved: { en: 'Improved', th: 'ปรับปรุง'   },
    fixed:    { en: 'Fixed',    th: 'แก้ไขปัญหา' }
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────

  function fetchJSON(url) {
    return fetch(url + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  // ── i18n ───────────────────────────────────────────────────────────────────

  function t(obj) {
    if (!obj) return '';
    var lang = LANG();
    return obj[lang] || obj['en'] || '';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render(current, historyData) {
    var titleEl = document.getElementById('title');
    if (titleEl && current) titleEl.textContent = current.version || '';

    var container = document.getElementById('whats-new-container');
    if (!container) return;
    container.innerHTML = '';

    // current release
    if (current) {
      _lastKnownVersion = current.version;
      container.appendChild(buildRelease(current, true));
    }

    // history
    var releases = (historyData && historyData.releases) || [];
    if (releases.length) {
      var divider = document.createElement('div');
      divider.className = 'wn-history-label';
      divider.textContent = LANG() === 'th' ? 'ประวัติการอัพเดท' : 'Previous releases';
      container.appendChild(divider);
      releases.forEach(function(r) { container.appendChild(buildRelease(r, false)); });
    }
  }

  // ── Build release card ─────────────────────────────────────────────────────

  function buildRelease(release, isCurrent) {
    var wrap = document.createElement('article');
    wrap.className = 'wn-release' + (isCurrent ? ' wn-release--current' : ' wn-release--past');

    var header = document.createElement('div');
    header.className = 'wn-header';

    var badge = document.createElement('span');
    badge.className = 'wn-version-badge' + (isCurrent ? '' : ' wn-version-badge--past');
    badge.textContent = 'v' + (release.version || '');
    header.appendChild(badge);

    // ✅ แสดง date (รองรับทั้ง string และ object {en, th})
    if (release.date) {
      var date = document.createElement('span');
      date.className = 'wn-date';
      var dateVal = (typeof release.date === 'object') ? t(release.date) : release.date;
      date.textContent = dateVal;
      header.appendChild(date);
    }

    wrap.appendChild(header);

    if (release.title) {
      var h = document.createElement(isCurrent ? 'h2' : 'h3');
      h.className = 'wn-title';
      h.textContent = t(release.title);
      wrap.appendChild(h);
    }

    if (release.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'wn-subtitle';
      sub.textContent = t(release.subtitle);
      wrap.appendChild(sub);
    }

    if (release.sections && release.sections.length) {
      release.sections.forEach(function(s) { wrap.appendChild(buildSection(s)); });
    } else if (release.changelog && release.changelog.length) {
      var s = { type: 'improved', items: release.changelog.map(function(c) { return { title: { en: c, th: c } }; }) };
      wrap.appendChild(buildSection(s));
    }

    return wrap;
  }

  function buildSection(section) {
    var color  = SECTION_COLORS[section.type] || '#13b47f';
    var labels = SECTION_LABELS[section.type] || SECTION_LABELS.new;

    var wrap = document.createElement('div');
    wrap.className = 'wn-section';

    var head = document.createElement('div');
    head.className = 'wn-section-head';
    var dot = document.createElement('span');
    dot.className = 'wn-section-dot';
    dot.style.background = color;
    head.appendChild(dot);
    var lbl = document.createElement('span');
    lbl.className = 'wn-section-label';
    lbl.style.color = color;
    lbl.textContent = t(labels);
    head.appendChild(lbl);
    wrap.appendChild(head);

    var list = document.createElement('ul');
    list.className = 'wn-items';
    (section.items || []).forEach(function(item) {
      var li = document.createElement('li');
      li.className = 'wn-item';
      var tt = document.createElement('div');
      tt.className = 'wn-item-title';
      tt.textContent = t(item.title);
      li.appendChild(tt);
      if (item.desc) {
        var dd = document.createElement('div');
        dd.className = 'wn-item-desc';
        dd.textContent = t(item.desc);
        li.appendChild(dd);
      }
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // ── Real-time update check ─────────────────────────────────────────────────

  function checkForUpdates() {
    fetchJSON(VERSION_URL).then(function(versionData) {
      if (!versionData) return;
      var latestVersion = versionData.version;

      // ถ้า version เปลี่ยน → โหลดเนื้อหาใหม่ทันที
      if (_lastKnownVersion && latestVersion !== _lastKnownVersion) {
        console.log('[WhatsNew] พบเวอร์ชันใหม่ ' + _lastKnownVersion + ' → ' + latestVersion + ', โหลดเนื้อหาใหม่');
        loadContent();
      }
    });
  }

  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(checkForUpdates, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ✅ ใช้ Page Visibility API: รีเฟรชทันทีที่ผู้ใช้กลับมาที่แท็บนี้
  function setupVisibilityRefresh() {
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        // กลับมาที่แท็บ → ตรวจสอบทันที
        checkForUpdates();
      }
    });
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  function loadContent() {
    Promise.all([fetchJSON(CURRENT_URL), fetchJSON(HISTORY_URL)])
      .then(function(results) { render(results[0], results[1]); });
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('wn-styles')) return;
    var s = document.createElement('style');
    s.id = 'wn-styles';
    s.textContent = [
      '#whats-new-container{max-width:640px;margin:0 auto;padding:0 16px 48px}',
      '.wn-release{padding:24px 0;border-bottom:1px solid rgba(0,0,0,.08)}',
      '.wn-release:last-child{border-bottom:none}',
      '.wn-release--past{opacity:.75}',
      '.wn-history-label{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#999;padding:24px 0 8px}',
      '.wn-header{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}',
      '.wn-version-badge{display:inline-block;background:#13b47f;color:#fff;font-size:11px;font-weight:600;padding:2px 10px;border-radius:20px;letter-spacing:.04em}',
      '.wn-version-badge--past{background:#888}',
      '.wn-date{font-size:12px;color:#888}',
      '.wn-title{font-size:1.2em;font-weight:700;margin:0 0 6px;line-height:1.3}',
      'h3.wn-title{font-size:1em}',
      '.wn-subtitle{font-size:.88em;color:#555;margin:0 0 16px;line-height:1.6}',
      '.wn-section{margin-bottom:16px}',
      '.wn-section-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.wn-section-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',
      '.wn-section-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}',
      '.wn-items{list-style:none;margin:0;padding:0}',
      '.wn-item{padding:10px 14px;border-radius:10px;background:rgba(0,0,0,.03);margin-bottom:8px}',
      '.wn-item-title{font-size:.88em;font-weight:600;margin-bottom:3px}',
      '.wn-item-desc{font-size:.82em;color:#666;line-height:1.55}',
      '@media(prefers-color-scheme:dark){',
        '.wn-release{border-color:rgba(255,255,255,.08)}',
        '.wn-subtitle{color:#aaa}',
        '.wn-date{color:#666}',
        '.wn-item{background:rgba(255,255,255,.05)}',
        '.wn-item-desc{color:#999}',
        '.wn-history-label{color:#666}',
      '}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  function boot() {
    injectStyles();
    loadContent();
    setupVisibilityRefresh();
    startPolling();
  }

  // ── Language change ────────────────────────────────────────────────────────

  window.addEventListener('languageChange', function() {
    loadContent();
  });

  // ── Start ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();