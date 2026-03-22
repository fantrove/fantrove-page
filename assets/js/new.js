(function() {
 'use strict';
 
 var URL = '/assets/json/whats-new.json';
 var LANG = function() { return localStorage.getItem('selectedLang') || 'en'; };
 
 var SECTION_META = {
  'new': { labelEn: 'New', labelTh: 'มีอะไรใหม่', color: '#13b47f' },
  'improved': { labelEn: 'Improved', labelTh: 'ปรับปรุง', color: '#3b82f6' },
  'fixed': { labelEn: 'Fixed', labelTh: 'แก้ไขปัญหา', color: '#f59e0b' }
 };
 
 // ── Fetch ──────────────────────────────────────────────────────────────────
 
 function fetchData() {
  return fetch(URL + '?_=' + Date.now(), { cache: 'no-store' })
   .then(function(r) { return r.ok ? r.json() : null; })
   .catch(function() { return null; });
 }
 
 // ── Text helper ────────────────────────────────────────────────────────────
 
 function t(obj) {
  if (!obj) return '';
  var lang = LANG();
  return obj[lang] || obj['en'] || '';
 }
 
 // ── Render ─────────────────────────────────────────────────────────────────
 
 function render(data) {
  if (!data) return;
  
  var titleEl = document.getElementById('title');
  if (titleEl) titleEl.textContent = data.version || '';
  
  var container = document.getElementById('whats-new-container');
  if (!container) return;
  
  container.innerHTML = '';
  container.appendChild(buildRelease(data, true));
 }
 
 function buildRelease(release, isLatest) {
  var wrap = document.createElement('article');
  wrap.className = 'wn-release' + (isLatest ? ' wn-release--latest' : '');
  
  // ── Header ──────────────────────────────────────────────────────────────
  var header = document.createElement('div');
  header.className = 'wn-header';
  
  var badge = document.createElement('span');
  badge.className = 'wn-version-badge';
  badge.textContent = 'v' + (release.version || '');
  header.appendChild(badge);
  
  if (release.date) {
   var date = document.createElement('span');
   date.className = 'wn-date';
   date.textContent = t(release.date);
   header.appendChild(date);
  }
  
  wrap.appendChild(header);
  
  // ── Title ────────────────────────────────────────────────────────────────
  if (release.title) {
   var h2 = document.createElement('h2');
   h2.className = 'wn-title';
   h2.textContent = t(release.title);
   wrap.appendChild(h2);
  }
  
  // ── Subtitle ─────────────────────────────────────────────────────────────
  if (release.subtitle) {
   var sub = document.createElement('p');
   sub.className = 'wn-subtitle';
   sub.textContent = t(release.subtitle);
   wrap.appendChild(sub);
  }
  
  // ── Sections ─────────────────────────────────────────────────────────────
  var sections = release.sections || [];
  sections.forEach(function(section) {
   wrap.appendChild(buildSection(section));
  });
  
  return wrap;
 }
 
 function buildSection(section) {
  var meta = SECTION_META[section.type] || SECTION_META['new'];
  var lang = LANG();
  var label = lang === 'th' ? meta.labelTh : meta.labelEn;
  
  var wrap = document.createElement('div');
  wrap.className = 'wn-section';
  
  // section label
  var head = document.createElement('div');
  head.className = 'wn-section-head';
  
  var dot = document.createElement('span');
  dot.className = 'wn-section-dot';
  dot.style.background = meta.color;
  head.appendChild(dot);
  
  var lbl = document.createElement('span');
  lbl.className = 'wn-section-label';
  lbl.style.color = meta.color;
  lbl.textContent = label;
  head.appendChild(lbl);
  
  wrap.appendChild(head);
  
  // items
  var list = document.createElement('ul');
  list.className = 'wn-items';
  
  (section.items || []).forEach(function(item) {
   var li = document.createElement('li');
   li.className = 'wn-item';
   
   var itemTitle = document.createElement('div');
   itemTitle.className = 'wn-item-title';
   itemTitle.textContent = t(item.title);
   li.appendChild(itemTitle);
   
   if (item.desc) {
    var desc = document.createElement('div');
    desc.className = 'wn-item-desc';
    desc.textContent = t(item.desc);
    li.appendChild(desc);
   }
   
   list.appendChild(li);
  });
  
  wrap.appendChild(list);
  return wrap;
 }
 
 // ── Inject styles ──────────────────────────────────────────────────────────
 
 function injectStyles() {
  if (document.getElementById('wn-styles')) return;
  var s = document.createElement('style');
  s.id = 'wn-styles';
  s.textContent = [
   '#whats-new-container{max-width:640px;margin:0 auto;padding:0 16px 48px}',
   
   '.wn-release{padding:28px 0;border-bottom:1px solid rgba(0,0,0,.08)}',
   '.wn-release:last-child{border-bottom:none}',
   
   '.wn-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
   
   '.wn-version-badge{',
   'display:inline-block;',
   'background:#13b47f;color:#fff;',
   'font-size:11px;font-weight:600;',
   'padding:2px 10px;border-radius:20px;',
   'letter-spacing:.04em',
   '}',
   
   '.wn-date{font-size:12px;color:#888}',
   
   '.wn-title{font-size:1.35em;font-weight:700;margin:0 0 6px;line-height:1.3}',
   '.wn-subtitle{font-size:.9em;color:#555;margin:0 0 20px;line-height:1.6}',
   
   '.wn-section{margin-bottom:18px}',
   
   '.wn-section-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
   '.wn-section-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',
   '.wn-section-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}',
   
   '.wn-items{list-style:none;margin:0;padding:0}',
   
   '.wn-item{',
   'padding:10px 14px;',
   'border-radius:10px;',
   'background:rgba(0,0,0,.03);',
   'margin-bottom:8px',
   '}',
   
   '.wn-item-title{font-size:.9em;font-weight:600;margin-bottom:3px}',
   '.wn-item-desc{font-size:.83em;color:#666;line-height:1.55}',
   
   '@media(prefers-color-scheme:dark){',
   '.wn-release{border-color:rgba(255,255,255,.08)}',
   '.wn-subtitle{color:#aaa}',
   '.wn-date{color:#666}',
   '.wn-item{background:rgba(255,255,255,.05)}',
   '.wn-item-desc{color:#999}',
   '}'
  ].join('');
  document.head.appendChild(s);
 }
 
 // ── Boot ───────────────────────────────────────────────────────────────────
 
 function boot() {
  injectStyles();
  
  fetchData().then(function(data) {
   if (data) render(data);
  });
 }
 
 // re-render เมื่อเปลี่ยนภาษา
 window.addEventListener('languageChange', function() {
  fetchData().then(function(data) {
   if (data) render(data);
  });
 });
 
 if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
 } else {
  boot();
 }
 
})();