// new.js — v2.1.0
// Per-language Markdown What's New system
// - อ่าน /assets/md/{lang}/current.md (ปัจจุบัน แยกภาษา)
// - อ่าน /assets/json/release-history.json (ประวัติ — สร้างโดย build script รวม i18n)
// - รองรับ fallback: current.md เดี่ยว, whats-new.json เก่า
// - version.json poll เช็คเวอร์ชั่นใหม่เหมือนเดิม

(function() {
  'use strict';

  var CURRENT_MD_BASE   = '/assets/md/{lang}/current.md';   // per-language
  var CURRENT_MD_LEGACY = '/assets/md/current.md';          // single-file (old v1.4.0 format)
  var RELEASES_INDEX_URL = '/assets/md/releases/index.json'; // v4.1+: manifest ของ releases/
  var RELEASES_MD_BASE  = '/assets/md/{lang}/releases/v{version}.md'; // per-version markdown
  var HISTORY_URL_LEGACY = '/assets/json/release-history.json'; // legacy fallback (v4.0 and earlier)
  var LEGACY_CURRENT    = '/assets/json/whats-new.json';
  var VERSION_URL       = '/assets/json/version.json';
  var POLL_INTERVAL_MS  = 60 * 1000;
  var REAL_DATE_SEC     = 10 * 86400;
  var SUPPORTED_LANGS   = ['en', 'th'];

  var _lastVersion = null;
  var _pollTimer   = null;

  // ── i18n ────────────────────────────────────────────────────────────────────

  // v5.0: ใช้ FvLang.lang เป็น primary, fallback to localStorage
  function getLang() {
    try {
      if (window.FvLang && FvLang.lang) return FvLang.lang;
      var l = localStorage.getItem('selectedLang') || 'en'; 
      return SUPPORTED_LANGS.indexOf(l) >= 0 ? l : 'en'; 
    } catch(e) { return 'en'; }
  }

  var L10N = {
    en: {
      justNow: 'Just now', oneMin: '1 minute ago',
      xMins: function(n) { return n + ' minutes ago'; },
      oneHour: '1 hour ago',
      xHours: function(n) { return n + ' hours ago'; },
      yesterday: 'Yesterday',
      xDays: function(n) { return n + ' days ago'; },
      prevReleases: 'Previous releases'
    },
    th: {
      justNow: 'เมื่อกี้', oneMin: '1 นาทีที่แล้ว',
      xMins: function(n) { return n + ' นาทีที่แล้ว'; },
      oneHour: '1 ชั่วโมงที่แล้ว',
      xHours: function(n) { return n + ' ชั่วโมงที่แล้ว'; },
      yesterday: 'เมื่อวาน',
      xDays: function(n) { return n + ' วันที่แล้ว'; },
      prevReleases: 'ประวัติการอัพเดท'
    }
  };

  // t() รองรับทั้ง object {en:..., th:...} และ string ธรรมดา
  function t(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    var lang = getLang();
    return obj[lang] || obj['en'] || '';
  }

  // ── Timestamp helpers ───────────────────────────────────────────────────────

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
      var d = new Date(ts), h = pad2(d.getUTCHours()), min = pad2(d.getUTCMinutes());
      var EN_M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      if (lang === 'th') return d.getUTCDate() + ' ' + TH_M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + h + ':' + min + ' UTC';
      return EN_M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() + ' at ' + h + ':' + min + ' UTC';
    } catch(e) { return ''; }
  }

  function diffToRel(sec, ts, lang) {
    var L = L10N[lang] || L10N.en;
    if (sec >= REAL_DATE_SEC) return (!isNaN(ts) && ts) ? toFullDate(ts, lang) : L.xDays(Math.round(sec / 86400));
    if (sec < 45) return L.justNow;
    if (sec < 90) return L.oneMin;
    if (sec < 2670) { var m = Math.round(sec / 60); return L.xMins(m); }
    if (sec < 5400) return L.oneHour;
    if (sec < 77400) { var h = Math.round(sec / 3600); return L.xHours(h); }
    if (sec < 129600) return L.yesterday;
    return L.xDays(Math.round(sec / 86400));
  }

  function nextTickMs(sec) {
    if (sec >= REAL_DATE_SEC) return null;
    if (sec < 120) return 10000;
    if (sec < 3600) return 30000;
    if (sec < 86400) return 60000;
    return 300000;
  }

  // ── Section config ──────────────────────────────────────────────────────────

  var SECTION_CFG = {
    'new':      { color:'#13b47f', bg:'rgba(19,180,127,.09)',  border:'rgba(19,180,127,.2)',  label:{en:'New',      th:'ใหม่'        } },
    'improved': { color:'#0eb0d5', bg:'rgba(14,176,213,.09)',  border:'rgba(14,176,213,.2)',  label:{en:'Improved', th:'ปรับปรุง'    } },
    'fixed':    { color:'#f59e0b', bg:'rgba(245,158,11,.09)',  border:'rgba(245,158,11,.2)',  label:{en:'Fixed',    th:'แก้ไขปัญหา' } }
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  MARKDOWN PARSER
  // ══════════════════════════════════════════════════════════════════════════════
  // รองรับ 2 โหมด:
  //  1. Per-language: title/subtitle เป็น string ธรรมดา → wrap เป็น {lang: value}
  //  2. Legacy i18n: title/subtitle เป็น {en:..., th:...} → ใช้ตรงนั้น

  function parseMD(mdText, lang) {
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
        if (dMatch) { var parsed = Date.parse(String(dMatch[1]).trim()); if (!isNaN(parsed)) result.date = new Date(parsed).toISOString(); }
        var nMatch = fm.match(/^notify:\s*(false|true)$/m);
        if (nMatch) result.notify = nMatch[1] !== 'false';

        // title — ลอง i18n block ก่อน แล้วค่อยลอง single string
        var titleBlock = fm.match(/^(title:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
        if (titleBlock) {
          result.title = parseI18nBlock(titleBlock[2]);
        } else {
          var titleLine = fm.match(/^title:\s*(.+)$/m);
          if (titleLine) {
            var tv = String(titleLine[1]).trim();
            // Per-language: wrap string → {lang: value}
            result.title = lang ? _wrapLang(tv, lang) : { en: tv };
          }
        }

        // subtitle — เหมือนกัน
        var subBlock = fm.match(/^(subtitle:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
        if (subBlock) {
          result.subtitle = parseI18nBlock(subBlock[2]);
        } else {
          var subLine = fm.match(/^subtitle:\s*(.+)$/m);
          if (subLine) {
            var sv = String(subLine[1]).trim();
            result.subtitle = lang ? _wrapLang(sv, lang) : { en: sv };
          }
        }
      }

      // Parse body → sections
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
          currentItem = parseItemLine(line, lang);
          continue;
        }
        if (currentItem && line.trim() && !line.match(/^---/) && !line.match(/^###/)) {
          if (!currentItem.desc) currentItem.desc = lang ? _wrapLang('', lang) : { en: '' };
          var descKey = lang || 'en';
          currentItem.desc[descKey] += (currentItem.desc[descKey] ? ' ' : '') + line.trim();
        }
      }
      if (currentItem && currentSection) currentSection.items.push(currentItem);
      if (currentSection) result.sections.push(currentSection);
    } catch(e) { console.warn('[new.js] MD parse error:', e); }
    return result;
  }

  // Wrap string ให้เป็น {lang: value}
  function _wrapLang(val, lang) {
    var obj = {};
    obj[lang] = val;
    return obj;
  }

  function parseI18nBlock(block) {
    var obj = {}; var re = /^\s+(\w+):\s*(.+)$/gm; var m;
    while ((m = re.exec(block)) !== null) obj[m[1]] = m[2].trim();
    return Object.keys(obj).length ? obj : null;
  }

  function parseItemLine(line, lang) {
    var item = { title: {}, desc: null };
    var match = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*(.*)?$/);
    if (match) {
      var titleText = match[1].trim();
      var restText  = (match[2] || '').trim();
      // Per-language: title เป็น string ในภาษานั้น
      item.title = lang ? _wrapLang(titleText, lang) : { en: titleText, th: titleText };
      if (restText) item.desc = lang ? _wrapLang(restText, lang) : { en: restText, th: restText };
    }
    return item;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  FETCH HELPERS
  // ══════════════════════════════════════════════════════════════════════════════

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

  // ══════════════════════════════════════════════════════════════════════════════
  //  MAIN DATA PIPELINE
  // ══════════════════════════════════════════════════════════════════════════════
  //  1. fetch /assets/md/{lang}/current.md → parse (per-language)
  //     fallback: /assets/md/current.md → parse (legacy single-file with i18n)
  //     fallback: /assets/json/whats-new.json (old JSON)
  //  2. fetch /assets/md/releases/index.json (v4.1+ manifest)
  //     สำหรับแต่ละ version ที่ hasDetails: true → fetch /assets/md/{lang}/releases/v{version}.md
  //     fallback: /assets/json/release-history.json (legacy v4.0)
  //  3. render

  function loadContent() {
    var lang = getLang();
    var currentRelease = null;
    var historyData    = { releases: [] };

    // Step 1: โหลด current release — ลอง per-language MD → legacy MD → JSON
    var perLangUrl = CURRENT_MD_BASE.replace('{lang}', lang);

    fetchText(perLangUrl).then(function(mdText) {
      if (mdText && mdText.trim()) {
        var parsed = parseMD(mdText, lang);
        if (parsed.version) {
          currentRelease = parsed;
          return null; // ไม่ต้อง fallback
        }
      }
      // Fallback 2: legacy single-file MD (มี i18n blocks)
      return fetchText(CURRENT_MD_LEGACY);
    }).then(function(mdText) {
      if (mdText && !currentRelease) {
        var parsed = parseMD(mdText, null); // null = legacy i18n mode
        if (parsed.version) currentRelease = parsed;
        return null;
      }
      // Fallback 3: JSON เก่า
      if (!currentRelease) return fetchJSON(LEGACY_CURRENT);
    }).then(function(json) {
      if (json && !currentRelease && json.version) currentRelease = json;

      // Step 2: โหลดประวัติ — v4.1+ ใช้ releases/index.json
      return loadHistoryFromIndex(lang);
    }).then(function(history) {
      if (history && history.releases && history.releases.length) {
        historyData = history;
      }
      // Fallback: legacy release-history.json (สำหรับเว็บที่ยังไม่ได้ bump เป็น v4.1+)
      if (!historyData.releases.length) return fetchJSON(HISTORY_URL_LEGACY);
      return null;
    }).then(function(legacyHistory) {
      if (legacyHistory && legacyHistory.releases && legacyHistory.releases.length) {
        historyData = legacyHistory;
      }

      // Step 3: Render
      var pastReleases = historyData.releases.filter(function(r) {
        return currentRelease ? r.version !== currentRelease.version : true;
      });
      render(currentRelease, { releases: pastReleases });
    }).catch(function(err) {
      console.warn('[new.js] Load error:', err);
    });
  }

  // v4.1+: โหลดประวัติจาก releases/index.json + ไฟล์ markdown แต่ละ version
  //  1. fetch /assets/md/releases/index.json → ได้ list ของ versions + dates + hasDetails
  //  2. สำหรับแต่ละ version ที่ hasDetails: true → fetch /assets/md/{lang}/releases/v{version}.md → parse
  //  3. สำหรับ version ที่ hasDetails: false → ใช้แค่ version + date (basic record)
  //  4. กรอง version ปัจจุบันออก (currentRelease แสดงแยก)
  function loadHistoryFromIndex(lang) {
    return fetchJSON(RELEASES_INDEX_URL).then(function(index) {
      if (!index || !index.versions || !index.versions.length) return { releases: [] };

      var promises = index.versions.map(function(entry) {
        if (entry.hasDetails) {
          // มีไฟล์ markdown → fetch + parse
          var url = RELEASES_MD_BASE.replace('{lang}', lang).replace('{version}', entry.version);
          return fetchText(url).then(function(text) {
            if (text && text.trim()) {
              var parsed = parseMD(text, lang);
              // ใช้ date จาก index.json (source of truth) แทน date ใน markdown
              if (entry.date) parsed.date = entry.date;
              return parsed;
            }
            // ถ้า fetch ล้มเหลว → ใช้ basic record
            return { version: entry.version, date: entry.date, title: null, subtitle: null, sections: [] };
          }).catch(function() {
            return { version: entry.version, date: entry.date, title: null, subtitle: null, sections: [] };
          });
        } else {
          // ไม่มีไฟล์ markdown → ใช้ basic record (version + date เท่านั้น)
          return Promise.resolve({
            version: entry.version,
            date: entry.date,
            title: null,
            subtitle: null,
            sections: []
          });
        }
      });

      return Promise.all(promises).then(function(results) {
        var releases = results.filter(Boolean);
        // เรียงจากใหม่ → เก่า (index.json มาเรียงให้แล้ว แต่เผื่อไว้)
        releases.sort(function(a, b) { return compareVersions(b.version, a.version); });
        return { releases: releases };
      });
    }).catch(function() {
      // index.json ไม่มี → return empty (fallback ไป legacy ใน caller)
      return { releases: [] };
    });
  }

  function compareVersions(a, b) {
    var pa = String(a || '0').split('.').map(Number);
    var pb = String(b || '0').split('.').map(Number);
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) { var na = pa[i] || 0, nb = pb[i] || 0; if (na !== nb) return na - nb; }
    return 0;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  RENDER (เหมือนเดิม)
  // ══════════════════════════════════════════════════════════════════════════════

  function render(current, historyData) {
    try {
      var titleEl = document.getElementById('title');
      if (titleEl && current) titleEl.textContent = current.version || '';
      var container = document.getElementById('whats-new-container');
      if (!container) return;
      container.innerHTML = '';
      if (current) { _lastVersion = current.version; container.appendChild(buildRelease(current, true)); }
      var releases = (historyData && historyData.releases) || [];
      if (releases.length) {
        var div = document.createElement('div');
        div.className = 'wn-history-label';
        div.textContent = (L10N[getLang()] || L10N.en).prevReleases;
        container.appendChild(div);
        releases.forEach(function(r) { try { container.appendChild(buildRelease(r, false)); } catch(e) {} });
      }
    } catch(e) {}
  }

  function buildRelease(release, isCurrent) {
    var lang = getLang();
    var wrap = document.createElement('article');
    wrap.className = 'wn-release' + (isCurrent ? ' wn-release--current' : ' wn-release--past');
    var header = document.createElement('div'); header.className = 'wn-header';
    var badge = document.createElement('span');
    badge.className = 'wn-version-badge' + (isCurrent ? '' : ' wn-version-badge--past');
    badge.textContent = 'v' + (release.version || '');
    header.appendChild(badge);
    var dateSource = release.date || release.timestamp;
    if (dateSource) {
      try {
        var ts = toTimestamp(dateSource);
        var sec = isNaN(ts) ? NaN : Math.max(0, Math.floor((Date.now() - ts) / 1000));
        var rel = isNaN(sec) ? '' : diffToRel(sec, ts, lang);
        if (rel) {
          var chip = document.createElement('span'); chip.className = 'wn-time-chip'; chip.textContent = rel;
          if (!isNaN(ts) && ts) try { chip.setAttribute('data-ts', String(ts)); } catch(e) {}
          header.appendChild(chip);
        }
        if (!isNaN(sec) && sec < REAL_DATE_SEC) {
          var fullDateStr = typeof release.date === 'object' ? t(release.date) : (typeof release.date === 'string' ? release.date : '');
          if (fullDateStr) { var ds = document.createElement('span'); ds.className = 'wn-date-full'; ds.textContent = fullDateStr; header.appendChild(ds); }
        }
      } catch(e) {}
    }
    wrap.appendChild(header);
    if (release.title) { var h = document.createElement(isCurrent ? 'h2' : 'h3'); h.className = 'wn-title'; h.textContent = t(release.title); wrap.appendChild(h); }
    if (release.subtitle) { var sub = document.createElement('p'); sub.className = 'wn-subtitle'; sub.textContent = t(release.subtitle); wrap.appendChild(sub); }
    if (release.sections && release.sections.length) { release.sections.forEach(function(s) { try { wrap.appendChild(buildSection(s)); } catch(e) {} }); }
    return wrap;
  }

  function buildSection(section) {
    var cfg = SECTION_CFG[section.type] || SECTION_CFG['improved'];
    var wrap = document.createElement('div'); wrap.className = 'wn-section';
    var head = document.createElement('div'); head.className = 'wn-section-head';
    var pill = document.createElement('span'); pill.className = 'wn-section-pill';
    pill.style.cssText = 'color:' + cfg.color + ';background:' + cfg.bg + ';border-color:' + cfg.border;
    pill.textContent = t(cfg.label); head.appendChild(pill); wrap.appendChild(head);
    var list = document.createElement('ul'); list.className = 'wn-items';
    (section.items || []).forEach(function(item) {
      try {
        var li = document.createElement('li'); li.className = 'wn-item';
        var bar = document.createElement('span'); bar.className = 'wn-item-bar'; bar.style.background = cfg.color; li.appendChild(bar);
        var body = document.createElement('div'); body.className = 'wn-item-body';
        var tt = document.createElement('div'); tt.className = 'wn-item-title'; tt.textContent = t(item.title); body.appendChild(tt);
        if (item.desc) { var dd = document.createElement('div'); dd.className = 'wn-item-desc'; dd.textContent = t(item.desc); body.appendChild(dd); }
        li.appendChild(body); list.appendChild(li);
      } catch(e) {}
    });
    wrap.appendChild(list); return wrap;
  }

  // ── Live tick, polling, boot (เหมือนเดิม) ─────────────────────────────────

  function tickRelativeTimes() {
    try {
      var lang = getLang(); var chips = document.querySelectorAll('.wn-time-chip[data-ts]'); var minNext = null;
      for (var i = 0; i < chips.length; i++) {
        try {
          var chip = chips[i]; var ts = parseInt(chip.getAttribute('data-ts'), 10); if (!ts || isNaN(ts)) continue;
          var sec = Math.max(0, Math.floor((Date.now() - ts) / 1000)); var rel = diffToRel(sec, ts, lang);
          if (chip.textContent !== rel) chip.textContent = rel;
          var next = nextTickMs(sec); if (next !== null) minNext = (minNext === null) ? next : Math.min(minNext, next);
        } catch(e) {}
      }
      return minNext;
    } catch(e) { return null; }
  }

  function checkForUpdates() { fetchJSON(VERSION_URL).then(function(v) { try { if (v && _lastVersion && v.version !== _lastVersion) loadContent(); } catch(e) {} }); }

  function startPolling() {
    tickRelativeTimes();
    function tick() {
      try { var nextMs = tickRelativeTimes(); checkForUpdates(); var delay = (nextMs !== null) ? Math.max(nextMs, 10000) : POLL_INTERVAL_MS; _pollTimer = setTimeout(tick, delay); }
      catch(e) { _pollTimer = setTimeout(tick, POLL_INTERVAL_MS); }
    }
    var firstDelay = tickRelativeTimes(); _pollTimer = setTimeout(tick, (firstDelay !== null) ? Math.max(firstDelay, 10000) : POLL_INTERVAL_MS);
  }

  function setupVisibilityRefresh() { try { document.addEventListener('visibilitychange', function() { try { if (!document.hidden) { tickRelativeTimes(); checkForUpdates(); } } catch(e) {} }); } catch(e) {} }

  function boot() { try { loadContent(); } catch(e) {} try { setupVisibilityRefresh(); } catch(e) {} try { startPolling(); } catch(e) {} }

  // v5.0: ฟังทั้ง languageChange (backward compat) และ fv:langchange (FvLang)
  try { window.addEventListener('languageChange', function() { try { loadContent(); } catch(e) {} }); } catch(e) {}
  try { window.addEventListener('fv:langchange', function() { try { loadContent(); } catch(e) {} }); } catch(e) {}

  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); } catch(e) {}
})();