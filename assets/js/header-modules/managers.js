// managers.js
// ✅ ปรับปรุง: Optimized event handlers, deferred initialization, memory efficient
export const scrollManager = {
    state: { lastScrollY: 0, ticking: false, subNavOffsetTop: 0, subNavHeight: 0, isSubNavFixed: false },
    constants: { SUB_NAV_TOP_SPACING: 0, ANIMATION_DURATION: 0, Z_INDEX: { SUB_NAV: 999 } },

    createStickyStyles() {
        if (document.getElementById('sticky-styles')) return;
        const styleSheet = document.createElement('style');
        styleSheet.id = 'sticky-styles';
        const headerZ = (this.constants.Z_INDEX.SUB_NAV || 999) + 2;
        styleSheet.textContent = `
header { position: relative; z-index: ${headerZ}; contain: layout style paint; }
#sub-nav { position: sticky; top: ${this.constants.SUB_NAV_TOP_SPACING}px; left: 0; right: 0; z-index: ${this.constants.Z_INDEX.SUB_NAV}; transition: background ${this.constants.ANIMATION_DURATION}ms ease; }
#sub-nav.fixed { background: rgba(255, 255, 255, 1); border-bottom: 0.5px solid rgba(19, 180, 127, 0.18); border-radius: 0 0 30px 30px; }
#sub-nav.fixed #sub-buttons-container { padding: 8px 18px !important; border-radius: 0 0 30px 30px; }
#sub-nav.fixed.hi {padding: 0!important;}
#sub-nav.fixed .hj { border-color: rgba(0, 0, 0, 0); background: transparent; }
        `;
        document.head.appendChild(styleSheet);
    },

    handleSubNav() {
        const subNav = document.getElementById('sub-nav');
        if (!subNav) return;
        if (!this.state.subNavOffsetTop) {
            this.state.subNavOffsetTop = subNav.offsetTop;
            this.state.subNavHeight = subNav.offsetHeight;
        }
        const currentScroll = window.pageYOffset;
        const triggerPoint = this.state.subNavOffsetTop - this.constants.SUB_NAV_TOP_SPACING;
        if (currentScroll >= triggerPoint && !this.state.isSubNavFixed) {
            requestAnimationFrame(() => {
                subNav.classList.add('fixed');
                setTimeout(() => { subNav.classList.add('animate'); }, 10);
                this.state.isSubNavFixed = true;
            });
        } else if (currentScroll < triggerPoint && this.state.isSubNavFixed) {
            requestAnimationFrame(() => {
                subNav.classList.add('unfixing'); subNav.classList.add('animate');
                setTimeout(() => {
                    subNav.classList.remove('fixed', 'unfixing', 'animate');
                    this.state.isSubNavFixed = false;
                }, this.constants.ANIMATION_DURATION);
            });
        }
    },

    setupEventListeners() {
        window.addEventListener('scroll', () => {
            if (this.state.ticking) return;
            this.state.ticking = true;
            window.requestAnimationFrame(() => {
                try { this.handleSubNav(); } catch {}
                this.state.ticking = false;
            });
        }, { passive: true });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.handleSubNav();
        });
    },

    setupResizeObserver() {
        let resizeTimer = null;
        try {
            const subNav = document.getElementById('sub-nav');
            if (!subNav) return;
            const resizeObserver = new ResizeObserver(entries => {
                if (resizeTimer) clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    entries.forEach(entry => {
                        if (entry.target.id === 'sub-nav') {
                            this.state.subNavHeight = entry.contentRect.height;
                            this.state.subNavOffsetTop = entry.target.offsetTop;
                            this.handleSubNav();
                        }
                    });
                }, 120);
            });
            resizeObserver.observe(subNav);
        } catch {}
    },

    setupMutationObserver() {
        try {
            const subNav = document.getElementById('sub-nav');
            if (!subNav) return;
            const parent = subNav.parentNode || document.body;
            const mutationObserver = new MutationObserver(() => {
                setTimeout(() => {
                    const s = document.getElementById('sub-nav');
                    if (s) {
                        this.state.subNavOffsetTop = s.offsetTop;
                        this.state.subNavHeight = s.offsetHeight;
                        this.handleSubNav();
                    }
                }, 80);
            });
            mutationObserver.observe(parent, { childList: true, subtree: true });
        } catch {}
    },

    handleInitialScroll() {
        if (window.pageYOffset > 0) this.handleSubNav();
    },

    init() {
        try {
            this.createStickyStyles();
            this.setupEventListeners();
            this.setupResizeObserver();
            this.setupMutationObserver();
            this.handleInitialScroll();
        } catch (e) {
            console.error('scrollManager init error', e);
        }
    }
};

