// @ts-check
'use strict';

/**
 * @typedef {Object} IntroSystemConfig
 * @property {string} introShownKey
 * @property {string} introExpirationKey
 * @property {string} templateCacheKey
 * @property {string} containerId
 * @property {number} introDuration
 * @property {string} templateFile
 * @property {number} preloadTimeout
 * @property {number} displayDuration
 */

/** @type {IntroSystemConfig} */
const SYSTEM_CONFIG = Object.freeze({
  introShownKey: 'introShown',
  introExpirationKey: 'introExpiration',
  templateCacheKey: 'introTemplateCache',
  containerId: 'introContainer',
  introDuration: 2 * 60 * 60 * 1000, // 2 hours
  templateFile: '/assets/template-html/intro-template.html',
  preloadTimeout: 300,
  displayDuration: 3300, // 3.3 sec
});

/**
 * Utility for safe sessionStorage access
 */
const safeSession = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, val) {
    try {
      sessionStorage.setItem(key, val);
    } catch {}
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  }
};

/**
 * Efficient Template + Container Manager (Singleton)
 */
class IntroTemplateManager {
  static #instance;
  static getInstance() {
    return this.#instance || (this.#instance = new IntroTemplateManager());
  }
  constructor() {
    /** @type {Promise<string>|null} */ this.templatePromise = null;
    /** @type {string|null} */ this.cachedTemplate = null;
    /** @type {HTMLElement|null} */ this.container = null;
    this.isInitialized = false;
    this._preloadStarted = false;
    // Preload as soon as possible (performance boost)
    if (document.readyState === 'loading') {
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
          this._preloadTemplate();
        }
      }, { once: true });
    } else {
      this._preloadTemplate();
    }
  }

  /** @private */
  shouldShowIntro() {
    const introShown = safeSession.get(SYSTEM_CONFIG.introShownKey);
    if (!introShown) return true;
    const expirationTime = parseInt(safeSession.get(SYSTEM_CONFIG.introExpirationKey) || '0', 10);
    return Date.now() > expirationTime;
  }

  /** @private */
  removeContainerIfNotNeeded() {
    if (!this.shouldShowIntro()) {
      const el = document.getElementById(SYSTEM_CONFIG.containerId);
      if (el) el.remove();
      return true;
    }
    return false;
  }

  /** @private */
  initializeContainer() {
    if (this.removeContainerIfNotNeeded()) return null;
    if (this.container) return this.container;
    let container = document.getElementById(SYSTEM_CONFIG.containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = SYSTEM_CONFIG.containerId;
      container.className = 'intro-container';
      document.body.appendChild(container);
    }
    // Accessibility
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-label', 'Welcome Introduction');
    this.container = container;
    return container;
  }

  /** @private */
  async _preloadTemplate() {
    if (this._preloadStarted || !this.shouldShowIntro()) return;
    this._preloadStarted = true;
    // If cached in session, use it
    const cached = safeSession.get(SYSTEM_CONFIG.templateCacheKey);
    if (cached) {
      this.cachedTemplate = cached;
      return;
    }
    // Start async preload
    this.templatePromise = new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('Template preload timeout'));
      }, SYSTEM_CONFIG.preloadTimeout);
      fetch(SYSTEM_CONFIG.templateFile, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html',
          'Cache-Control': 'max-age=3600'
        }
      }).then(res => {
        if (!res.ok) throw new Error('Template fetch failed');
        return res.text();
      }).then(template => {
        clearTimeout(timeoutId);
        safeSession.set(SYSTEM_CONFIG.templateCacheKey, template);
        this.cachedTemplate = template;
        resolve(template);
      }).catch(err => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
    // Do not await here: let it run in background
  }

  /** @private */
  async _getTemplate() {
    if (this.cachedTemplate) return this.cachedTemplate;
    // If preload is running, await it
    if (this.templatePromise) return this.templatePromise;
    // Not started (rare: fallback)
    await this._preloadTemplate();
    return this.templatePromise;
  }

  /**
   * Prepare intro container and template.
   * @returns {Promise<HTMLElement|null>}
   */
  async prepare() {
    if (!this.shouldShowIntro()) {
      this.removeContainerIfNotNeeded();
      return null;
    }
    if (this.isInitialized) return this.container;
    try {
      const container = this.initializeContainer();
      if (!container) return null;
      const template = await this._getTemplate();
      if (!template) return null;
      // Content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'intro-content';
      contentWrapper.innerHTML = template;
      container.innerHTML = '';
      container.appendChild(contentWrapper);
      this.isInitialized = true;
      return container;
    } catch (e) {
      this.cleanup();
      throw e;
    }
  }

  /**
   * Show the intro container.
   */
  show() {
    if (!this.container || !this.shouldShowIntro()) return;
    this.container.classList.add('active');
  }

  /**
   * Hide and remove the intro container with fade-out.
   * เพิ่มเติม: ลบ container ออกจาก DOM อย่างรวดเร็วที่สุดหลังจบ transition/animation (หรือทันทีถ้าไม่มี)
   */
  hide() {
    if (!this.container) return;
    const container = this.container;
    // ปิดการมองเห็นทันที เพื่อ UX ที่ไวสุด
    requestAnimationFrame(() => {
      container.classList.add('fade-out');
      // ถ้าไม่มี transition ให้ remove container ทันที
      const computed = window.getComputedStyle(container);
      const duration =
        Math.max(
          parseFloat(computed.transitionDuration) || 0,
          parseFloat(computed.animationDuration) || 0
        ) * 1000;
      if (duration < 10) {
        // ไม่มี transition/animation จริง
        this.cleanup();
      } else {
        // รอให้จบ transition/animation แล้วลบ
        const onEnd = () => {
          container.removeEventListener('transitionend', onEnd);
          container.removeEventListener('animationend', onEnd);
          this.cleanup();
        };
        container.addEventListener('transitionend', onEnd, { once: true });
        container.addEventListener('animationend', onEnd, { once: true });
      }
    });
  }

  /**
   * Cleanup and remove the container and template cache.
   */
  cleanup() {
    if (this.container) {
      this.container.classList.remove('active', 'fade-out');
      // ลบออกจาก DOM ทันที
      if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
    this.isInitialized = false;
    safeSession.remove(SYSTEM_CONFIG.templateCacheKey);
  }
}

