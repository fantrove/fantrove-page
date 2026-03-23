(function() {
  'use strict';

  var CURRENT_URL  = '/assets/json/whats-new.json';
  var HISTORY_URL  = '/assets/json/release-history.json';
  var VERSION_URL  = '/assets/json/version.json';
  var LANG         = function() { return localStorage.getItem('selectedLang') || 'en'; };

  var _lastKnownVersion = null;
  var _pollTimer        = null;
  var POLL_INTERVAL_MS  = 60 * 1000;

  // ── Relative time — platform-grade logic ─────────────────────────────────
  //
  // Threshold map (เหมือน GitHub / YouTube / Twitter):
  //
  //   0–44s      → "Just now"           (ไม่กระโดดไป 1 min ทันที)
  //   45s–89s    → "1 minute ago"       (round ไม่ใช่ floor ตรงๆ)
  //   90s–44m29s → "X minutes ago"      (round ที่ 30s boundary)
  //   44m30s–89m → "1 hour ago"
  //   90m–21h29m → "X hours ago"        (round ที่ 30m boundary)
  //   21h30m–35h → "Yesterday"          (เหมือน Twitter/IG)
  //   36h–13d    → "X days ago"
  //   14d–27d    → "2 weeks ago" ฯลฯ   (week grouping)
  //   28d–45d    → "1 month ago"
  //   46d–319d   → "X months ago"
  //   320d–547d  → "1 year ago"
  //   548d+      → "X years ago"
  //
  // Tick interval (adaptive — ไม่ waste CPU tick ถี่เกินความจำเป็น):
  //   < 2 min    → ทุก 10s
  //   2–60 min   → ทุก 30s
  //   1–24 hr    → ทุก 60s
  //   > 24 hr    → ทุก 5 min
  //
  // Fallback: เมื่อ > 1 ปี → แสดงวันที่จริงแทน relative time

  var L10N = {
    en: {
      justNow:   'Just now',
      oneMin:    '1 minute ago',
      xMins:     function(n) { return n + ' minutes ago'; },
      oneHour:   '1 hour ago',
      xHours:    function(n) { return n + ' hours ago'; },
      yesterday: 'Yesterday',
      xDays:     function(n) { return n + ' days ago'; },
      oneWeek:   '1 week ago',
      xWeeks:    function(n) { return n + ' weeks ago'; },
      oneMonth:  '1 month ago',
      xMonths:   function(n) { return n + ' months ago'; },
      oneYear:   '1 year ago',
      xYears:    function(n) { return n + ' years ago'; }
    },
    th: {
      justNow:   'เมื่อกี้',
      oneMin:    '1 นาทีที่แล้ว',
      xMins:     function(n) { return n + ' นาทีที่แล้ว'; },
      oneHour:   '1 ชั่วโมงที่แล้ว',
      xHours:    function(n) { return n + ' ชั่วโมงที่แล้ว'; },
      yesterday: 'เมื่อวาน',
      xDays:     function(n) { return n + ' วันที่แล้ว'; },
      oneWeek:   '1 สัปดาห์ที่แล้ว',
      xWeeks:    function(n) { return n + ' สัปดาห์ที่แล้ว'; },
      oneMonth:  '1 เดือนที่แล้ว',
      xMonths:   function(n) { return n + ' เดือนที่แล้ว'; },
      oneYear:   '1 ปีที่แล้ว',
      xYears:    function(n) { return n + ' ปีที่แล้ว'; }
    }
  };

  // ── Threshold constants ───────────────────────────────────────────────────
  // relative time ใช้ถึง 7 วัน, วันที่จริงตั้งแต่ 10 วัน
  var REAL_DATE_THRESHOLD = 10 * 86400; // 10 วัน (วินาที)

  // แปลง date field (number | ISO string | {en,th}) → UTC timestamp ms
  function toTimestamp(dateField) {
    if (!dateField) return NaN;
    if (typeof dateField === 'number') return dateField;
    if (typeof dateField === 'string') return Date.parse(dateField);
    var raw = (dateField.en || '').replace(' at ', ' ').replace(/\s*UTC\s*$/, ' +0000');
    return Date.parse(raw);
  }

  // แปลง timestamp → date + time string (UTC) สำหรับเมื่อเกิน 10 วัน
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toShortDate(ts, lang) {
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
  }

  var DAY_10 = 864000; // 10 วัน (วินาที) — หลังจากนี้แสดงวันที่จริงแทน relative

  function diffToRel(diffSec, ts, lang) {
    var L = L10N[lang] || L10N.en;

    // > 10 วัน → วันที่จริง (หยุด relative time)
    if (diffSec >= REAL_DATE_THRESHOLD) {
      return !isNaN(ts) ? toShortDate(ts, lang) : L.xDays(Math.round(diffSec/86400));
    }

    // ≤ 10 วัน → relative time ทั้งหมด
    if (diffSec < 45)     return L.justNow;
    if (diffSec < 90)     return L.oneMin;
    if (diffSec < 2670)   { var m = Math.round(diffSec/60);   return L.xMins(m);  }
    if (diffSec < 5400)   return L.oneHour;
    if (diffSec < 77400)  { var h = Math.round(diffSec/3600); return L.xHours(h); }
    if (diffSec < 129600) return L.yesterday;
    // 36h–10d → "X days ago" ตรงๆ ไม่ใช้ week เพราะยังอยู่ใน relative window
    var d = Math.round(diffSec/86400);
    return L.xDays(d);
  }

  // adaptive tick interval — คืน null เมื่อ diff เกิน 10 วัน (หยุด tick)
  function nextTickMs(diffSec) {
    if (diffSec >= DAY_10) return null;          // เกิน 10 วัน → หยุด
    if (diffSec < 120)     return 10  * 1000;   // < 2 min  → ทุก 10s
    if (diffSec < 3600)    return 30  * 1000;   // < 1 hr   → ทุก 30s
    if (diffSec < 86400)   return 60  * 1000;   // < 24 hr  → ทุก 60s
    return                        5 * 60 * 1000; // 1–10 วัน → ทุก 5 min
  }


  // ── Section config ─────────────────────────────────────────────────────────

  var SECTION_CFG = {
    new:      { color:'#13b47f', bg:'rgba(19,180,127,.09)',  border:'rgba(19,180,127,.2)',  label:{en:'New',      th:'ใหม่'        } },
    improved: { color:'#0eb0d5', bg:'rgba(14,176,213,.09)',  border:'rgba(14,176,213,.2)',  label:{en:'Improved', th:'ปรับปรุง'    } },
    fixed:    { color:'#f59e0b', bg:'rgba(245,158,11,.09)',  border:'rgba(245,158,11,.2)',  label:{en:'Fixed',    th:'แก้ไขปัญหา' } }
  };

  // ── i18n ───────────────────────────────────────────────────────────────────

  function t(obj) {
    if (!obj) return '';
    var lang = LANG();
    return obj[lang] || obj['en'] || '';
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────

  function fetchJSON(url) {
    return fetch(url + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
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

  // ── Build release ──────────────────────────────────────────────────────────

  function buildRelease(release, isCurrent) {
    var wrap = document.createElement('article');
    wrap.className = 'wn-release' + (isCurrent ? ' wn-release--current' : ' wn-release--past');

    // ── header ──
    var header = document.createElement('div');
    header.className = 'wn-header';

    var badge = document.createElement('span');
    badge.className = 'wn-version-badge' + (isCurrent ? '' : ' wn-version-badge--past');
    badge.textContent = 'v' + (release.version || '');
    header.appendChild(badge);

    // relative time chip + full date
    var dateSource = release.timestamp || release.date;
    if (dateSource) {
      var ts  = toTimestamp(dateSource);
      var rel = relativeTime(dateSource);

      if (rel) {
        var chip = document.createElement('span');
        chip.className = 'wn-time-chip';
        chip.textContent = rel;
        if (!isNaN(ts)) chip.dataset.ts = String(ts);
        header.appendChild(chip);
      }

      // full date string (muted, สำหรับ context เพิ่มเติม)
      var fullDate = typeof release.date === 'object'
        ? t(release.date)
        : (typeof release.date === 'string' ? release.date : '');
      if (fullDate) {
        var ds = document.createElement('span');
        ds.className = 'wn-date-full';
        ds.textContent = fullDate;
        header.appendChild(ds);
      }
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
      wrap.appendChild(buildSection({
        type: 'improved',
        items: release.changelog.map(function(c) { return { title:{en:c,th:c} }; })
      }));
    }

    return wrap;
  }

  function buildSection(section) {
    var cfg = SECTION_CFG[section.type] || SECTION_CFG.new;

    var wrap = document.createElement('div');
    wrap.className = 'wn-section';

    var head = document.createElement('div');
    head.className = 'wn-section-head';
    var pill = document.createElement('span');
    pill.className = 'wn-section-pill';
    pill.style.cssText = 'color:'+cfg.color+';background:'+cfg.bg+';border-color:'+cfg.border;
    pill.textContent = t(cfg.label);
    head.appendChild(pill);
    wrap.appendChild(head);

    var list = document.createElement('ul');
    list.className = 'wn-items';
    (section.items || []).forEach(function(item) {
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
    });
    wrap.appendChild(list);
    return wrap;
  }

  // ── Live tick — adaptive interval ─────────────────────────────────────────
  // ใช้ setTimeout แทน setInterval เพื่อให้ interval ปรับตาม diff จริง
  // เช่น ถ้ามี chip ที่ diff < 2 min → tick ทุก 10s
  //      ถ้าทุก chip เกิน 24h แล้ว → tick ทุก 5 min

  function tickRelativeTimes() {
    var lang     = LANG();
    var chips    = document.querySelectorAll('.wn-time-chip[data-ts]');
    var minNext  = null; // null = ทุก chip เกิน 10 วันหมดแล้ว → หยุด tick

    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      var ts   = parseInt(chip.dataset.ts, 10);
      if (!ts || isNaN(ts)) continue;

      var diff = Math.floor((Date.now() - ts) / 1000);
      if (diff < 0) diff = 0;

      var rel = diffToRel(diff, ts, lang);
      if (chip.textContent !== rel) chip.textContent = rel;

      var next = nextTickMs(diff);
      // next === null หมายความว่า chip นี้เกิน 10 วัน ข้ามได้
      if (next !== null) {
        minNext = (minNext === null) ? next : Math.min(minNext, next);
      }
    }

    // null = ไม่มี chip ที่ต้อง tick อีกแล้ว → loop หยุดเอง
    return minNext;
  }

  // schedule tick ครั้งถัดไปด้วย setTimeout (adaptive)
  function scheduleTick() {
    if (_pollTimer) clearTimeout(_pollTimer);
    _pollTimer = setTimeout(function() {
      var nextMs = tickRelativeTimes();
      checkForUpdates();
      // schedule ครั้งถัดไปโดยใช้ interval ที่เหมาะสม
      // แต่ไม่น้อยกว่า nextMs และไม่มากกว่า POLL_INTERVAL_MS
      var delay = Math.max(nextMs, 10000);
      _pollTimer = setTimeout(function tick() {
        var n = tickRelativeTimes();
        checkForUpdates();
        _pollTimer = setTimeout(tick, Math.max(n, 10000));
      }, delay);
    }, tickRelativeTimes()); // tick ครั้งแรกทันที แล้ว schedule ต่อ
  }

  // ── Real-time version check ────────────────────────────────────────────────

  function checkForUpdates() {
    fetchJSON(VERSION_URL).then(function(v) {
      if (v && _lastKnownVersion && v.version !== _lastKnownVersion) loadContent();
    });
  }

  function startPolling() {
    // tick ครั้งแรกทันที
    tickRelativeTimes();

    // adaptive tick loop — หยุดอัตโนมัติเมื่อทุก chip เกิน 10 วัน
    function tick() {
      var nextMs = tickRelativeTimes();
      checkForUpdates();

      if (nextMs === null) {
        // ทุก chip เกิน REAL_DATE_THRESHOLD แล้ว → ยังเช็ค version ต่อ
        // แต่ไม่ต้อง tick relative time อีก → ใช้ interval ห่างขึ้น
        _pollTimer = setTimeout(function() {
          checkForUpdates();
          // ถ้ามีการ loadContent ใหม่ chip ใหม่จะถูก start อีกรอบ
        }, POLL_INTERVAL_MS);
        return;
      }

      _pollTimer = setTimeout(tick, Math.max(nextMs, 10000));
    }

    _pollTimer = setTimeout(tick, tickRelativeTimes() || POLL_INTERVAL_MS);
  }

  function setupVisibilityRefresh() {
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        // กลับมาที่แท็บ → tick ทันที + reschedule
        tickRelativeTimes();
        checkForUpdates();
      }
    });
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  function loadContent() {
    Promise.all([fetchJSON(CURRENT_URL), fetchJSON(HISTORY_URL)])
      .then(function(r) { render(r[0], r[1]); });
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('wn-styles')) return;
    var s = document.createElement('style');
    s.id  = 'wn-styles';
    // ── Type scale ตาม site standard ──────────────────────────────────────────
    // home.css: body 14px (mobile) / 16px (@600px) / 18px (@768px)
    // section: 1.08rem | content: 1rem-1.12rem | small: 0.9em
    // h3: 1.16rem | h2: 1.23rem | nav btn: 0.9em
    s.textContent = [
      '#whats-new-container{max-width:600px;margin:0 auto;padding:0 16px 56px;font-family:\'Segoe UI\',\'Noto Sans Thai\',\'Noto Sans\',sans-serif;font-size:1rem}',

      /* release card */
      '.wn-release{background:#fff;border-radius:30px;border:1.5px solid rgba(14,176,213,.07);padding:22px 20px 18px;margin-bottom:14px;transition:border-color .12s,box-shadow .12s}',
      '.wn-release--current{border-color:rgba(19,180,127,.2);box-shadow:0 4px 20px rgba(19,180,127,.06)}',
      '.wn-release--past{opacity:.82}',
      '.wn-release--past:hover{opacity:1}',

      /* history label */
      '.wn-history-label{font-size:0.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b0bec5;padding:8px 4px 12px}',

      /* header */
      '.wn-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}',

      /* version badge — ใช้ขนาดเดียวกับ nav label */
      '.wn-version-badge{display:inline-block;background:linear-gradient(135deg,#13b47f,#0eb0d5);color:#fff;font-size:0.75rem;font-weight:700;padding:3px 12px;border-radius:20px;letter-spacing:.04em;white-space:nowrap}',
      '.wn-version-badge--past{background:#c8d0d8;background-image:none}',

      /* relative time chip */
      '.wn-time-chip{font-size:0.75rem;font-weight:600;color:#13b47f;background:rgba(19,180,127,.08);border:1px solid rgba(19,180,127,.2);padding:3px 10px;border-radius:20px;white-space:nowrap;transition:background .15s}',
      '.wn-release--past .wn-time-chip{color:#8a9aab;background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.08)}',

      /* full date — muted, ขนาดเล็กสุด */
      '.wn-date-full{font-size:0.75rem;color:#c0c8d0;white-space:nowrap;font-weight:500}',

      /* title — ตาม h3 ของ site (1.16rem) และ h2 (1.23rem) */
      '.wn-title{font-size:1.16rem;font-weight:800;margin:0 0 6px;line-height:1.3;color:#152a2f}',
      'h3.wn-title{font-size:1.05rem;font-weight:700;color:#2f4f58}',

      /* subtitle — ตาม .lead และ p.content ของ site (~1rem-1.08rem) */
      '.wn-subtitle{font-size:1rem;color:#5a7a82;margin:0 0 14px;line-height:1.72;font-weight:500}',

      /* section */
      '.wn-section{margin-bottom:12px}',
      '.wn-section-head{margin-bottom:8px}',

      /* section pill */
      '.wn-section-pill{display:inline-flex;align-items:center;font-size:0.75rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 11px;border-radius:20px;border:1px solid transparent}',

      /* items */
      '.wn-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',

      /* item card */
      '.wn-item{display:flex;align-items:stretch;border-radius:16px;background:rgba(0,0,0,.025);overflow:hidden;transition:background .1s}',
      '.wn-item:hover{background:rgba(19,180,127,.04)}',
      '.wn-item-bar{width:3.5px;flex-shrink:0}',
      '.wn-item-body{padding:11px 14px;flex:1;min-width:0}',

      /* item title — ตาม section font ของ site (1.08rem) */
      '.wn-item-title{font-size:1.08rem;font-weight:700;margin-bottom:4px;line-height:1.45;color:#1a3540}',

      /* item desc — ตาม body/content ของ site (0.9em = small) */
      '.wn-item-desc{font-size:0.9em;color:#6a8a92;line-height:1.72;font-weight:500}',

      /* responsive */
      '@media(max-width:600px){',
        '#whats-new-container{padding:0 12px 48px}',
        '.wn-release{padding:18px 15px 14px;border-radius:24px}',
        '.wn-item{border-radius:14px}',
        '.wn-title{font-size:1.05rem}',
        'h3.wn-title{font-size:0.95rem}',
        '.wn-subtitle{font-size:0.96rem}',
        '.wn-item-title{font-size:1rem}',
        '.wn-item-desc{font-size:0.88em}',
      '}',

      /* dark mode */
      '@media(prefers-color-scheme:dark){',
        '.wn-release{background:#1c2b2f;border-color:rgba(14,176,213,.1)}',
        '.wn-release--current{border-color:rgba(19,180,127,.28)}',
        '.wn-title{color:#cde8ee}',
        'h3.wn-title{color:#a0c8d0}',
        '.wn-subtitle{color:#78a0a8}',
        '.wn-item{background:rgba(255,255,255,.04)}',
        '.wn-item:hover{background:rgba(19,180,127,.07)}',
        '.wn-item-title{color:#c0e0e8}',
        '.wn-item-desc{color:#789aa2}',
        '.wn-date-full{color:#4a5a60}',
        '.wn-history-label{color:#4a5a60}',
        '.wn-time-chip{color:#1ad4a0;background:rgba(26,212,160,.1);border-color:rgba(26,212,160,.25)}',
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

  window.addEventListener('languageChange', function() { loadContent(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();