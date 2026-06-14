// Path:    assets/js/popup-modules/types.js
// Purpose: Central JSDoc typedefs for the Popup System.
//          No runtime code — load first so all modules benefit from type hints.
// Used by: All popup-modules

// ── Popup type presets ───────────────────────────────────────────────────────

/**
 * Built-in popup type presets. Each defines a starting configuration
 * that can be overridden per-popup via PopupSystem.open().
 *
 * @typedef {'dialog'|'alert'|'confirm'|'sheet'|'toast'|'drawer'|'tooltip'|'popover'}
 *   PopupPreset
 */

// ── Public API options ───────────────────────────────────────────────────────

/**
 * Options object passed to `PopupSystem.open()`.
 * Every property is optional — sensible defaults from the chosen preset apply.
 * Properties here override the preset's defaults.
 *
 * @typedef {Object} PopupOptions
 *
 * ── Identity ──
 * @property {string}            [id]                  - Unique ID. Auto-generated if omitted.
 * @property {PopupPreset}       [type='dialog']      - Preset to base configuration on.
 * @property {string}            [title]               - Header text (null hides header entirely).
 * @property {string|HTMLElement} [body]               - Content — HTML string or DOM element.
 * @property {string}            [footer]              - Footer HTML string (null hides footer).
 *
 * ── Size & position ──
 * @property {string}            [size]                - Named size: 'xs'|'sm'|'md'|'lg'|'xl'|'full'.
 *                                                       Overrides preset size.
 * @property {string}            [position='center']   - 'center'|'top'|'bottom'|'left'|'right'|
 *                                                       'top-left'|'top-right'|'bottom-left'|'bottom-right'.
 * @property {string}            [anchor]              - CSS selector for element to anchor near
 *                                                       (for tooltip/popover positioning).
 * @property {string}            [placement='bottom']  - For anchored popups: 'top'|'bottom'|'left'|'right'|
 *                                                       'auto'.
 *
 * ── Appearance ──
 * @property {string}            [theme='light']       - 'light'|'dark'|'brand'.
 * @property {string}            [variant]             - Named visual variant (CSS class appended).
 * @property {boolean}           [glassmorphism=false] - Enable frosted-glass backdrop.
 * @property {boolean}           [borderless=false]    - Remove border.
 * @property {boolean}           [shadow='md']         - 'none'|'sm'|'md'|'lg'|'xl'.
 *
 * ── Behavior ──
 * @property {boolean}           [closable=true]       - Show close button + allow overlay click dismiss.
 * @property {boolean}           [dismissOnOverlay=true]- Close when clicking the dimmed overlay.
 * @property {boolean}           [dismissOnEscape=true] - Close on Escape key.
 * @property {boolean}           [persistent=false]    - Cannot be dismissed (no overlay click, no escape).
 * @property {boolean}           [blocking=false]      - Blocks interaction with the page behind.
 * @property {boolean}           [stackable=true]      - Can appear alongside other popups in a stack.
 * @property {number}            [zIndex]              - Override automatic z-index stacking.
 * @property {number}            [timeout]             - Auto-close after N ms (0 = no auto-close).
 * @property {string}            [group]               - Group name — only one popup per group open at a time.
 *                                                       Opening a new popup in the same group closes the old one.
 *
 * ── Animation ──
 * @property {string}            [enterAnimation]      - Override enter animation name.
 * @property {string}            [exitAnimation]       - Override exit animation name.
 * @property {number}            [animationDuration]   - Override animation duration (ms).
 * @property {'ease'|'spring'|'bounce'|'linear'} [easing='ease'] - Animation easing curve.
 *
 * ── Scroll behavior ──
 * @property {boolean}           [lockScroll=true]     - Lock page scroll while open.
 * @property {string}            [scrollContainer]     - CSS selector for the scrollable area inside popup.
 *                                                       Defaults to the popup body.
 *
 * ── Callbacks ──
 * @property {Function}         [onOpen]              - (popupId, instance) => void — fires after enter animation.
 * @property {Function}         [onClose]             - (popupId, result) => void — fires after exit animation.
 *                                                       result = { action: 'close'|'confirm'|'cancel'|'dismiss',
 *                                                                   data: any }
 * @property {Function}         [onBeforeClose]       - (popupId) => boolean|Promise<boolean> — return false to
 *                                                       prevent closing (for unsaved changes guard).
 * @property {Function}         [onMount]             - (containerEl, instance) => void — fires when DOM is ready
 *                                                       but before animation starts. Useful for attaching
 *                                                       event listeners inside the popup.
 *
 * ── Accessibility ──
 * @property {string}            [role]                - ARIA role override.
 * @property {string}            [ariaLabel]           - Accessible name for the popup.
 * @property {string}            [ariaDescribedBy]     - ID of element describing the popup.
 * @property {boolean}           [focusTrap=true]      - Trap keyboard focus inside the popup.
 * @property {boolean}           [returnFocus=true]    - Return focus to the trigger element on close.
 * @property {Element}           [triggerEl]           - The element that triggered this popup.
 */

