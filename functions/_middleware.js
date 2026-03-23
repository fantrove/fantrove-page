/**
 * @file functions/_middleware.js
 * Cloudflare Pages Function — ตั้งค่า <html lang="..."> ที่ server ก่อน HTML ถูกส่งออก
 *
 * ทำงานยังไง:
 *   ทุก request ที่ Cloudflare รับ → middleware นี้รันก่อน → ดู URL prefix (/en/ หรือ /th/)
 *   → ใช้ HTMLRewriter แก้ lang attribute ใน <html> tag → ส่ง HTML ที่แก้แล้วไปยัง browser
 *
 * ผลลัพธ์:
 *   - crawler, Google, Cloudflare language detection เห็น lang ที่ถูกต้องทันที
 *   - ไม่ต้องรอ JavaScript รัน
 *   - ใช้ร่วมกับ inline script ใน <head> เป็น defense-in-depth
 *
 * การ deploy:
 *   วางไฟล์นี้ไว้ที่ functions/_middleware.js ในโปรเจกต์
 *   Cloudflare Pages จะ pick up อัตโนมัติ ไม่ต้อง config อะไรเพิ่ม
 */

const SUPPORTED_LANGS = ['en', 'th'];
const DEFAULT_LANG = 'en';
const LANG_RE = /^\/(en|th)(\/|$)/;

export async function onRequest({ request, next }) {
  const response = await next();
  
  // แก้เฉพาะ HTML responses — ข้าม assets, API, etc.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  
  // ดึง lang จาก URL path
  const url = new URL(request.url);
  const m = url.pathname.match(LANG_RE);
  const lang = (m && SUPPORTED_LANGS.includes(m[1])) ? m[1] : DEFAULT_LANG;
  
  // HTMLRewriter: แก้ lang attribute ใน <html> tag
  return new HTMLRewriter()
    .on('html', {
      element(el) {
        el.setAttribute('lang', lang);
      },
    })
    .transform(response);
}