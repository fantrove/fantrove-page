/**
 * @file functions/_middleware.js
 * Cloudflare Pages Function — ตั้งค่า lang attribute และ Content-Language header
 * ก่อน HTML ถูกส่งออก (server-side)
 *
 * v2 (1.0.8):
 *   - เพิ่ม Content-Language HTTP header
 *     ทำให้ Chrome เห็น signal ภาษาจาก 2 แหล่งพร้อมกัน:
 *       1. <html lang="th">     ← attribute ใน HTML
 *       2. Content-Language: th ← HTTP response header
 *     เมื่อทั้งสองตรงกัน Chrome จะเชื่อว่าหน้านี้เป็นภาษา th
 *     แม้ว่า CLD3 (content-based detection) จะ detect ต่างออกไปก็ตาม
 *
 * การ deploy:
 *   วางไฟล์นี้ที่ functions/_middleware.js (root ของโปรเจกต์)
 *   Cloudflare Pages จะ pick up อัตโนมัติ
 */

const SUPPORTED_LANGS = ['en', 'th'];
const DEFAULT_LANG = 'en';
const LANG_RE = /^\/(en|th)(\/|$)/;

export async function onRequest({ request, next }) {
  const response = await next();
  
  // แก้เฉพาะ HTML responses
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  
  // ดึง lang จาก URL path
  const url = new URL(request.url);
  const m = url.pathname.match(LANG_RE);
  const lang = (m && SUPPORTED_LANGS.includes(m[1])) ? m[1] : DEFAULT_LANG;
  
  // HTMLRewriter: แก้ lang attribute ใน <html> tag
  const rewritten = new HTMLRewriter()
    .on('html', {
      element(el) {
        el.setAttribute('lang', lang);
      },
    })
    .transform(response);
  
  // เพิ่ม Content-Language header บน response ใหม่
  // (HTMLRewriter คืน Response ที่ headers เป็น immutable ต้อง wrap ใหม่)
  const headers = new Headers(rewritten.headers);
  headers.set('Content-Language', lang);
  
  return new Response(rewritten.body, {
    status: rewritten.status,
    statusText: rewritten.statusText,
    headers,
  });
}