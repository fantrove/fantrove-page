/**
 * @file version-core.js — Fantrove Verse
 * @version 5.1
 * @description ระบบแจ้งเตือนอัพเดทเวอร์ชันใหม่
 *
 * อ่าน `/assets/md/{lang}/current.md` เพื่อตรวจสอบเวอร์ชันล่าสุด,
 * เปรียบเทียบกับเวอร์ชันที่ผู้ใช้ dismiss แล้ว,
 * และแสดง popup แจ้งอัพเดทผ่าน `PopupSystem.open()` หากมีเวอร์ชันใหม่
 *
 * **Fallback chain:** per-language MD → legacy MD → whats-new.json
 *
 * @requires PopupSystem (window.PopupSystem) — สำหรับแสดง popup
 * @requires FvLang (window.FvLang) — สำหรับตรวจภาษาปัจจุบัน (optional, fallback to localStorage)
 *
 * @example
 * // ระบบทำงานอัตโนมัติเมื่อโหลด — ไม่ต้องเรียก manual
 * // แต่สามารถตรวจสอบสถานะได้:
 * localStorage.getItem('fv_dismissed_v1.6.1') // '1' = ผู้ใช้ dismiss แล้ว
 * localStorage.getItem('fv_noupdate')          // '1' = ปิดการแจ้งเตือน
 *
 * @used-by home/index.html, setting/index.html และหน้าอื่นๆ ที่มี `<script>` tag
 */

