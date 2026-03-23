(function() {
  'use strict';
  
  var CURRENT_URL = '/assets/json/whats-new.json';
  var HISTORY_URL = '/assets/json/release-history.json';
  var LANG = function() { return localStorage.getItem('selectedLang') || 'en'; };
  
  // ✅ ติดตาม version ที่แสดงล่าสุด เพื่อ detect การอัพเดทแบบ real-time
  var _lastKnownVersion = null;
  var _pollTimer = null;
  var POLL_INTERVAL_MS = 60 * 1000;
  
  var SECTION_COLORS = { new: '#13b47f', improved: '#3b82f6', fixed: '#f59e0b' };
  var SECTION_LABELS = {
    new: { en: 'New', th: 'มีอะไรใหม่' },
    improved: { en: 'Improved', th: 'ปรับปรุง' },
    fixed: { en: 'Fixed', th: 'แก้ไขปัญหา' }
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
    
    if (current) {
      _lastKnownVersion = current.version;
      container.appendChild(buildRelease(current, true));
    }
    
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
    var color = SECTION_COLORS[section.type] || '#13b47f';
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
  // ✅ ตรวจจาก whats-new.json โดยตรง ไม่ต้องพึ่ง version.json
  
  function checkForUpdates() {
    fetchJSON(CURRENT_URL).then(function(data) {
      if (!data) return;
      if (_lastKnownVersion && data.version !== _lastKnownVersion) {
        console.log('[WhatsNew] พบเวอร์ชันใหม่ ' + _lastKnownVersion + ' → ' + data.version + ', โหลดเนื้อหาใหม่');
        loadContent();
      }
    });
  }
  
  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(checkForUpdates, POLL_INTERVAL_MS);
  }
  
  function setupVisibilityRefresh() {
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) checkForUpdates();
    });
  }
  
  // ── Load ───────────────────────────────────────────────────────────────────
  
  function loadContent() {
    Promise.all([fetchJSON(CURRENT_URL), fetchJSON(HISTORY_URL)])
      .then(function(results) { render(results[0], results[1]); });
  }
  
  // ── Boot ───────────────────────────────────────────────────────────────────
  
  function boot() {
    loadContent();
    setupVisibilityRefresh();
    startPolling();
  }
  
  window.addEventListener('languageChange', function() { loadContent(); });
  
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  
})();