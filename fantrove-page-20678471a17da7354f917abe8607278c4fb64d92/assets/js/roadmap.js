// Absolutely instant: runs as soon as script is parsed, not waiting for DOMContentLoaded. 
// Loads cache instantly, paints to DOM ASAP, schedules fetch in background.
// No wait, no event delay, no main-thread block.

(function() {
  const DB_NAME = "FeatureDB", DB_VERSION = 1, STORE_NAME = "featureData";
  const STORAGE_KEY = "plan_data", LANG_KEY = "selectedLang";
  const translations = {
    featureStatus: {
      current: {th: "คุณลักษณะนี้อยู่ในเวอร์ชันปัจจุบัน", en: "This feature is in the current version"},
      upcoming: {th: "คุณลักษณะนี้จะเพิ่มในเวอร์ชันถัดไป", en: "This feature will be added in the next version"},
      version: {th: "เวอร์ชัน", en: "Version"}
    }
  };
  let inMemoryCache = null;
  let lastDisplayKey = "";

  // Utility
  const getCurrentLang = () => localStorage.getItem(LANG_KEY) || "en";

  // IndexedDB
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject("no_indexedDB");
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME))
          db.createObjectStore(STORE_NAME, {keyPath: "id"});
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }
  function getFeatureDataFromDB() {
    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get("data");
      getReq.onsuccess = e => resolve(e.target.result ? e.target.result.data : null);
      getReq.onerror = e => reject(e.target.error);
    }));
  }
  function saveFeatureDataToDB(data) {
    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put({id: "data", data});
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = e => reject(e.target.error);
    }));
  }
  // Cache
  async function getFeatureDataCache() {
    if (inMemoryCache) return inMemoryCache;
    try {
      let dbData = await getFeatureDataFromDB();
      if (dbData) {
        inMemoryCache = dbData;
        return dbData;
      }
    } catch {}
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let parsed = JSON.parse(raw);
        inMemoryCache = parsed;
        return parsed;
      }
    } catch {}
    return null;
  }
  function saveFeatureDataCache(data) {
    inMemoryCache = data;
    saveFeatureDataToDB(data).catch(()=>{});
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  }
  // Fast compare
  function isDataDifferent(a, b) {
    if (!a || !b) return true;
    try {
      return a.current_stage !== b.current_stage ||
        a.stages.length !== b.stages.length ||
        a.stages.some((s, i) => {
          let t = b.stages[i];
          if (!t) return true;
          if (s.version !== t.version || s.stage_number !== t.stage_number) return true;
          if (s.features.length !== t.features.length) return true;
          for (let j = 0; j < s.features.length; j++) {
            let k1 = Object.keys(s.features[j].feature), k2 = Object.keys(t.features[j].feature);
            if (k1.length !== k2.length) return true;
            for (let k = 0; k < k1.length; k++) {
              if (s.features[j].feature[k1[k]] !== t.features[j].feature[k1[k]]) return true;
            }
          }
          return false;
        });
    } catch { return true; }
  }
  // Ultra-fast DOM batcher
  function displayFeatures(currentStage, stages) {
    const lang = getCurrentLang();
    const displayKey = lang + "|" + currentStage + "|" + stages.map(s=>s.version).join(",");
    if (displayKey === lastDisplayKey) return;
    lastDisplayKey = displayKey;
    // Wait until DOM is ready, but don't block
    function realPaint() {
      const featureList = document.getElementById("feature-list");
      if (!featureList) return setTimeout(realPaint, 0);
      while (featureList.firstChild) featureList.removeChild(featureList.firstChild);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i], stageNumber = stage.stage_number, features = stage.features;
        for (let j = 0; j < features.length; j++) {
          const item = features[j];
          const li = document.createElement("li");
          const featureText = item.feature[lang] || item.feature.en || Object.values(item.feature)[0];
          li.textContent = `${featureText} - ${translations.featureStatus.version[lang]} ${stage.version}`;
          if (stageNumber < currentStage) li.className = "past-feature";
          else if (stageNumber === currentStage) {
            li.className = "new-feature";
            const small = document.createElement("small");
            small.textContent = translations.featureStatus.current[lang];
            li.appendChild(small);
          } else if (stageNumber === currentStage + 1) {
            li.className = "upcoming-feature";
            const small = document.createElement("small");
            small.textContent = translations.featureStatus.upcoming[lang];
            li.appendChild(small);
          } else {
            li.className = "not-feature";
            li.textContent = `??? - ${translations.featureStatus.version[lang]} ${stage.version}`;
          }
          for (const [langCode, txt] of Object.entries(item.feature)) {
            li.dataset[`feature${langCode.toUpperCase()}`] = txt;
          }
          frag.appendChild(li);
        }
      }
      featureList.appendChild(frag);
    }
    // Try to paint immediately, else queue until DOM is available
    if (document.readyState === "loading") {
      setTimeout(realPaint, 0);
    } else {
      realPaint();
    }
  }
  // Main logic: run instantly
  (async function boot() {
    // 1. Paint from cache instantly, before anything else
    getFeatureDataCache().then(cached => {
      if (cached) displayFeatures(cached.current_stage, cached.stages);
    });
    // 2. Fire async network update, update if different
    let controller = new AbortController();
    let fetchPromise = fetch("/assets/json/current-stage.json", {signal: controller.signal})
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText));
    let cached = await getFeatureDataCache();
    let freshData = null;
    try {
      freshData = await Promise.race([
        fetchPromise,
        new Promise(res => setTimeout(() => res(null), cached ? 16 : 900))
      ]);
      if (freshData && isDataDifferent(freshData, cached)) {
        saveFeatureDataCache(freshData);
        displayFeatures(freshData.current_stage, freshData.stages);
      }
    } catch (e) {}
    if (freshData) try { controller.abort(); } catch{}
  })();

  // Language change: repaint instantly from memory cache
  window.addEventListener("languageChange", function() {
    if (inMemoryCache) displayFeatures(inMemoryCache.current_stage, inMemoryCache.stages);
    else getFeatureDataCache().then(data => {
      if (data) displayFeatures(data.current_stage, data.stages);
    });
  });
})();