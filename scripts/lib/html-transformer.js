'use strict';

/**
 * html-transformer.js  v2.0
 * Applies translations to a parsed HTML document using cheerio.
 *
 * ความแตกต่างจาก v1:
 *
 *  v1: ลบ language.js ออก แล้ว inject lang-switch-minimal.js แทน
 *      → ปัญหา: ต้องดูแล 2 codebase แยกกัน
 *
 *  v2: เก็บ language.js ไว้ทั้งหมด แต่เพิ่ม 2 สิ่ง:
 *
 *   1. `data-fv-built="[lang]"` ใน <html>
 *      → language.js ตรวจจับ flag นี้ → เข้า "static mode"
 *        (skip translation + network fetch, คงแค่ UI dropdown ที่ redirect)
 *
 *   2. <script>window.__fvStaticConfig={...}</script> ใน <head>
 *      → ส่ง language config ที่ language.js ต้องการ
 *        โดยไม่ต้อง fetch db.json จาก network
 *
 *  Scripts ที่ถูกลบออก (ไม่จำเป็นบน pre-built pages):
 *   - lang-proxy.js      URL มี prefix แล้ว ไม่ต้อง redirect อีก
 *   - lang-sync.js       ไม่มี multi-tab sync ที่ต้องทำเพิ่ม
 *   - lang-coordinator.js setting page เท่านั้น, ไม่จำเป็น
 *
 *  Scripts ที่ยังคงอยู่ (ทำงานใน static mode):
 *   - language.js        → static mode: UI dropdown + redirect
 *   - lang-links.js      → prefix links ตามภาษาปัจจุบัน
 *   - ทุก script อื่น    → ไม่แตะ
 */

const cheerio = require('cheerio');
const { parseTranslation, normalizeParts } = require('./marker-parser');

// ── Config (injected from build.js) ───────────────────────────────────────
let _config = null;
function setConfig(cfg) { _config = cfg; }

// ── Public API ────────────────────────────────────────────────────────────

/**
 * @param {string}  html          source HTML
 * @param {string}  lang          target language code
 * @param {Object}  translations  flat key→value translation map
 * @param {string}  srcFilePath   source file path (for canonical URL)
 * @param {Object}  dbJson        full db.json (for static config injection)
 * @returns {string}
 */
function transformHtml(html, lang, translations, srcFilePath, dbJson = {}) {
  const $ = cheerio.load(html, { decodeEntities: false, xmlMode: false });

  // ── 1. <html> attributes ──────────────────────────────────────────────
  // data-fv-built="th" เป็น signal ให้ language.js เข้า static mode
  $('html').attr('lang', lang).attr('data-fv-built', lang);

  // ── 2. Inject window.__fvStaticConfig ────────────────────────────────
  // language.js อ่าน config จากนี้แทน fetch db.json
  // วางไว้เป็น <script> แรกสุดใน <head> เพื่อให้พร้อมก่อน language.js โหลด
  const staticConfig = _buildStaticConfig(lang, dbJson);
  $('head').prepend(
    `<script>window.__fvStaticConfig=${JSON.stringify(staticConfig)};</script>\n`
  );

  // ── 3. Translate [data-translate] elements ────────────────────────────
  $('[data-translate]').each((_, el) => {
    const $el = $(el);
    const key  = $el.attr('data-translate');

    if (key && translations[key]) {
      const parts = normalizeParts(parseTranslation(translations[key]));
      $el.html(_partsToHtml($, $el, parts));
    }

    // Strip attrs — content ถูก bake ลง HTML แล้ว
    $el.removeAttr('data-translate')
       .removeAttr('data-original-text')
       .removeAttr('data-original-style')
       .removeAttr('data-translate-slot');
  });

  // ── 4. Translate <title data-translate="..."> ─────────────────────────
  $('title[data-translate]').each((_, el) => {
    const $el = $(el);
    const key  = $el.attr('data-translate');
    if (key && translations[key]) {
      $el.text(_stripMarkersToText(translations[key])).removeAttr('data-translate');
    }
  });

  // ── 5. Remove scripts that are unneeded on pre-built pages ───────────
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if ((_config.removeScriptPatterns || []).some(p => src.includes(p))) {
      $(el).remove();
    }
  });

  // ── 6. Remove body opacity:0 ──────────────────────────────────────────
  // หน้า built ไม่ต้องรอ JS แปลภาษาก่อนแสดงผล ลบออกเพื่อ UX ที่ดีกว่า
  // language.js static mode จะยัง fade-in ได้เองถ้า opacity ยังอยู่ แต่ไม่จำเป็น
  const $body    = $('body');
  const newStyle = ($body.attr('style') || '')
    .replace(/opacity\s*:\s*0\s*;?\s*/gi, '')
    .trim()
    .replace(/;$/, '');
  if (newStyle) $body.attr('style', newStyle);
  else $body.removeAttr('style');

  // ── 7. SEO hreflang + canonical ────────────────────────────────────────
  _injectSeoTags($, lang, srcFilePath);

  // ── 8. Prefix internal links ──────────────────────────────────────────
  // lang-links.js จะทำงานนี้ใน runtime ด้วย แต่ทำล่วงหน้าเพื่อ SEO crawlers
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    if (_isInternalPath(href) && !_hasLangPrefix(href) && _shouldPrefix(href)) {
      $el.attr('href', `/${lang}${href.startsWith('/') ? href : '/' + href}`);
    }
  });

  return $.html();
}

// ── Static config ─────────────────────────────────────────────────────────