(function () {
  'use strict';

  var CFG = {
    CURRENT_MD_PERLANG: '/assets/md/{lang}/current.md',
    CURRENT_MD_LEGACY:  '/assets/md/current.md',
    LEGACY_JSON_URL:    '/assets/json/whats-new.json',
    WHATS_NEW_PAGE:     '/platform/whats_new/',
    KEY_SHOWN_BUILD:    'fv_shown_build',
    KEY_DISMISSED:      'fv_dismissed_v',
    KEY_DISABLE:        'fv_noupdate',
    SS_SHOWN:           'fv_ss_shown_',
    SS_LAST_ACTIVE:     'fv_last_active',
    IDLE_MS:            90 * 60 * 1000,
    TOGGLE_ID:          'auto-update-toggle-btn',
    SWITCH_ID:          'auto-update-switch',
    POPUP_GROUP:        'update-notification'
  };

  var SUPPORTED_LANGS = ['en', 'th'];

  function isOnWhatsNewPage() { var m = document.querySelector('meta[name="fv-page"]'); return m && m.getAttribute('content') === 'whats-new'; }
  function ls(k)       { try { return localStorage.getItem(k);   } catch(e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v);       } catch(e) {} }
  function ss(k)       { try { return sessionStorage.getItem(k); } catch(e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v);     } catch(e) {} }
  function isDisabled()      { return ls(CFG.KEY_DISABLE) === '1'; }
  function setDisabled(v)    { lsSet(CFG.KEY_DISABLE, v ? '1' : '0'); }
  function isDismissed(ver)  { return ls(CFG.KEY_DISMISSED + ver) === '1'; }
  function setDismissed(ver) { lsSet(CFG.KEY_DISMISSED + ver, '1'); }
  function isSessionFresh(b) { if (ss(CFG.SS_SHOWN+b) !== '1') return true; var l = parseInt(ss(CFG.SS_LAST_ACTIVE)||'0',10); return !l || (Date.now()-l) >= CFG.IDLE_MS; }
  function markSession(b)    { ssSet(CFG.SS_SHOWN+b, '1'); ssSet(CFG.SS_LAST_ACTIVE, String(Date.now())); }
  function updateLastActive(){ ssSet(CFG.SS_LAST_ACTIVE, String(Date.now())); }

  // v5.0: ใช้ FvLang.lang เป็น primary, fallback to localStorage
  function getLang() {
    try { 
      if (window.FvLang && FvLang.lang) return FvLang.lang;
      var l = ls('selectedLang') || 'en'; return SUPPORTED_LANGS.indexOf(l) >= 0 ? l : 'en'; 
    } catch(e) { return 'en'; }
  }

  function fetchText(url) { return fetch(url + '?_=' + Date.now(), { cache: 'no-store' }).then(function(r) { return r.ok ? r.text() : null; }).catch(function() { return null; }); }
  function fetchJSON(url) { return fetch(url + '?_=' + Date.now(), { cache: 'no-store' }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }); }

  // ── MD Parser (per-language mode) ────────────────────────────────────────────

  function parseMD(mdText, lang) {
    var result = { version: '', date: null, title: null, subtitle: null, notify: true, sections: [] };
    try {
      var body = mdText;
      var fmMatch = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      if (fmMatch) {
        body = mdText.substring(fmMatch[0].length);
        var fm = fmMatch[1];
        var vM = fm.match(/^version:\s*(.+)$/m); if (vM) result.version = String(vM[1]).trim();
        var dM = fm.match(/^date:\s*(.+)$/m); if (dM) { var p = Date.parse(String(dM[1]).trim()); if (!isNaN(p)) result.date = new Date(p).toISOString(); }
        var nM = fm.match(/^notify:\s*(false|true)$/m); if (nM) result.notify = nM[1] !== 'false';
        // title
        var tB = fm.match(/^(title:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
        if (tB) result.title = _parseI18n(tB[2]);
        else { var tL = fm.match(/^title:\s*(.+)$/m); if (tL) { var tv = String(tL[1]).trim(); result.title = lang ? _w(tv,lang) : {en:tv}; } }
        // subtitle
        var sB = fm.match(/^(subtitle:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
        if (sB) result.subtitle = _parseI18n(sB[2]);
        else { var sL = fm.match(/^subtitle:\s*(.+)$/m); if (sL) { var sv = String(sL[1]).trim(); result.subtitle = lang ? _w(sv,lang) : {en:sv}; } }
      }
      var lines = body.split('\n'), cs = null, ci = null;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i], hm = line.match(/^###\s+(New|Improved|Fixed)\s*$/i);
        if (hm) { if (cs) result.sections.push(cs); cs = { type: hm[1].toLowerCase(), items: [] }; ci = null; continue; }
        if (line.match(/^\s*-\s+\*\*/)) { if (ci && cs) cs.items.push(ci); ci = _parseItem(line, lang); continue; }
        if (ci && line.trim() && !line.match(/^---/) && !line.match(/^###/)) {
          if (!ci.desc) ci.desc = lang ? _w('',lang) : {en:''};
          var k = lang || 'en'; ci.desc[k] += (ci.desc[k] ? ' ' : '') + line.trim();
        }
      }
      if (ci && cs) cs.items.push(ci);
      if (cs) result.sections.push(cs);
    } catch(e) {}
    return result;
  }
  function _w(v,lang) { var o = {}; o[lang] = v; return o; }
  function _parseI18n(b) { var o = {}; var r = /^\s+(\w+):\s*(.+)$/gm; var m; while ((m=r.exec(b))!==null) o[m[1]]=m[2].trim(); return Object.keys(o).length?o:null; }
  function _parseItem(line,lang) {
    var item = { title: {}, desc: null };
    var m = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*(.*)?$/);
    if (m) {
      item.title = lang ? _w(m[1].trim(),lang) : {en:m[1].trim(),th:m[1].trim()};
      if (m[2]&&m[2].trim()) item.desc = lang ? _w(m[2].trim(),lang) : {en:m[2].trim(),th:m[2].trim()};
    }
    return item;
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function t(obj) { if(!obj) return ''; if(typeof obj==='string') return obj; var lang=getLang(); return esc(obj[lang]||obj['en']||''); }

  // ── Build popup content ─────────────────────────────────────────────────────

  function buildContent(wn) {
    var isTh = getLang() === 'th', ver = esc(wn.version||'');
    var dateStr = wn.date ? (isTh ? esc(wn.date.th) : esc(wn.date.en)) : '';
    var title = t(wn.title);
    var sub = t(wn.subtitle) || (isTh ? 'มีการปรับปรุงและอัปเดตระบบ' : 'System improvements and updates.');
    var items = [];
    (wn.sections||[]).forEach(function(s) { (s.items||[]).slice(0,4).forEach(function(item) { var txt=t(item.title); if(txt) items.push(txt); }); });
    var L = { badge: isTh?'อัพเดทใหม่':'New update', ver: isTh?'เวอร์ชัน ':'Version ', more: isTh?'ดูรายละเอียด':"See what's new", dismiss: isTh?'ไม่แสดงอีกสำหรับการอัพเดทนี้':"Don't show again for this update" };
    var itemsHTML = '';
    if (items.length) { itemsHTML='<ul class="fv-update-list">'; items.forEach(function(i){itemsHTML+='<li class="fv-update-item"><span class="fv-update-dot"></span>'+i+'</li>';}); itemsHTML+='</ul>'; }
    var html = '<div class="fv-update-header"><div class="fv-update-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></div><div class="fv-update-info"><div class="fv-update-badge">'+L.badge+'</div><div class="fv-update-version">'+L.ver+ver+(title?' \u2014 '+title:'')+'</div>'+(dateStr?'<div class="fv-update-date">'+dateStr+'</div>':'')+'</div></div>'
      +(sub?'<p class="fv-update-sub">'+sub+'</p>':'')+itemsHTML
      +'<a href="'+CFG.WHATS_NEW_PAGE+'" class="fv-update-cta">'+L.more+'</a><div class="fv-update-dismiss-wrap"><button class="fv-update-dismiss-btn" data-fp-action="dismiss">'+L.dismiss+'</button></div>';
    return {html:html, version:wn.version};
  }

  var _si = false;
  function injectStyles() {
    if (_si) return; _si = true;
    var css='.fv-update-header{display:flex;align-items:center;gap:12px;margin-bottom:14px}.fv-update-icon{width:40px;height:40px;border-radius:12px;flex-shrink:0;background:linear-gradient(135deg,#13b47f,#0d8f65);display:flex;align-items:center;justify-content:center}.fv-update-info{min-width:0}.fv-update-badge{font-size:.95em;font-weight:600;color:var(--fv-text-primary,#111)}.fv-update-version{font-size:.78em;color:#13b47f;font-weight:500;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fv-update-date{font-size:.72em;color:var(--fv-text-tertiary,#aaa);margin-top:2px}.fv-update-sub{font-size:.85em;color:var(--fv-text-secondary,#666);margin:0 0 14px;line-height:1.55}.fv-update-list{list-style:none;margin:0 0 16px;padding:0}.fv-update-item{display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:.85em;color:var(--fv-text-secondary,#555);line-height:1.5}.fv-update-dot{flex-shrink:0;margin-top:5px;width:6px;height:6px;border-radius:50%;background:#13b47f;display:inline-block}.fv-update-cta{display:block;width:100%;padding:11px 0;background:linear-gradient(135deg,#13b47f,#0d8f65);color:#fff!important;border-radius:11px;font-size:.95em;font-weight:600;text-align:center;text-decoration:none!important;box-shadow:0 2px 12px rgba(19,180,127,.35);margin-bottom:10px;transition:transform .15s ease,box-shadow .15s ease}.fv-update-cta:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(19,180,127,.45)}.fv-update-dismiss-wrap{text-align:center}.fv-update-dismiss-btn{border:none;background:none;cursor:pointer;font-size:.78em;color:var(--fv-text-tertiary,#aaa);font-family:inherit;padding:4px 8px;border-radius:5px;transition:color .15s}.fv-update-dismiss-btn:hover{color:var(--fv-text-secondary,#666)}';
    css+='.fp-theme-dark .fv-update-badge{color:var(--fv-text-primary,#f5f5f7)}.fp-theme-dark .fv-update-sub{color:var(--fv-text-secondary,#aeaeb2)}.fp-theme-dark .fv-update-item{color:var(--fv-text-secondary,#aeaeb2)}.fp-theme-dark .fv-update-date{color:var(--fv-text-tertiary,#636366)}.fp-theme-dark .fv-update-dismiss-btn{color:var(--fv-text-tertiary,#636366)}.fp-theme-dark .fv-update-dismiss-btn:hover{color:var(--fv-text-secondary,#aeaeb2)}';
    var s=document.createElement('style');s.id='fv-update-styles';s.textContent=css;document.head.appendChild(s);
  }

  function showPopup(wn,buildId) {
    if(typeof window.PopupSystem==='undefined'||!window.PopupSystem._initialized){window.addEventListener('fp:ready',function(){_doShow(wn,buildId);},{once:true});setTimeout(function(){if(typeof window.PopupSystem==='undefined')console.warn('[version-core] PopupSystem not available');},5000);return;}
    _doShow(wn,buildId);
  }
  function _doShow(wn,buildId) {
    lsSet(CFG.KEY_SHOWN_BUILD,buildId); markSession(buildId); injectStyles();
    var c=buildContent(wn);
    PopupSystem.open({id:'fv-update-'+wn.version,type:'dialog',title:null,body:c.html,size:'sm',position:'center',group:CFG.POPUP_GROUP,blocking:true,closable:true,theme:'light',
      onMount:function(el,h){var a=el.querySelector('.fv-update-cta');if(a)a.addEventListener('click',function(){h.close({action:'navigate'});});var d=el.querySelector('[data-fp-action="dismiss"]');if(d)d.addEventListener('click',function(){setDismissed(wn.version);h.close({action:'dismissed'});});},
      onClose:function(){}
    });
  }

  function setupToggle(){var b=document.getElementById(CFG.TOGGLE_ID),s=document.getElementById(CFG.SWITCH_ID);if(!b||!s)return;s.checked=!isDisabled();function a(){setDisabled(!s.checked);}s.addEventListener('change',a);b.addEventListener('click',function(e){if(e.target!==s){s.checked=!s.checked;a();}});}
  function trySetupToggle(){if(document.getElementById(CFG.TOGGLE_ID))setupToggle();else setTimeout(trySetupToggle,50);}

  function initWithRelease(wn) {
    if(!wn||!wn.version)return;
    var bid=wn.version,sb=ls(CFG.KEY_SHOWN_BUILD);
    if(wn.notify===false)return; if(isDismissed(bid))return;
    if(sb!==bid||isSessionFresh(bid)) showPopup(wn,bid);
  }

  function init() {
    updateLastActive(); if(isOnWhatsNewPage())return; if(isDisabled())return;
    var lang = getLang();
    var perLangUrl = CFG.CURRENT_MD_PERLANG.replace('{lang}', lang);

    // ลอง per-language MD → legacy MD → JSON
    fetchText(perLangUrl).then(function(mdText) {
      if(mdText && mdText.trim()) { var p=parseMD(mdText,lang); if(p.version){initWithRelease(p);return;} }
      return fetchText(CFG.CURRENT_MD_LEGACY);
    }).then(function(mdText) {
      if(mdText && !document.querySelector('[data-fp-popup]')) { var p=parseMD(mdText,null); if(p.version){initWithRelease(p);return;} }
      return fetchJSON(CFG.LEGACY_JSON_URL);
    }).then(function(json) {
      if(json && json.version && !document.querySelector('[data-fp-popup]')) initWithRelease(json);
    });
  }

  trySetupToggle();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();