/**
 * @file functions/_middleware.js
 * Cloudflare Pages Function — จัดการ language signal ครบทุกชั้น (v3.1, 1.0.9)
 *
 * เพิ่มความแข็งแกร่งจาก v3:
 *   - เพิ่ม class="notranslate" บน <html> และ <body>
 *     Chrome เก่า (pre-2019) และ Edge บางเวอร์ชันดู class นี้แทน attribute
 *   - เพิ่ม X-Robots-Tag: notranslate header
 *     ป้องกัน Google crawler แปล snippet ใน search results
 *   - เพิ่ม <meta http-equiv="Content-Language"> ใน head
 *     signal เพิ่มเติมสำหรับ browser และ proxy เก่าที่อ่าน meta แทน header
 *
 * สิ่งที่ middleware ทำต่อ HTML response ทุกชิ้น:
 *   HTML:
 *     1. <html lang="th">
 *     2. <html translate="no">
 *     3. <html class="... notranslate">         ← ใหม่: Chrome เก่า
 *     4. <body class="... notranslate">         ← ใหม่: Chrome เก่า + Edge
 *     5. <meta name="google" content="notranslate">
 *     6. <meta name="googlebot" content="notranslate">
 *     7. <meta http-equiv="Content-Language" content="th">  ← ใหม่
 *
 *   HTTP Headers:
 *     8.  Content-Language: th
 *     9.  X-Robots-Tag: notranslate              ← ใหม่: Google crawler
 */

const SUPPORTED_LANGS = ['en', 'th'];
const DEFAULT_LANG = 'en';
const LANG_RE = /^\/(en|th)(\/|$)/;

export async function onRequest({ request, next }) {
  const response = await next();
  
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  
  const url = new URL(request.url);
  const m = url.pathname.match(LANG_RE);
  const lang = (m && SUPPORTED_LANGS.includes(m[1])) ? m[1] : DEFAULT_LANG;
  
  const metaTags = [
    `<meta name="google" content="notranslate">`,
    `<meta name="googlebot" content="notranslate">`,
    `<meta http-equiv="Content-Language" content="${lang}">`,
  ].join('');
  
  const rewritten = new HTMLRewriter()
    // ── <html> tag ───────────────────────────────────────────────────────────
    .on('html', {
      element(el) {
        el.setAttribute('lang', lang);
        el.setAttribute('translate', 'no');
        
        // เพิ่ม notranslate เข้า class list โดยไม่ลบ class เดิม
        const existing = el.getAttribute('class') || '';
        if (!existing.includes('notranslate')) {
          el.setAttribute('class', (existing ? existing + ' ' : '') + 'notranslate');
        }
      },
    })
    // ── <head> — inject meta tags ──────────────────────────────────────────
    .on('head', {
      element(el) {
        el.prepend(metaTags, { html: true });
      },
    })
    // ── <body> — เพิ่ม notranslate class ──────────────────────────────────
    .on('body', {
      element(el) {
        const existing = el.getAttribute('class') || '';
        if (!existing.includes('notranslate')) {
          el.setAttribute('class', (existing ? existing + ' ' : '') + 'notranslate');
        }
      },
    })
    .transform(response);
  
  const headers = new Headers(rewritten.headers);
  headers.set('Content-Language', lang);
  headers.set('X-Robots-Tag', 'notranslate');
  
  return new Response(rewritten.body, {
    status: rewritten.status,
    statusText: rewritten.statusText,
    headers,
  });
}