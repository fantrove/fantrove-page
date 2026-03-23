// new.js — v1.0.5.7
// Change: ลบ injectStyles() ออกทั้งหมด — CSS ย้ายไปอยู่ใน /assets/css/new.css แล้ว

(function() {
  'use strict';

  var CURRENT_URL      = '/assets/json/whats-new.json';
  var HISTORY_URL      = '/assets/json/release-history.json';
  var VERSION_URL      = '/assets/json/version.json';
  var POLL_INTERVAL_MS = 60 * 1000;
  var REAL_DATE_SEC    = 10 * 86400; // 10 วัน → เปลี่ยนเป็นวันที่จริง

  var _lastVersion = null;
  var _pollTimer   = null;

  function getLang() {
    try { return localStorage.getItem('selectedLang') || 'en'; } catch(e) { return 'en'; }
  }

  // ── i18n ──────────────────────────────────────────────────────────────────

  var L10N = {
    en: {
      justNow:   'Just now',
      oneMin:    '1 minute ago',
      xMins:     function(n) { return n + ' minutes ago'; },
      oneHour:   '1 hour ago',
      xHours:    function(n) { return n + ' hours ago'; },
      yesterday: 'Yesterday',
      xDays:     function(n) { return n + ' days ago'; }
    },
    th: {
      justNow:   'เมื่อกี้',
      oneMin:    '1 นาทีที่แล้ว',
      xMins:     function(n) { return n + ' นาทีที่แล้ว'; },
      oneHour:   '1 ชั่วโมงที่แล้ว',
      xHours:    function(n) { return n + ' ชั่วโมงที่แล้ว'; },
      yesterday: 'เมื่อวาน',
      xDays:     function(n) { return n + ' วันที่แล้ว'; }
    }
  };

  function t(obj) {
    if (!obj) return '';
    var lang = getLang();
    return obj[lang] || obj['en'] || '';
  }

  // ── Timestamp helpers ─────────────────────────────────────────────────────

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toTimestamp(f) {
    try {
      if (!f) return NaN;
      if (typeof f === 'number') return f;
      if (typeof f === 'string') return Date.parse(f);
      var raw = (f.en || '').replace(' at ', ' ').replace(/\s*UTC\s*$/, ' +0000');
      return Date.parse(raw);
    } catch(e) { return NaN; }
  }

  function toFullDate(ts, lang) {
    try {
      var d    = new Date(ts);
      var h    = pad2(d.getUTCHours());
      var min  = pad2(d.getUTCMinutes());
      var EN_M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      if (lang === 'th') {
        return d.getUTCDate() + ' ' + TH_M[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
          + ' ' + h + ':' + min + ' UTC';
      }
      return EN_M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear()
        + ' at ' + h + ':' + min + ' UTC';
    } catch(e) { return ''; }
  }

  // ── Relative time ─────────────────────────────────────────────────────────

  function diffToRel(sec, ts, lang) {
    var L = L10N[lang] || L10N.en;
    if (sec >= REAL_DATE_SEC) {
      return (!isNaN(ts) && ts) ? toFullDate(ts, lang) : L.xDays(Math.round(sec / 86400));
    }
    if (sec < 45)     return L.justNow;
    if (sec < 90)     return L.oneMin;
    if (sec < 2670)   { var m = Math.round(sec / 60);   return L.xMins(m);   }
    if (sec < 5400)   return L.oneHour;
    if (sec < 77400)  { var h = Math.round(sec / 3600); return L.xHours(h);  }
    if (sec < 129600) return L.yesterday;
    return L.xDays(Math.round(sec / 86400));
  }

  function nextTickMs(sec) {
    if (sec >= REAL_DATE_SEC) return null;
    if (sec < 120)   return 10000;
    if (sec < 3600)  return 30000;
    if (sec < 86400) return 60000;
    return 300000;
  }

  // ── Section config ────────────────────────────────────────────────────────

  var SECTION_CFG = {
    'new':      { color:'#13b47f', bg:'rgba(19,180,127,.09)',  border:'rgba(19,180,127,.2)',  label:{en:'New',      th:'ใหม่'        } },
    'improved': { color:'#0eb0d5', bg:'rgba(14,176,213,.09)',  border:'rgba(14,176,213,.2)',  label:{en:'Improved', th:'ปรับปรุง'    } },
    'fixed':    { color:'#f59e0b', bg:'rgba(245,158,11,.09)',  border:'rgba(245,158,11,.2)',  label:{en:'Fixed',    th:'แก้ไขปัญหา' } }
  };

  // ── Fetch ─────────────────────────────────────────────────────────────────

  function fetchJSON(url) {
    return fetch(url + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render(current, historyData) {
    try {
      var titleEl = document.getElementById('title');
      if (titleEl && current) titleEl.textContent = current.version || '';

      var container = document.getElementById('whats-new-container');
      if (!container) return;
      container.innerHTML = '';

      if (current) {
        _lastVersion = current.version;
        container.appendChild(buildRelease(current, true));
      }

      var releases = (historyData && historyData.releases) || [];
      if (releases.length) {
        var div = document.createElement('div');
        div.className = 'wn-history-label';
        div.textContent = getLang() === 'th' ? 'ประวัติการอัพเดท' : 'Previous releases';
        container.appendChild(div);
        releases.forEach(function(r) {
          try { container.appendChild(buildRelease(r, false)); } catch(e) {}
        });
      }
    } catch(e) {}
  }

  function buildRelease(release, isCurrent) {
    var lang = getLang();
    var wrap = document.createElement('article');
    wrap.className = 'wn-release' + (isCurrent ? ' wn-release--current' : ' wn-release--past');

    var header = document.createElement('div');
    header.className = 'wn-header';

    var badge = document.createElement('span');
    badge.className = 'wn-version-badge' + (isCurrent ? '' : ' wn-version-badge--past');
    badge.textContent = 'v' + (release.version || '');
    header.appendChild(badge);

    var dateSource = release.timestamp || release.date;
    if (dateSource) {
      try {
        var ts   = toTimestamp(dateSource);
        var sec  = isNaN(ts) ? NaN : Math.max(0, Math.floor((Date.now() - ts) / 1000));
        var rel  = isNaN(sec) ? '' : diffToRel(sec, ts, lang);

        if (rel) {
          var chip = document.createElement('span');
          chip.className = 'wn-time-chip';
          chip.textContent = rel;
          if (!isNaN(ts) && ts) {
            try { chip.setAttribute('data-ts', String(ts)); } catch(e) {}
          }
          header.appendChild(chip);
        }

        if (!isNaN(sec) && sec < REAL_DATE_SEC) {
          var fullDateStr = typeof release.date === 'object'
            ? (t(release.date))
            : (typeof release.date === 'string' ? release.date : '');
          if (fullDateStr) {
            var ds = document.createElement('span');
            ds.className = 'wn-date-full';
            ds.textContent = fullDateStr;
            header.appendChild(ds);
          }
        }
      } catch(e) {}
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
      release.sections.forEach(function(s) {
        try { wrap.appendChild(buildSection(s)); } catch(e) {}
      });
    } else if (release.changelog && release.changelog.length) {
      try {
        wrap.appendChild(buildSection({
          type: 'improved',
          items: release.changelog.map(function(c) { return { title: { en: c, th: c } }; })
        }));
      } catch(e) {}
    }

    return wrap;
  }

  function buildSection(section) {
    var cfg  = SECTION_CFG[section.type] || SECTION_CFG['improved'];
    var wrap = document.createElement('div');
    wrap.className = 'wn-section';

    var head = document.createElement('div');
    head.className = 'wn-section-head';
    var pill = document.createElement('span');
    pill.className = 'wn-section-pill';
    pill.style.cssText = 'color:' + cfg.color + ';background:' + cfg.bg + ';border-color:' + cfg.border;
    pill.textContent = t(cfg.label);
    head.appendChild(pill);
    wrap.appendChild(head);

    var list = document.createElement('ul');
    list.className = 'wn-items';
    (section.items || []).forEach(function(item) {
      try {
        var li   = document.createElement('li');
        li.className = 'wn-item';

        var bar  = document.createElement('span');
        bar.className = 'wn-item-bar';
        bar.style.background = cfg.color;
        li.appendChild(bar);

        var body = document.createElement('div');
        body.className = 'wn-item-body';

        var tt = document.createElement('div');
        tt.className = 'wn-item-title';
        tt.textContent = t(item.title);
        body.appendChild(tt);

        if (item.desc) {
          var dd = document.createElement('div');
          dd.className = 'wn-item-desc';
          dd.textContent = t(item.desc);
          body.appendChild(dd);
        }
        li.appendChild(body);
        list.appendChild(li);
      } catch(e) {}
    });
    wrap.appendChild(list);
    return wrap;
  }

  // ── Live tick ─────────────────────────────────────────────────────────────

  function tickRelativeTimes() {
    try {
      var lang  = getLang();
      var chips = document.querySelectorAll('.wn-time-chip[data-ts]');
      var minNext = null;

      for (var i = 0; i < chips.length; i++) {
        try {
          var chip = chips[i];
          var tsStr = chip.getAttribute('data-ts');
          var ts = tsStr ? parseInt(tsStr, 10) : NaN;
          if (!ts || isNaN(ts)) continue;

          var sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
          var rel = diffToRel(sec, ts, lang);
          if (chip.textContent !== rel) chip.textContent = rel;

          var next = nextTickMs(sec);
          if (next !== null) {
            minNext = (minNext === null) ? next : Math.min(minNext, next);
          }
        } catch(e) {}
      }
      return minNext;
    } catch(e) { return null; }
  }

  // ── Version check ─────────────────────────────────────────────────────────

  function checkForUpdates() {
    fetchJSON(VERSION_URL).then(function(v) {
      try {
        if (v && _lastVersion && v.version !== _lastVersion) loadContent();
      } catch(e) {}
    });
  }

  // ── Polling loop ──────────────────────────────────────────────────────────

  function startPolling() {
    tickRelativeTimes();

    function tick() {
      try {
        var nextMs = tickRelativeTimes();
        checkForUpdates();
        var delay = (nextMs !== null) ? Math.max(nextMs, 10000) : POLL_INTERVAL_MS;
        _pollTimer = setTimeout(tick, delay);
      } catch(e) {
        _pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    var firstDelay = tickRelativeTimes();
    _pollTimer = setTimeout(tick, (firstDelay !== null) ? Math.max(firstDelay, 10000) : POLL_INTERVAL_MS);
  }

  function setupVisibilityRefresh() {
    try {
      document.addEventListener('visibilitychange', function() {
        try {
          if (!document.hidden) { tickRelativeTimes(); checkForUpdates(); }
        } catch(e) {}
      });
    } catch(e) {}
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  function loadContent() {
    Promise.all([fetchJSON(CURRENT_URL), fetchJSON(HISTORY_URL)])
      .then(function(r) {
        try { render(r[0], r[1]); } catch(e) {}
      })
      .catch(function() {});
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  // หมายเหตุ: ลบ injectStyles() ออกแล้ว — CSS อยู่ใน /assets/css/new.css

  function boot() {
    try { loadContent();             } catch(e) {}
    try { setupVisibilityRefresh();  } catch(e) {}
    try { startPolling();            } catch(e) {}
  }

  try {
    window.addEventListener('languageChange', function() {
      try { loadContent(); } catch(e) {}
    });
  } catch(e) {}

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  } catch(e) {}

})();