export const performanceOptimizer = {
    setupLazyLoading() {
        if ('loading' in HTMLImageElement.prototype) {
            document.querySelectorAll('img').forEach(img => { if (!img.loading) img.loading = 'lazy'; });
        } else {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute('data-src');
                        }
                        observer.unobserve(img);
                    }
                });
            }, { rootMargin: '300px' });
            document.querySelectorAll('img[data-src]').forEach(img => imageObserver.observe(img));
        }
    },

    setupPrefetching() {
        if (!('requestIdleCallback' in window)) {
            setTimeout(() => this._doPrefetch(), 2500);
        } else {
            requestIdleCallback(() => this._doPrefetch(), { timeout: 3000 });
        }
    },

    _doPrefetch() {
        try {
            const prefetchLinks = new Set();
            const elements = Array.from(document.querySelectorAll('a[href], button[data-url]'));
            const MAX_PREFETCH = 4;
            let count = 0;
            for (const el of elements) {
                if (count >= MAX_PREFETCH) break;
                const url = el.href || el.dataset.url;
                if (!url || prefetchLinks.has(url)) continue;
                try {
                    const link = document.createElement('link');
                    link.rel = 'prefetch';
                    link.href = url;
                    link.as = url.endsWith('.json') ? 'fetch' : 'document';
                    document.head.appendChild(link);
                    prefetchLinks.add(url);
                    count++;
                } catch {}
            }
        } catch (e) {
            console.error('prefetch error', e);
        }
    },

    setupErrorBoundary() {
        const throttledNotify = window._headerV2_utils.debounce((msg) => {
            window._headerV2_utils.showNotification(msg, 'error');
        }, 800);

        window.addEventListener('error', event => {
            throttledNotify('เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง');
            console.error('Captured error', event.error || event);
        });

        window.addEventListener('unhandledrejection', event => {
            throttledNotify('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาตรวจสอบอินเทอร์เน็ต');
            console.error('Unhandled rejection', event.reason);
        });
    },

    init() {
        try {
            this.setupLazyLoading();
            this.setupPrefetching();
            this.setupErrorBoundary();
        } catch (e) {
            console.error('performanceOptimizer init error', e);
        }
    }
};

export const subNavManager = {
    ensureSubNavContainer() {
        let subNav = document.getElementById('sub-nav');
        if (!subNav) {
            subNav = document.createElement('div');
            subNav.id = 'sub-nav';
            subNav.className = 'hi';
            const header = document.querySelector('header');
            if (header && header.nextSibling) {
                header.parentNode.insertBefore(subNav, header.nextSibling);
            } else {
                document.body.insertBefore(subNav, document.body.firstChild);
            }
        }

        let hj = subNav.querySelector('.hj');
        if (!hj) {
            hj = document.createElement('div');
            hj.className = 'hj';
            subNav.appendChild(hj);
        }

        const existingGlobal = document.querySelector('#sub-buttons-container');
        if (existingGlobal && !hj.contains(existingGlobal)) {
            try {
                hj.appendChild(existingGlobal);
            } catch (e) {}
        }

        let subButtonsContainer = hj.querySelector('#sub-buttons-container');
        if (!subButtonsContainer) {
            const all = document.querySelectorAll('#sub-buttons-container');
            if (all && all.length > 1) {
                for (const el of all) {
                    if (!subNav.contains(el)) {
                        try { el.parentNode && el.parentNode.removeChild(el); } catch {}
                    }
                }
            }
            subButtonsContainer = hj.querySelector('#sub-buttons-container') || document.createElement('div');
            subButtonsContainer.id = 'sub-buttons-container';
            if (!hj.contains(subButtonsContainer)) hj.appendChild(subButtonsContainer);
        }

        window._headerV2_elements.subNav = subNav;
        window._headerV2_elements.subNavInner = hj;
        window._headerV2_elements.subButtonsContainer = subButtonsContainer;
        return subButtonsContainer;
    },

    hideSubNav() {
        const subNav = document.getElementById('sub-nav');
        if (subNav) {
            subNav.style.display = 'none';
            const container = subNav.querySelector('#sub-buttons-container');
            if (container) container.innerHTML = '';
            if (window._headerV2_elements.subButtonsContainer)
                window._headerV2_elements.subButtonsContainer.innerHTML = '';
        }
    },

    showSubNav() {
        let subNav = document.getElementById('sub-nav');
        if (!subNav) {
            this.ensureSubNavContainer();
            subNav = document.getElementById('sub-nav');
        }
        if (subNav) {
            subNav.style.display = '';
        }
    },

    clearSubButtons() {
        const container = this.ensureSubNavContainer();
        container.innerHTML = '';
    }
};

