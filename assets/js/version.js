// ระบบตรวจสอบเวอร์ชันอัตโนมัติ (พร้อมปุ่ม toggle สมัยใหม่ รองรับ SPA, IndexedDB/localStorage, สวิตช์ทำงานทันที)

(function () {
  const VERSION_URL = "/assets/json/version.json";
  const CHECK_INTERVAL = 10000;
  const STORAGE_KEY = "siteVersionContent";
  const UPDATE_DISABLE_KEY = "auto-update-disabled";
  const PROGRESS_BAR_ID = "version-check-progress-bar";
  const POPUP_ID = "version-update-popup";
  const TOGGLE_BTN_ID = "auto-update-toggle-btn";
  const SWITCH_ID = "auto-update-switch";

  let buffered = 0;
  let progress = 0;
  let animating = false;
  let fadeTimeout = null;
  let updateTimer = null;

  // ---- IndexedDB Helper ----
  function setAutoUpdateDisabled(value) {
    if (!window.indexedDB) {
      localStorage.setItem(UPDATE_DISABLE_KEY, value ? "1" : "");
      return;
    }
    const req = indexedDB.open("fantrove-settings", 1);
    req.onupgradeneeded = function (e) {
      let db = e.target.result;
      if (!db.objectStoreNames.contains("settings"))
        db.createObjectStore("settings");
    };
    req.onsuccess = function (e) {
      let db = e.target.result;
      let tx = db.transaction("settings", "readwrite");
      let store = tx.objectStore("settings");
      store.put(value ? "1" : "", UPDATE_DISABLE_KEY);
      tx.oncomplete = function () { db.close(); };
    };
  }
  function getAutoUpdateDisabledSync() {
    // ดึงค่าจาก localStorage ทันที (fallback)
    if (!window.indexedDB) {
      return localStorage.getItem(UPDATE_DISABLE_KEY) === "1";
    }
    // IndexedDB sync access ไม่ได้ ต้องใช้ async แต่สำหรับ instant UX ใช้ localStorage เป็นหลัก
    // หากต้องการแม่นยำแบบ IndexedDB จริงๆ ต้องใช้ async แต่ UX จะไม่ทันใจ
    return localStorage.getItem(UPDATE_DISABLE_KEY) === "1";
  }
  function getAutoUpdateDisabledAsync(cb) {
    if (!window.indexedDB) {
      cb(localStorage.getItem(UPDATE_DISABLE_KEY) === "1");
      return;
    }
    const req = indexedDB.open("fantrove-settings", 1);
    req.onupgradeneeded = function (e) {
      let db = e.target.result;
      if (!db.objectStoreNames.contains("settings"))
        db.createObjectStore("settings");
    };
    req.onsuccess = function (e) {
      let db = e.target.result;
      let tx = db.transaction("settings", "readonly");
      let store = tx.objectStore("settings");
      let getReq = store.get(UPDATE_DISABLE_KEY);
      getReq.onsuccess = function () {
        cb(getReq.result === "1");
        db.close();
      };
      getReq.onerror = function () {
        cb(false);
        db.close();
      };
    };
  }

  // ---- Progress Bar ----
  function createProgressBar() {
    let bar = document.getElementById(PROGRESS_BAR_ID);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = PROGRESS_BAR_ID;
      bar.style.cssText = `
        position: fixed;
        top: 0; left: 0; height: 3px;
        width: 0%;
        background: #4caf50;
        z-index: 9999;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.5s, width 0.2s;
      `;
      document.body.appendChild(bar);
    }
    return bar;
  }
  function showProgressBar() {
    const bar = createProgressBar();
    bar.style.opacity = "1";
  }
  function setProgressBar(val) {
    const bar = createProgressBar();
    bar.style.width = (val * 100) + "%";
  }
  function hideProgressBar() {
    const bar = createProgressBar();
    bar.style.opacity = "0";
    setTimeout(() => { bar.style.width = "0%"; }, 500);
  }
  function animateProgressAuto() {
    if (animating) return;
    animating = true;
    function step() {
      if (progress < buffered) {
        progress = Math.min(progress + 0.008, buffered, 1);
        setProgressBar(progress);
        requestAnimationFrame(step);
      } else if (buffered >= 1) {
        progress = 1;
        setProgressBar(1);
        fadeTimeout = setTimeout(() => {
          hideProgressBar();
          animating = false;
          progress = 0;
          buffered = 0;
        }, 900);
      } else {
        animating = false;
      }
    }
    requestAnimationFrame(step);
  }
  function ensureProgressAnimating() {
    if (!animating) animateProgressAuto();
  }

  async function fetchVersionContentWithProgress() {
    buffered = 0;
    progress = 0;
    showProgressBar();
    setProgressBar(0);
    animateProgressAuto();

    let text = null;
    try {
      for (let step = 1; step <= 5; step++) {
        await new Promise(r => setTimeout(r, 120 + Math.random() * 300));
        buffered = step / 5;
        ensureProgressAnimating();
      }
      const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: "no-store" });
      text = await res.text();
      buffered = 1;
      ensureProgressAnimating();
    } catch (err) {
      buffered = 1;
      ensureProgressAnimating();
      console.warn("[Version Check] Error fetching:", err);
    }
    return text;
  }
  async function fetchVersionContentSilent() {
    try {
      const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: "no-store" });
      return await res.text();
    } catch (err) {
      console.warn("[Version Check] Error fetching:", err);
      return null;
    }
  }

  // ---- Popup ----
  function showUpdatePopup() {
    if (document.getElementById(POPUP_ID)) return;
    const popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.innerHTML = `
      <div style="
        position:fixed;z-index:10000;top:0;left:0;width:100vw;height:100vh;
        background:rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;
      ">
        <div style="
          background: #fff; border-radius: 8px; box-shadow: 0 2px 16px #0002; max-width:90vw;
          padding: 32px 24px; text-align: center; font-size: 1.1em; position:relative;">
          <button id="version-update-close" style="
            position:absolute;top:12px;right:12px;border:none;background:transparent;
            font-size:1.2em;cursor:pointer;color:#888;" aria-label="ปิดแจ้งเตือน">&times;</button>
          <div style="font-size:1.3em;margin-bottom:16px;">เว็บไซต์มีเวอร์ชันใหม่</div>
          <div style="margin-bottom:18px;">กรุณารีเฟรชหน้าเพื่อใช้งานเวอร์ชันล่าสุด</div>
          <button id="version-update-btn" style="
            padding: 8px 24px; font-size:1em; background:#4caf50; color:#fff;
            border:none; border-radius:4px; cursor:pointer;
          ">รีเฟรชหน้า</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
    document.getElementById("version-update-btn").onclick = () => {
      window.location.reload(true);
    };
    document.getElementById("version-update-close").onclick = () => {
      if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
    };
  }

  // ---- Main Logic ----
  async function checkUpdate() {
    const latest = await fetchVersionContentSilent();
    if (!latest) return;
    const current = sessionStorage.getItem(STORAGE_KEY);
    if (latest !== current) {
      sessionStorage.setItem(STORAGE_KEY, latest);
      await fetchVersionContentWithProgress();
      showUpdatePopup();
    }
  }

  function startInterval() {
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(checkUpdate, CHECK_INTERVAL);
  }
  function stopInterval() {
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = null;
  }

  // ---- Toggle Button Logic ----
  function setupToggleBtn() {
    const btn = document.getElementById(TOGGLE_BTN_ID);
    const sw = document.getElementById(SWITCH_ID);
    if (!btn || !sw) return;

    // --- 1) กำหนดสถานะ switch แบบ "ทันที" ด้วยค่า sync (localStorage) ก่อน DOM แสดงผล
    // เพื่อความรู้สึก instant ของผู้ใช้
    const isDisabled = getAutoUpdateDisabledSync();
    sw.checked = !isDisabled;

    // --- 2) เมื่อโหลดเสร็จ sync กับ IndexedDB (async) อีกที เผื่อผู้ใช้เปลี่ยน device/browser
    getAutoUpdateDisabledAsync(function (isDisabledDb) {
      sw.checked = !isDisabledDb;
      // เปลี่ยนระบบ autoupdate ตามค่านี้ (ป้องกันกรณี localStorage กับ IndexedDB ไม่ตรงกัน)
      if (!isDisabledDb) {
        startInterval();
      } else {
        stopInterval();
      }
    });

    // --- 3) ให้คลิกตรงไหนในปุ่มก็ toggle switch ได้
    btn.addEventListener("click", function (e) {
      if (e.target === sw) return;
      sw.checked = !sw.checked;
      sw.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // --- 4) เมื่อ switch เปลี่ยนค่า ให้บันทึกและสลับระบบ autoupdate
    sw.addEventListener("change", function () {
      const enabled = sw.checked;
      setAutoUpdateDisabled(!enabled);
      if (enabled) {
        startInterval();
        checkUpdate();
      } else {
        stopInterval();
      }
    });
  }

  // ---- Init ----
  // 1. ตั้ง switch ให้ถูกต้อง "ทันที" (ทำใน setupToggleBtn)
  // 2. โค้ดหลักที่ไม่เกี่ยวกับสวิตช์ ให้รอ DOM loaded ตามปกติ
  function trySetupToggleBtnEarly() {
    // รอจนมีปุ่มใน DOM แล้วจึง setup (ป้องกันกรณี script อยู่ใน <head>)
    if (document.getElementById(TOGGLE_BTN_ID) && document.getElementById(SWITCH_ID)) {
      setupToggleBtn();
    } else {
      setTimeout(trySetupToggleBtnEarly, 10);
    }
  }
  trySetupToggleBtnEarly();

  // --- โค้ดส่วนอื่น รอ DOM loaded ตามปกติ ---
  function initRest() {
    fetchVersionContentSilent().then(function (initial) {
      if (initial) sessionStorage.setItem(STORAGE_KEY, initial);
    });
    // ไม่ต้องเรียก setupToggleBtn ที่นี่ เพราะ setup ไปแล้วข้างบน
    // จะเริ่ม interval เฉพาะกรณีเปิดเท่านั้น (เซ็ตใน setupToggleBtn)
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRest);
  } else {
    initRest();
  }

})();