/**
 * Main Intro System
 */
class IntroSystem {
  constructor() {
    this.templateManager = IntroTemplateManager.getInstance();
    this.initialized = false;
  }
  /** @private */
  saveState() {
    safeSession.set(SYSTEM_CONFIG.introShownKey, 'true');
    safeSession.set(
      SYSTEM_CONFIG.introExpirationKey,
      (Date.now() + SYSTEM_CONFIG.introDuration).toString()
    );
  }
  /**
   * Initialize and show intro, then auto-hide.
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const container = await this.templateManager.prepare();
      if (!container) {
        document.body.classList.remove('loading');
        return;
      }
      document.body.style.overflow = 'hidden';
      this.templateManager.show();
      setTimeout(() => {
        // ทำให้แน่ใจว่า container จะถูก remove ให้เร็วที่สุด
        this.templateManager.hide();
        document.body.style.overflow = '';
      }, SYSTEM_CONFIG.displayDuration);
      this.saveState();
      this.initialized = true;
    } catch (e) {
      document.body.classList.remove('loading');
      throw e;
    }
  }
}

// Pre-init: kickoff template preload at earliest possible
IntroTemplateManager.getInstance(); // Ensures preload starts even before DOMContentLoaded

// DOM ready: launch intro
document.addEventListener('DOMContentLoaded', () => {
  const system = new IntroSystem();
  system.initialize().catch(e => {
    document.body.classList.remove('loading');
  });
}, { passive: true });

// Error boundaries
window.addEventListener('error', event => {
  document.body.classList.remove('loading');
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IntroSystem, IntroTemplateManager, SYSTEM_CONFIG };
}