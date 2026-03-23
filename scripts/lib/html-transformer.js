'use strict';

/**
 * html-transformer.js
 * Applies translations to a parsed HTML document using cheerio.
 *
 * Mirrors the reconciliation logic from translator.js but outputs HTML strings
 * instead of manipulating a live DOM.
 */

const cheerio = require('cheerio');
const { parseTranslation, normalizeParts } = require('./marker-parser');

// ── Build config (injected from build.js) ─────────────────────────────────
let _config = null;
function setConfig(cfg) { _config = cfg; }

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Transform a full HTML document for a given language.
 *
 * Steps:
 *  1.  Set <html lang="..">
 *  2.  Apply translations to all [data-translate] elements
 *  3.  Remove data-translate / data-original-text / data-original-style attrs
 *  4.  Remove language system scripts (lang-proxy, language.js, etc.)
 *  5.  Remove body opacity:0 (JS fade-in no longer needed)
 *  6.  Add hreflang + canonical for SEO
 *  7.  Prefix un-prefixed internal links with /{lang}
 *
 * @param {string}  html          — source HTML string
 * @param {string}  lang          — target language code ('en', 'th', …)
 * @param {Object}  translations  — flat key→value translation map
 * @param {string}  srcFilePath   — original file path (for canonical URL derivation)
 * @returns {string} transformed HTML
 */
function transformHtml(html, lang, translations, srcFilePath) {
  const $ = cheerio.load(html, {
    decodeEntities: false,
    xmlMode: false,
  });

  // ── 1. Language attribute ─────────────────────────────────────────────
  $('html').attr('lang', lang);

  // ── 2 & 3. Translations + attribute cleanup ───────────────────────────
  $('[data-translate]').each((_, el) => {
    const $el = $(el);
    const key = $el.attr('data-translate');

    if (key && translations[key]) {
      const rawParts = parseTranslation(translations[key]);
      const parts    = normalizeParts(rawParts);
      const newHtml  = _partsToHtml($, $el, parts);
      $el.html(newHtml);
    }
    // Always strip translation-specific attributes
    $el.removeAttr('data-translate');
    $el.removeAttr('data-original-text');
    $el.removeAttr('data-original-style');
    $el.removeAttr('data-translate-slot');
  });

  // ── 4. Remove language system scripts + inject minimal switcher ─────
  let   _injected   = false;
  let   _lastLangScript = null;

  $('script').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') || '';

    const isLangScript = (_config.langScriptPatterns || []).some(p => src.includes(p));
    if (isLangScript) {
      _lastLangScript = $el;
      $el.remove();
    }
  });

  // Inject lang-switch-minimal.js after the last removed lang script position.
  // We use the body's last script as fallback insertion point.
  // The script is only injected once per page.
  if (!_injected) {
    const switcherSrc = '/assets/js/lang-switch-minimal.js';
    // Avoid double-injection if already present (shouldn't happen, but safe)
    if (!$(`script[src*="lang-switch-minimal"]`).length) {
      const tag = `<script src="${switcherSrc}"></script>`;
      // Append before </body> closing
      const lastScript = $('body script').last();
      if (lastScript.length) {
        lastScript.after(tag);
      } else {
        $('body').append(tag);
      }
    }
    _injected = true;
  }

  // ── 4b. Translate <title data-translate="..."> ────────────────────────
  const $title = $('title[data-translate]');
  if ($title.length) {
    const key = $title.attr('data-translate');
    if (key && translations[key]) {
      // Title should be plain text only
      const plainText = translations[key]
        .replace(/@br/g, ' ')
        .replace(/@strong(.*?)@/g, '$1')
        .replace(/@[^@]+@/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      $title.text(plainText).removeAttr('data-translate');
    }
  }

  // ── 5. Remove opacity:0 from body ─────────────────────────────────────
  const $body = $('body');
  let bodyStyle = $body.attr('style') || '';
  // Remove only the opacity rule, keep other inline styles if any
  bodyStyle = bodyStyle
    .replace(/opacity\s*:\s*0\s*;?/gi, '')
    .trim()
    .replace(/;$/, '');
  if (bodyStyle) {
    $body.attr('style', bodyStyle);
  } else {
    $body.removeAttr('style');
  }

  // ── 6. SEO: hreflang + canonical ──────────────────────────────────────
  const canonPath = _deriveCanonicalPath(srcFilePath);
  if (canonPath) {
    $('link[hreflang]').remove();
    $('link[rel="canonical"]').remove();

    const langs = _config.langs || ['en'];
    const head  = $('head');

    langs.forEach(l => {
      head.append(`<link rel="alternate" hreflang="${l}" href="/${l}${canonPath}" />\n`);
    });
    // x-default points to default language version
    head.append(`<link rel="alternate" hreflang="x-default" href="/${_config.defaultLang}${canonPath}" />\n`);
    head.append(`<link rel="canonical" href="/${lang}${canonPath}" />\n`);
  }

  // ── 7. Prefix un-prefixed internal links ──────────────────────────────
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';

    if (_isInternalPath(href) && !_hasLangPrefix(href) && _shouldPrefix(href)) {
      $el.attr('href', `/${lang}${href.startsWith('/') ? href : '/' + href}`);
    }
  });

  return $.html();
}

