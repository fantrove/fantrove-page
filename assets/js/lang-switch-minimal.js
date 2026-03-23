/**
 * lang-switch-minimal.js — Lightweight Language Switcher for Production
 *
 * ใช้ในหน้า built (production เท่านั้น) แทน language.js
 *
 * หน้าที่:
 *  - เปิด dropdown เลือกภาษา
 *  - เมื่อ user เลือกภาษา → redirect ไป /[lang]/[current-path]
 *  - บันทึก preference ลง localStorage (เพื่อ lang-proxy ใช้งานต่อได้)
 *
 * ไม่มี dependency ใดๆ — standalone
 * ขนาดเล็กมาก (~1 KB gzip)
 */
(function() {
  'use strict';
  
  // ── Config ─────────────────────────────────────────────────────────────
  
  /** ภาษาที่รองรับ — ตรงกับที่ build สร้างไว้ */
  var LANGS = {
    en: 'English',
    th: 'ภาษาไทย',
  };
  var LS_KEY = 'selectedLang';
  
  // ── Detect current lang from URL ───────────────────────────────────────
  
  function getCurrentLang() {
    var m = location.pathname.match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }
  
  /** แปลง URL path เป็นภาษาที่ต้องการ */
  function buildLangUrl(targetLang) {
    var current = location.pathname;
    var currentLang = getCurrentLang();
    
    var newPath;
    if (currentLang) {
      newPath = current.replace(/^\/(en|th)(\/|$)/, '/' + targetLang + '$2');
    } else {
      newPath = '/' + targetLang + (current === '/' ? '' : current);
    }
    
    return newPath + location.search + location.hash;
  }
  
  // ── UI ─────────────────────────────────────────────────────────────────
  
  var _overlay = null;
  var _dropdown = null;
  var _isOpen = false;
  var _scrollY = 0;
  
  function buildUI() {
    var btn = document.getElementById('language-button');
    if (!btn) return;
    
    var currentLang = getCurrentLang() || 'en';
    
    // ── Button label ───────────────────────────────────────────────────
    var flex = btn.querySelector('.lang-btn-flex');
    if (!flex) {
      flex = document.createElement('span');
      flex.className = 'lang-btn-flex';
      flex.style.cssText = 'display:inline-flex;align-items:center;gap:15px;vertical-align:middle;';
      btn.innerHTML = '';
      btn.appendChild(flex);
      
      // SVG icon (same as ui.js)
      var iconWrap = document.createElement('span');
      iconWrap.className = 'lang-btn-svg';
      iconWrap.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
      iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18.5" height="18.5" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M9 3v2c0 4.418 -2.239 8 -5 8"/><path d="M5 9c0 2.144 2.952 3.908 6.7 4"/><path d="M12 20l4 -9l4 9"/><path d="M19.1 18h-6.2"/></svg>';
      flex.appendChild(iconWrap);
    }
    
    // Update or create text span
    var txt = flex.querySelector('.lang-btn-txt');
    if (!txt) {
      txt = document.createElement('span');
      txt.className = 'lang-btn-txt';
      txt.style.lineHeight = '1';
      flex.appendChild(txt);
    }
    txt.textContent = LANGS[currentLang] || currentLang.toUpperCase();
    
    // ── Overlay ────────────────────────────────────────────────────────
    _overlay = document.createElement('div');
    _overlay.id = 'language-overlay';
    _overlay.style.cssText =
      'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;opacity:0;transition:opacity 0.3s;';
    document.body.appendChild(_overlay);
    
    // ── Dropdown ───────────────────────────────────────────────────────
    _dropdown = document.createElement('div');
    _dropdown.id = 'language-dropdown';
    _dropdown.style.cssText =
      'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;z-index:9999;max-height:80vh;overflow-y:auto;opacity:0;transition:opacity 0.3s;border-radius:12px;min-width:180px;';
    document.body.appendChild(_dropdown);
    
    // Populate options
    Object.entries(LANGS).forEach(function(entry) {
      var lang = entry[0];
      var label = entry[1];
      var opt = document.createElement('div');
      opt.className = 'language-option';
      opt.textContent = label;
      opt.dataset.language = lang;
      opt.style.cssText = 'padding:14px 24px;cursor:pointer;font-size:15px;';
      if (lang === currentLang) {
        opt.style.fontWeight = '700';
        opt.style.color = '#13b47f';
      }
      _dropdown.appendChild(opt);
    });
    
    // ── Event listeners ────────────────────────────────────────────────
    btn.addEventListener('click', toggleDropdown);
    _overlay.addEventListener('click', closeDropdown);
    
    _dropdown.addEventListener('click', function(e) {
      var opt = e.target.closest('.language-option');
      if (!opt || !opt.dataset.language) return;
      selectLanguage(opt.dataset.language);
    });
  }
  
  function toggleDropdown() {
    _isOpen ? closeDropdown() : openDropdown();
  }
  
  function openDropdown() {
    if (_isOpen) return;
    _isOpen = true;
    _scrollY = window.scrollY || 0;
    
    _overlay.style.display = 'block';
    _dropdown.style.display = 'block';
    
    document.body.style.cssText =
      'position:fixed;left:0;right:0;overflow-y:scroll;top:-' + _scrollY + 'px;';
    
    requestAnimationFrame(function() {
      _overlay.style.opacity = '1';
      _dropdown.style.opacity = '1';
    });
  }
  
  function closeDropdown() {
    if (!_isOpen) return;
    _isOpen = false;
    
    _overlay.style.opacity = '0';
    _dropdown.style.opacity = '0';
    
    setTimeout(function() {
      _overlay.style.display = 'none';
      _dropdown.style.display = 'none';
      document.body.style.cssText = '';
      window.scrollTo(0, _scrollY);
    }, 300);
  }
  
  function selectLanguage(lang) {
    closeDropdown();
    
    if (!LANGS[lang]) return;
    if (lang === getCurrentLang()) return;
    
    // Save preference
    try { localStorage.setItem(LS_KEY, lang); } catch (e) {}
    
    // Navigate to language-prefixed URL
    var url = buildLangUrl(lang);
    location.href = url;
  }
  
  // ── Init ───────────────────────────────────────────────────────────────
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
  
})();