export const buttonManager = {
    buttonConfig: null,
    state: { buttonMap: new Map(), currentMainButton: null, currentSubButton: null, currentMainButtonUrl: null },

    async loadConfig() {
        if (this.buttonConfig) {
            await this.renderMainButtons();
            return;
        }
        const cached = window._headerV2_dataManager.getCached('buttonConfig');
        if (cached) {
            this.buttonConfig = cached;
            await this.renderMainButtons();
            return;
        }
        // Medium priority (priority 2)
        const response = await window._headerV2_dataManager.fetchWithRetry(
            window._headerV2_dataManager.constants.BUTTONS_CONFIG_PATH,
            {},
            2
        );
        this.buttonConfig = response;
        window._headerV2_dataManager.setCache('buttonConfig', response);
        await this.renderMainButtons();
        await window._headerV2_navigationManager.updateButtonStates();
    },

    async renderMainButtons() {
        const lang = localStorage.getItem('selectedLang') || 'en';
        const { mainButtons } = this.buttonConfig;
        const navList = window._headerV2_elements.navList;
        navList.innerHTML = '';
        this.state.buttonMap = new Map();
        let defaultButton = null;

        const fragment = document.createDocumentFragment();

        for (const button of mainButtons) {
            const label = button[`${lang}_label`];
            if (!label) continue;
            const li = document.createElement('li');
            const mainButton = document.createElement('button');
            mainButton.textContent = label;
            mainButton.className = 'main-button';
            const buttonUrl = button.url || button.jsonFile;
            mainButton.setAttribute('data-url', buttonUrl);
            if (button.className) mainButton.classList.add(button.className);
            this.state.buttonMap.set(buttonUrl, { button: mainButton, config: button, element: mainButton });
            if (button.isDefault) defaultButton = { button: mainButton, config: button };

            mainButton.addEventListener('click', async (event) => {
                event.preventDefault();
                const siblings = navList.querySelectorAll('button');
                for (let i = 0; i < siblings.length; i++) siblings[i].classList.remove('active');
                mainButton.classList.add('active');
                this.state.currentMainButton = mainButton;
                this.state.currentMainButtonUrl = buttonUrl;

                await window._headerV2_contentManager.clearContent();

                if (button.subButtons && button.subButtons.length > 0) {
                    window._headerV2_subNavManager.showSubNav();
                    await this.renderSubButtons(button.subButtons, buttonUrl, lang);
                } else {
                    window._headerV2_subNavManager.hideSubNav();
                }

                const skipUrlUpdate = !!button.subButtons;
                if (!button.subButtons && button.url) {
                    await window._headerV2_navigationManager.navigateTo(button.url, { skipUrlUpdate });
                }
                if (button.jsonFile) {
                    try {
                        await window._headerV2_contentManager.renderContent([{ jsonFile: button.jsonFile }]);
                    } catch {
                        window._headerV2_utils.showNotification('โหลดเนื้อหาไม่สำเร็จ', 'error');
                    }
                }
                window._headerV2_navigationManager.state.currentMainRoute = buttonUrl;
            });

            li.appendChild(mainButton);
            fragment.appendChild(li);
        }

        navList.appendChild(fragment);

        let initialUrl = window.location.search;
        await this.handleInitialUrl(initialUrl, this.state.buttonMap, defaultButton);
    },

    async handleInitialUrl(url, buttonMap, defaultButton) {
        try {
            if (!url) url = window.location.search;
            if (!url || url === '?') {
                if (defaultButton) await this.triggerMainButtonClick(defaultButton.button);
                return;
            }
            let mainRoute = '', subRoute = '';
            if (url.startsWith('?')) {
                const params = new URLSearchParams(url);
                mainRoute = (params.get('type') || '').replace(/__$/, '');
                subRoute = params.get('page') || '';
            } else if (url.includes('-')) {
                [mainRoute, subRoute] = url.split('-');
            } else {
                mainRoute = url;
            }
            const mainButtonData = buttonMap.get(mainRoute);
            if (!mainButtonData) {
                if (defaultButton) await this.triggerMainButtonClick(defaultButton.button);
                return;
            }
            const { button: mainButton, config: mainConfig } = mainButtonData;
            try {
                const isValidUrl = await window._headerV2_navigationManager.validateUrl(url);
                if (!isValidUrl) throw new Error('URL ไม่ถูกต้อง');
                window._headerV2_navigationManager.state.currentMainRoute = mainRoute;
                window._headerV2_navigationManager.state.currentSubRoute = subRoute || '';
                this.state.currentMainButton = mainButton;
                await this.activateMainButton(mainButton, mainConfig);
                if (mainConfig.subButtons && mainConfig.subButtons.length > 0) {
                    if (subRoute) {
                        await this.handleInitialSubRoute(mainConfig, mainRoute, subRoute);
                    } else {
                        await this.handleDefaultSubButton(mainConfig, mainRoute);
                    }
                    window._headerV2_subNavManager.showSubNav();
                } else {
                    window._headerV2_subNavManager.hideSubNav();
                }
                window._headerV2_navigationManager.scrollActiveButtonsIntoView();
            } catch {
                if (defaultButton) await this.triggerMainButtonClick(defaultButton.button);
            }
        } catch {
            if (defaultButton) await this.triggerMainButtonClick(defaultButton.button);
        }
    },

    async activateMainButton(mainButton, mainConfig) {
        const navList = window._headerV2_elements.navList;
        navList.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        mainButton.classList.add('active');
        this.state.currentMainButton = mainButton;
        await window._headerV2_content_manager?.clearContent?.() || await window._headerV2_contentManager.clearContent();
        if (mainConfig.subButtons && mainConfig.subButtons.length > 0) {
            window._headerV2_subNavManager.showSubNav();
            await this.renderSubButtons(mainConfig.subButtons, mainConfig.url || mainConfig.jsonFile, localStorage.getItem('selectedLang') || 'en');
        } else {
            window._headerV2_subNavManager.hideSubNav();
        }
        if (mainConfig.jsonFile) {
            await window._headerV2_contentManager.renderContent([{ jsonFile: mainConfig.jsonFile }]);
        }
    },

    async handleInitialSubRoute(mainConfig, mainRoute, subRoute) {
        await new Promise(resolve => setTimeout(resolve, 80));
        const lang = localStorage.getItem('selectedLang') || 'en';
        if (mainConfig.subButtons && mainConfig.subButtons.length > 0) {
            window._headerV2_subNavManager.showSubNav();
            await this.renderSubButtons(mainConfig.subButtons, mainRoute, lang);
            const subButton = window._headerV2_elements.subButtonsContainer.querySelector(`button[data-url="${mainRoute}-${subRoute}"]`);
            const subButtonConfig = mainConfig.subButtons.find(btn => btn.url === subRoute || btn.jsonFile === subRoute);
            if (subButton && subButtonConfig) {
                window._headerV2_elements.subButtonsContainer.querySelectorAll('.button-sub').forEach(btn => btn.classList.remove('active'));
                subButton.classList.add('active');
                this.state.currentSubButton = subButton;
                if (subButtonConfig.jsonFile) {
                    await window._headerV2_contentManager.clearContent();
                    await window._headerV2_contentManager.renderContent([{ jsonFile: subButtonConfig.jsonFile }]);
                }
                this.scrollActiveSubButtonIntoView(subButton);
            }
        } else {
            window._headerV2_subNavManager.hideSubNav();
        }
    },

    async handleDefaultSubButton(mainConfig, mainRoute) {
        if (mainConfig.subButtons && mainConfig.subButtons.length > 0) {
            window._headerV2_subNavManager.showSubNav();
            const defaultSubButton = mainConfig.subButtons.find(btn => btn.isDefault);
            if (defaultSubButton) {
                const fullUrl = `${mainRoute}-${defaultSubButton.url || defaultSubButton.jsonFile}`;
                await window._headerV2_navigationManager.navigateTo(fullUrl, { skipUrlUpdate: false });
            }
        } else {
            window._headerV2_subNavManager.hideSubNav();
        }
    },

    async triggerMainButtonClick(button, options = {}) {
        if (!button) throw new Error('ไม่พบปุ่มหลักที่จะคลิก');
        const buttonUrl = button.getAttribute('data-url');
        const mainConfig = this.findMainButtonConfig(buttonUrl);
        await window._headerV2_contentManager.clearContent();
        if (mainConfig?.subButtons && mainConfig.subButtons.length > 0) {
            window._headerV2_subNavManager.showSubNav();
            await this.renderSubButtons(mainConfig.subButtons, mainConfig.url || mainConfig.jsonFile, localStorage.getItem('selectedLang') || 'en');
        } else {
            window._headerV2_subNavManager.hideSubNav();
        }
        this.state.currentMainButton = button;
        this.state.currentMainButtonUrl = buttonUrl;
        if (mainConfig?.jsonFile) {
            await window._headerV2_contentManager.renderContent([{ jsonFile: mainConfig.jsonFile }]);
        }
        this.updateButtonState(button, false);
    },

    async triggerSubButtonClick(button) {
        if (!button) throw new Error('ไม่พบปุ่มย่อยที่จะคลิก');
        await window._headerV2_contentManager.clearContent();
        const buttonUrl = button.getAttribute('data-url');
        const [mainRoute, subRoute] = buttonUrl.split('-');
        const mainConfig = this.findMainButtonConfig(mainRoute);
        const subConfig = mainConfig?.subButtons?.find(btn => btn.url === subRoute || btn.jsonFile === subRoute);
        this.state.currentSubButton = button;
        if (subConfig?.jsonFile) {
            await window._headerV2_contentManager.renderContent([{ jsonFile: subConfig.jsonFile }]);
        }
        this.updateButtonState(button, true);
        await window._headerV2_navigationManager.changeURL(buttonUrl);
    },

    async renderSubButtons(subButtons, mainButtonUrl, lang) {
        if (!subButtons || subButtons.length === 0) {
            window._headerV2_subNavManager.hideSubNav();
            return;
        }
        window._headerV2_subNavManager.showSubNav();
        const container = window._headerV2_subNavManager.ensureSubNavContainer();
        container.innerHTML = '';
        let defaultSubButton = null;
        const currentUrl = window.location.search;
        let activeSubUrl = '';
        if (currentUrl.startsWith('?')) {
            const params = new URLSearchParams(currentUrl);
            const main = (params.get('type') || '').replace(/__$/, '');
            const sub = params.get('page') || '';
            if (main && sub) activeSubUrl = `${main}-${sub}`;
        }

        const frag = document.createDocumentFragment();
        subButtons.forEach(button => {
            const label = button[`${lang}_label`];
            if (!label) return;
            const subButton = document.createElement('button');
            subButton.className = 'button-sub sub-button';
            if (button.className) subButton.classList.add(button.className);
            subButton.textContent = label;
            const fullUrl = button.url ?
                `${mainButtonUrl}-${button.url}` :
                `${mainButtonUrl}-${button.jsonFile}`;
            subButton.setAttribute('data-url', fullUrl);
            if (button.isDefault) defaultSubButton = subButton;

            subButton.addEventListener('click', async () => {
                this.updateButtonState(subButton, true);
                await window._headerV2_contentManager.clearContent();
                if (button.jsonFile) {
                    try {
                        await window._headerV2_contentManager.renderContent([{ jsonFile: button.jsonFile }]);
                    } catch {
                        window._headerV2_utils.showNotification('โหลดเนื้อหาย่อยไม่สำเร็จ', 'error');
                    }
                }
                await window._headerV2_navigationManager.changeURL(fullUrl);
            });
            frag.appendChild(subButton);
            if (fullUrl === activeSubUrl) this.updateButtonState(subButton, true);
        });
        container.appendChild(frag);
        const needsDefault = !activeSubUrl ||
            !container.querySelector('.button-sub.active');
        if (needsDefault && defaultSubButton) await this.triggerSubButtonClick(defaultSubButton);
        container.classList.remove('fade-out');
        container.classList.add('fade-in');
    },

    updateButtonState(button, isSubButton) {
        const buttonGroup = isSubButton ? window._headerV2_elements.subButtonsContainer : window._headerV2_elements.navList;
        if (buttonGroup) buttonGroup.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        if (isSubButton) {
            this.state.currentSubButton = button;
            this.scrollActiveSubButtonIntoView(button);
        } else {
            this.state.currentMainButton = button;
        }
    },

    findMainButtonConfig(url) {
        return this.buttonConfig?.mainButtons?.find(btn => btn.url === url || btn.jsonFile === url);
    },

    findSubButtonConfig(fullUrl) {
        const [mainRoute, subRoute] = fullUrl.split('-');
        const mainButton = this.findMainButtonConfig(mainRoute);
        return mainButton?.subButtons?.find(btn => btn.url === subRoute || btn.jsonFile === subRoute);
    },

    scrollActiveSubButtonIntoView(activeButton) {
        if (!activeButton) return;
        const container = window._headerV2_elements.subButtonsContainer;
        if (!container) return;
        const containerLeft = container.getBoundingClientRect().left;
        const buttonLeft = activeButton.getBoundingClientRect().left;
        const scrollLeft = container.scrollLeft;
        const targetScroll = scrollLeft + (buttonLeft - containerLeft) - 20;
        if (Math.abs(container.scrollLeft - targetScroll) > 1) {
            container.scrollTo({
                left: targetScroll,
                behavior: 'smooth'
            });
        }
    },

    updateButtonsLanguage(newLang) {
        try {
            const { mainButtons } = this.buttonConfig;
            const navList = window._headerV2_elements.navList;
            navList.querySelectorAll('button').forEach((button, index) => {
                const config = mainButtons[index];
                if (config && config[`${newLang}_label`]) button.textContent = config[`${newLang}_label`];
            });
            if (this.state.currentMainButton) {
                const mainConfig = this.findMainButtonConfig(
                    this.state.currentMainButton.getAttribute('data-url')
                );
                if (mainConfig?.subButtons && mainConfig.subButtons.length > 0) {
                    window._headerV2_subNavManager.showSubNav();
                    this.renderSubButtons(
                        mainConfig.subButtons,
                        mainConfig.url || mainConfig.jsonFile,
                        newLang
                    );
                } else {
                    window._headerV2_subNavManager.hideSubNav();
                }
            } else {
                window._headerV2_subNavManager.hideSubNav();
            }
        } catch {
            window._headerV2_utils.showNotification('อัพเดทภาษาของปุ่มไม่สำเร็จ', 'error');
        }
    }
};