/**
 * Build a minimal config object to embed in the built page.
 * language.js reads this instead of fetching db.json.
 *
 * { lang: 'th', langs: { en: { buttonText, label }, th: { … } } }
 */
function _buildStaticConfig(lang, dbJson) {
  const langs = {};
  for (const [code, cfg] of Object.entries(dbJson)) {
    langs[code] = {
      buttonText: cfg.buttonText || code.toUpperCase(),
      label:      cfg.label      || code.toUpperCase(),
    };
  }
  return { lang, langs };
}

// ── SEO tags ──────────────────────────────────────────────────────────────

function _injectSeoTags($, lang, srcFilePath) {
  const canonPath = _deriveCanonicalPath(srcFilePath);
  if (!canonPath) return;

  $('link[hreflang]').remove();
  $('link[rel="canonical"]').remove();

  const langs    = _config.langs || ['en'];
  const baseUrl  = (_config.baseUrl || '').replace(/\/$/, '');
  const defLang  = _config.defaultLang || 'en';
  const head     = $('head');

  langs.forEach(l => {
    head.append(`<link rel="alternate" hreflang="${l}" href="${baseUrl}/${l}${canonPath}" />\n`);
  });
  head.append(`<link rel="alternate" hreflang="x-default" href="${baseUrl}/${defLang}${canonPath}" />\n`);
  head.append(`<link rel="canonical" href="${baseUrl}/${lang}${canonPath}" />\n`);
}

// ── Translation → HTML string ─────────────────────────────────────────────

/**
 * Convert normalized parts → HTML string.
 * Reuses existing SVG / slot / anchor children from $el (same logic as translator.js).
 */
function _partsToHtml($, $el, parts) {
  const svgs    = $el.find('svg').toArray();
  const slots   = $el.find('[data-translate-slot],[data-slot]').toArray();
  const anchors = $el.find('a').toArray();

  const usedSvgs = new Set(), usedSlots = new Set(), usedAnchors = new Set();

  function resolveSvg(id) {
    const pool = svgs.filter(s => !usedSvgs.has(s));
    const found = id
      ? (pool.find(s => $(s).attr('id') === id || $(s).attr('data-svg-id') === id) || pool[0] || null)
      : (pool[0] || null);
    if (found) { usedSvgs.add(found); return found; }
    return null;
  }

  function resolveSlot(name) {
    const pool = slots.filter(s => !usedSlots.has(s));
    const found = name
      ? (pool.find(s => $(s).attr('data-translate-slot') === name || $(s).attr('data-slot') === name) || null)
      : (pool.length === 1 ? pool[0] : null);
    if (found) { usedSlots.add(found); return found; }
    return null;
  }

  function resolveAnchor() {
    const pool = anchors.filter(a => !usedAnchors.has(a));
    if (!pool.length) return null;
    usedAnchors.add(pool[0]);
    return pool[0];
  }

  // Predicted SVG heuristic (mirrors translator.js):
  // ถ้าไม่มี explicit SVG marker แต่ element มี SVG อยู่ → prepend ไว้ข้างหน้า
  const hasExplicitSvg = parts.some(p => p.type === 'svg' || p.type === 'lsvg');
  let html = '';

  if (!hasExplicitSvg && svgs.length > 0) {
    svgs.forEach(svg => { html += $.html($(svg)); usedSvgs.add(svg); });
  }

  for (const part of parts) {
    switch (part.type) {
      case 'text':
        html += _escHtml(part.text || '');
        break;

      case 'html':
        html += part.html || '';
        break;

      case 'br':
        html += '<br>';
        break;

      case 'strong':
        html += `<strong>${_escHtml(part.text || '')}</strong>`;
        break;

      case 'svg':
      case 'lsvg': {
        const el = resolveSvg(part.id);
        if (el) html += $.html($(el));
        break;
      }

      case 'slot': {
        const el = resolveSlot(part.name);
        if (el) html += $.html($(el));
        break;
      }

      case 'a': {
        const el = resolveAnchor();
        if (el) {
          const $a = $(el).clone();
          if (part.translate && part.text != null) $a.text(part.text);
          html += $.html($a);
        } else {
          html += `<a>${part.translate ? _escHtml(part.text || '') : ''}</a>`;
        }
        break;
      }

      default:
        break;
    }
  }

  return html;
}

// ── Micro helpers ─────────────────────────────────────────────────────────

/** Strip markers → plain text (for <title>) */
function _stripMarkersToText(str) {
  return str
    .replace(/@br/g, ' ')
    .replace(/@strong(.*?)@/g, '$1')
    .replace(/@[a-z]+(?::([^@]*))?@/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function _deriveCanonicalPath(srcFilePath) {
  if (!srcFilePath) return null;
  let p = srcFilePath.replace(/\\/g, '/').replace(/^\.\//, '');
  p = p.replace(/index\.html$/, '').replace(/\.html$/, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p || '/';
}

function _isInternalPath(href) {
  if (!href) return false;
  if (/^(mailto:|tel:|javascript:|data:|#|blob:|file:)/i.test(href)) return false;
  if (/^https?:\/\//i.test(href)) return false;
  return true;
}

function _hasLangPrefix(path) {
  return /^\/(en|th)(\/|$)/.test(path);
}

function _shouldPrefix(path) {
  const SKIP = [
    '/assets/', '/static/', '/api/', '/_next/',
    '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sw.js', '/manifest.json',
  ];
  return path.startsWith('/') && !SKIP.some(s => path.startsWith(s));
}

module.exports = { transformHtml, setConfig };