// ── Translation → HTML string ─────────────────────────────────────────────

/**
 * Convert a normalized parts array to an HTML string, reusing existing
 * SVG / slot / anchor elements from the current element's children.
 *
 * @param {CheerioStatic} $
 * @param {Cheerio}       $el    — the element being translated
 * @param {Array<Object>} parts  — normalized parts
 * @returns {string}
 */
function _partsToHtml($, $el, parts) {
  // Snapshot existing special children
  const svgs    = $el.find('svg').toArray();
  const slots   = $el.find('[data-translate-slot],[data-slot]').toArray();
  const anchors = $el.find('a').toArray();

  const usedSvgs    = new Set();
  const usedSlots   = new Set();
  const usedAnchors = new Set();

  function resolveSvg(id) {
    const pool = svgs.filter(s => !usedSvgs.has(s));
    let found = null;
    if (id) {
      found = pool.find(s =>
        $(s).attr('id') === id || $(s).attr('data-svg-id') === id
      ) || null;
    }
    if (!found && pool.length) found = pool[0];
    if (found) { usedSvgs.add(found); return found; }
    return null;
  }

  function resolveSlot(name) {
    const pool = slots.filter(s => !usedSlots.has(s));
    let found = null;
    if (name) {
      found = pool.find(s =>
        $(s).attr('data-translate-slot') === name ||
        $(s).attr('data-slot') === name
      ) || null;
    } else if (pool.length === 1) {
      found = pool[0];
    }
    if (found) { usedSlots.add(found); return found; }
    return null;
  }

  function resolveAnchor() {
    const pool = anchors.filter(a => !usedAnchors.has(a));
    if (!pool.length) return null;
    usedAnchors.add(pool[0]);
    return pool[0];
  }

  // If SVGs exist but parts have no explicit SVG marker → prepend them
  const hasExplicitSvg = parts.some(p => p.type === 'svg' || p.type === 'lsvg');
  let html = '';

  if (!hasExplicitSvg && svgs.length > 0) {
    svgs.forEach(svg => {
      html += $.html($(svg));
      usedSvgs.add(svg);
    });
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
        if (el) {
          html += $.html($(el));
        }
        // If no SVG found, skip (don't create empty placeholder for static HTML)
        break;
      }

      case 'slot': {
        const el = resolveSlot(part.name);
        if (el) {
          html += $.html($(el));
        }
        break;
      }

      case 'a': {
        const el = resolveAnchor();
        if (el) {
          const $a = $(el).clone();
          if (part.translate && part.text != null) {
            $a.text(part.text);
          }
          html += $.html($a);
        } else {
          // Fallback: bare anchor
          html += `<a>${part.translate ? _escHtml(part.text || '') : ''}</a>`;
        }
        break;
      }

      default:
        // Unknown marker type → emit nothing in static build
        break;
    }
  }

  return html;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function _deriveCanonicalPath(srcFilePath) {
  if (!srcFilePath) return null;

  // Normalise: remove leading './' and strip 'index.html'
  let p = srcFilePath.replace(/\\/g, '/').replace(/^\.\//, '');

  // Remove the filename part (index.html → directory path)
  p = p.replace(/index\.html$/, '').replace(/\.html$/, '/');

  if (!p.startsWith('/')) p = '/' + p;

  // Remove trailing slash unless it's just '/'
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
  const SKIP = ['/assets/', '/static/', '/api/', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sw.js', '/manifest.json'];
  if (!path.startsWith('/')) return false;
  return !SKIP.some(s => path.startsWith(s));
}

module.exports = { transformHtml, setConfig };