export const navigationManager = {
    state: { isNavigating: false, currentMainRoute: '', currentSubRoute: '', previousUrl: '', lastScrollPosition: 0 },

    normalizeUrl(url) {
        if (!url) return '';
        const buttonConfig = window._headerV2_buttonManager?.buttonConfig;
        let main = '', sub = '';
        if (typeof url === 'object') {
            main = (url.type || '').toLowerCase();
            sub = (url.page || '').toLowerCase();
        } else if (url.startsWith('?')) {
            const params = new URLSearchParams(url);
            main = (params.get('type') || '').replace(/__$/, '').toLowerCase();
            sub = (params.get('page') || '').toLowerCase();
        } else if (url.includes('-')) {
            const [m, s] = url.split('-');
            main = m; sub = s || '';
        } else {
            main = url.toLowerCase();
        }
        const mainButton = buttonConfig?.mainButtons?.find(btn => btn.url === main || btn.jsonFile === main);
        const hasSub = !!(mainButton && Array.isArray(mainButton.subButtons) && mainButton.subButtons.length > 0);
        if (hasSub) {
            if (sub) return `?type=${main}__&page=${sub}`;
            return `?type=${main}__`;
        }
        return `?type=${main}`;
    },

    parseUrl() {
        const params = new URLSearchParams(window.location.search);
        const type = params.get('type');
        const page = params.get('page');
        return { main: type ? type.replace(/__$/, '') : '', sub: page || '' };
    },

    async validateUrl(url) {
        const { main, sub } = typeof url === 'object' ? url :
            (() => {
                if (url.startsWith('?')) {
                    const params = new URLSearchParams(url);
                    return { main: (params.get('type') || '').replace(/__$/, ''), sub: params.get('page') || '' };
                } else if (url.includes('-')) {
                    const [m, s] = url.split('-');
                    return { main: m, sub: s || '' };
                } else {
                    return { main: url, sub: '' };
                }
            })();
        const config = window._headerV2_buttonManager?.buttonConfig;
        if (!config) return false;
        const mainButton = config.mainButtons.find(btn => btn.url === main || btn.jsonFile === main);
        if (!mainButton) return false;
        if (sub) {
            return mainButton.subButtons && mainButton.subButtons.some(subBtn => subBtn.url === sub || subBtn.jsonFile === sub);
        }
        return true;
    },

    async getDefaultRoute() {
        const config = window._headerV2_buttonManager?.buttonConfig;
        if (!config) return '';
        const defaultMainButton = config.mainButtons.find(btn => btn.isDefault);
        if (!defaultMainButton) return '';
        const mainRoute = defaultMainButton.url || defaultMainButton.jsonFile;
        if (!defaultMainButton.subButtons) return this.normalizeUrl(mainRoute);
        const defaultSubButton = defaultMainButton.subButtons.find(btn => btn.isDefault);
        if (!defaultSubButton) return this.normalizeUrl(mainRoute);
        const subRoute = defaultSubButton.url || defaultSubButton.jsonFile;
        return this.normalizeUrl({ type: mainRoute, page: subRoute });
    },

    async changeURL(url, force = false) {
        try {
            if (!url) return;
            const normalizedUrl = this.normalizeUrl(url);
            if (force || window.location.search !== normalizedUrl) {
                window.history.pushState({
                    url: normalizedUrl,
                    scrollPosition: this.state.lastScrollPosition
                }, '', normalizedUrl);
                this.state.previousUrl = normalizedUrl;
                window.dispatchEvent(new CustomEvent('urlChanged', {
                    detail: {
                        url: normalizedUrl,
                        mainRoute: this.state.currentMainRoute,
                        subRoute: this.state.currentSubRoute
                    }
                }));
            }
        } catch (error) {
            window._headerV2_utils.showNotification('เปลี่ยน URL ไม่สำเร็จ', 'error');
        }
    },

    async updateButtonStates(url) {
        const elements = window._headerV2_elements;
        const { main, sub } = url ?
            (url.startsWith('?') ? (() => {
                    const params = new URLSearchParams(url);
                    return {
                        main: (params.get('type') || '').replace(/__$/, ''),
                        sub: params.get('page') || ''
                    };
                })() :
                (url.includes('-') ? (() => {
                    const [m, s] = url.split('-');
                    return { main: m, sub: s || '' };
                })() : { main: url, sub: '' })
            ) : this.parseUrl();

        const navListEl = elements.navList;
        const subButtonsEl = elements.subButtonsContainer;
        if (navListEl) {
            const buttons = navListEl.querySelectorAll('button');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                btn.classList.toggle('active', btn.getAttribute('data-url') === main);
            }
        }
        if (subButtonsEl) {
            const buttons = subButtonsEl.querySelectorAll('button');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                btn.classList.toggle('active', btn.getAttribute('data-url') === `${main}-${sub}`);
            }
        }
        this.scrollActiveButtonsIntoView();
    },

    async navigateTo(route, options = {}) {
        if (this.state.isNavigating) return;
        try {
            this.state.isNavigating = true;
            this.state.lastScrollPosition = window.pageYOffset;

            let normalizedRoute = typeof route === 'object' ? this.normalizeUrl(route) : route;
            if (typeof route === 'string' && route.startsWith('?')) normalizedRoute = this.normalizeUrl(route);

            let isValidUrl = false;
            try { isValidUrl = await this.validateUrl(normalizedRoute); } catch {}
            if (!isValidUrl) normalizedRoute = await this.getDefaultRoute();

            const { main, sub } = typeof normalizedRoute === 'object' ?
                normalizedRoute :
                normalizedRoute.startsWith('?') ?
                (() => {
                    const params = new URLSearchParams(normalizedRoute);
                    return { main: (params.get('type') || '').replace(/__$/, ''), sub: params.get('page') || '' };
                })() :
                normalizedRoute.includes('-') ?
                (() => {
                    const [m, s] = normalizedRoute.split('-');
                    return { main: m, sub: s || '' };
                })() :
                { main: normalizedRoute, sub: '' };

            this.state.currentMainRoute = main;
            this.state.currentSubRoute = sub || '';
            const lang = localStorage.getItem('selectedLang') || 'en';

            if (!options.skipUrlUpdate) await this.changeURL({ type: main, page: sub });

            const config = window._headerV2_buttonManager.buttonConfig;
            if (!config) throw new Error('buttonConfig not found');
            const mainButton = config.mainButtons.find(btn => btn.url === main || btn.jsonFile === main);
            if (!mainButton) throw new Error('mainButton not found');
            let subButton = null;
            if (mainButton.subButtons?.length) {
                subButton = mainButton.subButtons.find(btn => btn.url === sub || btn.jsonFile === sub);
                if (!subButton) {
                    subButton = mainButton.subButtons.find(btn => btn.isDefault) || mainButton.subButtons[0];
                    this.state.currentSubRoute = subButton.url || subButton.jsonFile;
                }
            }

            if (window._headerV2_elements && window._headerV2_elements.navList) {
                const mainNavBtn = window._headerV2_elements.navList.querySelector(`button[data-url="${main}"]`);
                if (mainNavBtn) {
                    window._headerV2_elements.navList.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                    mainNavBtn.classList.add('active');
                    window._headerV2_buttonManager.state.currentMainButton = mainNavBtn;
                    window._headerV2_buttonManager.state.currentMainButtonUrl = main;
                }
            }

            const hasSubButtons = mainButton.subButtons?.length > 0;
            const isPopState = !!options.isPopState;
            const subButtonsContainer = window._headerV2_elements.subButtonsContainer || (hasSubButtons ? window._headerV2_subNavManager.ensureSubNavContainer() : null);
            const needsRenderSubButtons = hasSubButtons && ((!isPopState) || (isPopState && (!subButtonsContainer || subButtonsContainer.childNodes.length === 0)));

            if (hasSubButtons) {
                if (needsRenderSubButtons) {
                    const container = window._headerV2_subNavManager.ensureSubNavContainer();
                    container.innerHTML = "";
                    try {
                        await window._headerV2_buttonManager.renderSubButtons(mainButton.subButtons, main, lang);
                    } catch (e) {
                        window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการโหลดปุ่มย่อย', 'error');
                    }
                }
                const container = window._headerV2_elements.subButtonsContainer || window._headerV2_subNavManager.ensureSubNavContainer();
                container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                if (subButton) {
                    const subNavBtn = container.querySelector(`button[data-url="${main}-${subButton.url || subButton.jsonFile}"]`);
                    if (subNavBtn) subNavBtn.classList.add('active');
                    window._headerV2_buttonManager.state.currentSubButton = subNavBtn;
                }
                await window._headerV2_contentManager.clearContent();
                if (subButton && subButton.jsonFile) {
                    try {
                        await window._headerV2_contentManager.renderContent([{ jsonFile: subButton.jsonFile }]);
                    } catch (e) {
                        window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการโหลดเนื้อหาย่อย', 'error');
                    }
                }
            } else {
                window._headerV2_subNavManager.hideSubNav();
                window._headerV2_buttonManager.state.currentSubButton = null;
                await window._headerV2_contentManager.clearContent();
                if (mainButton?.jsonFile) {
                    try {
                        await window._headerV2_contentManager.renderContent([{ jsonFile: mainButton.jsonFile }]);
                    } catch (e) {
                        window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการโหลดเนื้อหาหลัก', 'error');
                    }
                }
            }

            await this.updateButtonStates(this.normalizeUrl({ type: main, page: sub }));

            if (!options.maintainScroll) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (error) {
            window._headerV2_contentLoadingManager.hide();
            window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการนำทาง', 'error');
            console.error('navigateTo error', error);
        } finally {
            window._headerV2_contentLoadingManager.hide();
            this.state.isNavigating = false;
        }
    },

    async loadMainAndSubParallel(mainButton, subButton) {
        try {
            const jobs = [];
            if (mainButton?.jsonFile) jobs.push(window._headerV2_dataManager.fetchWithRetry(mainButton.jsonFile, {}, 2));
            if (subButton?.jsonFile) jobs.push(window._headerV2_dataManager.fetchWithRetry(subButton.jsonFile, {}, 3));
            const results = await Promise.all(jobs);
            if (results.length === 2) {
                await window._headerV2_contentManager.renderContent([...results[0], ...results[1]]);
            } else if (results.length === 1) {
                await window._headerV2_contentManager.renderContent(results[0]);
            }
        } catch (error) {
            window._headerV2_utils.showNotification('โหลดเนื้อหาหลัก/ย่อยไม่สำเร็จ', 'error');
        }
    },

    scrollActiveButtonsIntoView() {
        try {
            ['nav ul', '#sub-buttons-container'].forEach(selector => {
                const container = document.querySelector(selector);
                if (!container) return;
                const activeButton = container.querySelector('button.active');
                if (!activeButton) return;
                requestAnimationFrame(() => {
                    try {
                        const containerBounds = container.getBoundingClientRect();
                        const buttonBounds = activeButton.getBoundingClientRect();
                        const scrollLeft = container.scrollLeft + (buttonBounds.left - containerBounds.left) - 20;
                        container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
                    } catch {}
                });
            });
        } catch {}
    }
};