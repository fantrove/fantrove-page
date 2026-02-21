/**
 * Language Proxy - State-Driven Version
 * - ทำงานร่วมกับ language.min.js แบบ state-driven
 * - ไม่ทำ aggressive redirect ใน production อีกต่อไป
 * - ปล่อยให้ language.min.js จัดการ history state เอง
 */

(function() {
  try {
    const isLocalDev = () => {
      const host = location.hostname || '';
      return !host || host === 'localhost' || host === '127.0.0.1' || 
             host === '0.0.0.0' || host.endsWith('.local') ||
             ['3000','5173','7700','8080','3001'].includes(String(location.port));
    };

    // ถ้าเป็น local dev → ไม่ทำอะไรเลย
    if (isLocalDev()) return;

    const path = location.pathname;
    const langMatch = path.match(/^\/(en|th)(\/|$)/i);
    
    // กรณีมี lang prefix ใน URL → บันทึกลง localStorage และ session
    if (langMatch) {
      const lang = langMatch[1].toLowerCase();
      
      // บันทึกภาษา
      try {
        localStorage.setItem('selectedLang', lang);
        sessionStorage.setItem('fv-initial-lang', lang);
      } catch (e) {}
      
      // ตรวจสอบว่าเคย proxy แล้วหรือยัง (ป้องกัน loop)
      const sessionKey = 'fv-proxy-done:' + lang + ':' + path;
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, '1');
      
      // Strip prefix และ fetch เนื้อหาจริง
      const targetPath = path.substring(lang.length + 1) || '/';
      
      // ลอง fetch หลาย candidate
      const candidates = [
        targetPath,
        targetPath + (targetPath.endsWith('/') ? '' : '/') + 'index.html',
        '/index.html'
      ];
      
      (async function fetchContent() {
        for (const url of candidates) {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) continue;
            
            const html = await res.text();
            
            // Inject ตัวจัดการภาษาเข้าไปใน HTML ก่อนเขียน
            const modifiedHtml = html.replace(
              '</head>',
              `<script>window.__INITIAL_LANG__ = '${lang}';</script></head>`
            );
            
            document.open();
            document.write(modifiedHtml);
            document.close();
            
            // บันทึก history state เริ่มต้น
            try {
              history.replaceState({
                language: lang,
                previousLanguage: lang,
                timestamp: Date.now(),
                path: path
              }, '', location.pathname + location.search + location.hash);
            } catch (e) {}
            
            return;
          } catch (e) {}
        }
        
        // ถ้า fetch ไม่ได้ → redirect ไปหน้าต้นฉบับ
        location.replace(targetPath);
      })();
      
      return;
    }
    
    // กรณีไม่มี lang prefix → ตรวจสอบ localStorage
    (function checkStoredLang() {
      let storedLang = null;
      try {
        storedLang = localStorage.getItem('selectedLang');
      } catch (e) {}
      
      if (!storedLang || storedLang === 'en') return;
      
      // ป้องกัน redirect loop
      const checkKey = 'fv-check-prefix:' + storedLang + ':' + path;
      if (sessionStorage.getItem(checkKey)) return;
      sessionStorage.setItem(checkKey, '1');
      
      // ตรวจสอบว่ามี prefixed version หรือไม่
      const prefixedPath = '/' + storedLang + (path === '/' ? '' : path);
      
      fetch(prefixedPath, { method: 'HEAD', cache: 'no-store' })
        .then(res => {
          if (res.ok) {
            // มี prefixed version → redirect ไปที่นั่น
            const newUrl = prefixedPath + location.search + location.hash;
            location.replace(newUrl);
          }
        })
        .catch(() => {
          // ไม่มี prefixed version → อยู่หน้านี้ต่อ ให้ language.min.js จัดการ
        });
    })();
    
  } catch (err) {
    console.error('lang-proxy error:', err);
  }
})();