/**
 * @typedef {Object} PopupHandle
 * Returned by PopupSystem.open(). Used to programmatically control the popup.
 *
 * @property {string}   id              - Unique popup instance ID.
 * @property {PopupOptions} options     - Resolved options (merged preset + overrides).
 * @property {HTMLElement} element      - Root popup DOM element.
 * @property {HTMLElement} bodyElement  - Content area DOM element.
 * @property {Function} close           - (result?) => Promise<void> — close this popup.
 * @property {Function} update          - (newOptions) => void — merge new options and re-render.
 * @property {Function} setContent      - (htmlString|HTMLElement) => void — replace body content.
 * @property {Function} setFooter       - (htmlString) => void — replace footer content.
 * @property {Function} setTitle        - (string) => void — replace title.
 * @property {Function} getState        - () => 'opening'|'open'|'closing'|'closed'.
 * @property {Function} on              - (event, fn) => unsub — subscribe to instance events.
 * @property {Function} destroy         - () => void — immediate DOM removal (no animation).
 */

// ── Internal types ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} PopupInstance
 * Internal representation of an active popup.
 * @property {string}         id
 * @property {PopupOptions}   options
 * @property {HTMLElement}    rootEl
 * @property {HTMLElement}    overlayEl
 * @property {HTMLElement}    bodyEl
 * @property {HTMLElement}    headerEl
 * @property {HTMLElement}    footerEl
 * @property {HTMLElement|null} triggerEl
 * @property {string}         state   - 'opening'|'open'|'closing'|'closed'|'destroyed'
 * @property {number}         openAt  - Date.now() when opened
 * @property {number}         zIndex
 * @property {number|null}    autoCloseTimer
 * @property {Set<Function>}  listeners
 */

/**
 * @typedef {Object} AnimationDef
 * @property {string}  name          - CSS class name (e.g. 'fp-enter-center')
 * @property {string}  easing        - CSS transition-timing-function
 * @property {number}  duration      - ms
 * @property {string}  fillMode      - CSS animation-fill-mode
 */

/**
 * @typedef {Object} PresetConfig
 * Full resolved configuration for a preset.
 * @property {PopupPreset} type
 * @property {string}      defaultSize
 * @property {string}      defaultPosition
 * @property {boolean}     hasOverlay
 * @property {boolean}     hasHeader
 * @property {boolean}     hasFooter
 * @property {boolean}     hasCloseButton
 * @property {boolean}     defaultClosable
 * @property {boolean}     defaultBlocking
 * @property {boolean}     defaultLockScroll
 * @property {boolean}     defaultFocusTrap
 * @property {boolean}     defaultStackable
 * @property {boolean}     defaultDismissOnOverlay
 * @property {boolean}     defaultDismissOnEscape
 * @property {string}      enterAnimation
 * @property {string}      exitAnimation
 * @property {string}      defaultRole
 * @property {string}      zIndexLayer  - Which z-index layer this preset uses
 */

window.PopupModules = window.PopupModules || {};