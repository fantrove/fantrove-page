// @ts-check
/**
 * @file types.js
 * Central typedef file — shared types for all NavCore modules.
 * No runtime code. Loaded first so all subsequent modules benefit from type hints.
 *
 * @module types
 */

// ── DOM state ─────────────────────────────────────────────────────────────────

/**
 * Cached DOM element references used across NavCore modules.
 * Owned by InitService; populated at bootstrap.
 *
 * @typedef {Object} NavElements
 * @property {HTMLElement|null}     header
 * @property {HTMLUListElement|null} navList
 * @property {HTMLElement|null}     subButtonsContainer
 * @property {HTMLElement|null}     contentLoading
 * @property {HTMLElement|null}     logo
 * @property {HTMLElement|null}     subNav
 * @property {HTMLElement|null}     subNavInner
 */

// ── Navigation state ──────────────────────────────────────────────────────────

/**
 * SPA routing/navigation state.
 * Owned by RouterService.
 *
 * @typedef {Object} NavigationState
 * @property {boolean} isNavigating        — mutex preventing double-render
 * @property {string}  currentMainRoute    — active main button URL key
 * @property {string}  currentSubRoute     — active sub-button URL key
 * @property {string}  previousUrl         — previous normalized URL
 * @property {number}  lastScrollPosition  — scroll Y before navigation
 * @property {boolean} initialNavigation   — true until first navigation completes
 */

// ── Button state ──────────────────────────────────────────────────────────────

/**
 * Button/nav configuration state.
 * Owned by ButtonService.
 *
 * @typedef {Object} ButtonState
 * @property {ButtonsConfig|null}   config               — loaded from buttons.json
 * @property {Map<string,ButtonEntry>} buttonMap          — url → {button, config}
 * @property {HTMLElement|null}     currentMainButton
 * @property {HTMLElement|null}     currentSubButton
 * @property {string|null}          currentMainButtonUrl
 */

// ── Shared application state ──────────────────────────────────────────────────

/**
 * Single shared mutable application state.
 *
 * @typedef {Object} NavState
 * @property {boolean}         isBootstrapping  — true until InitService.start() completes
 * @property {NavElements}     elements         — cached DOM refs [InitService]
 * @property {NavigationState} navigation       — routing state [RouterService]
 * @property {ButtonState}     buttons          — button config + active state [ButtonService]
 */

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Sub-button configuration from buttons.json.
 *
 * @typedef {Object} SubButtonConfig
 * @property {string}  url
 * @property {string}  [jsonFile]
 * @property {string}  [en_label]
 * @property {string}  [th_label]
 * @property {string}  [className]
 * @property {boolean} [isDefault]
 */

/**
 * Main button configuration from buttons.json.
 *
 * @typedef {Object} MainButtonConfig
 * @property {string}              url
 * @property {string}              [jsonFile]
 * @property {string}              [en_label]
 * @property {string}              [th_label]
 * @property {string}              [className]
 * @property {boolean}             [isDefault]
 * @property {SubButtonConfig[]}   [subButtons]
 */

/**
 * Shape of /assets/json/buttons.json.
 *
 * @typedef {Object} ButtonsConfig
 * @property {MainButtonConfig[]} mainButtons
 */

/**
 * Entry stored in State.buttons.buttonMap.
 *
 * @typedef {Object} ButtonEntry
 * @property {HTMLButtonElement} button
 * @property {MainButtonConfig}  config
 */

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Parsed URL structure returned by RouterService.parseUrl().
 *
 * @typedef {Object} ParsedUrl
 * @property {string} main  — main route key (maps to mainButton.url)
 * @property {string} sub   — sub route key (maps to subButton.url)
 */

/**
 * Options accepted by RouterService.navigateTo().
 *
 * @typedef {Object} NavOptions
 * @property {boolean} [skipUrlUpdate]   — do not call history.pushState/replaceState
 * @property {boolean} [replace]         — use replaceState instead of pushState
 * @property {boolean} [forcePush]       — always use pushState
 * @property {boolean} [isPopState]      — triggered from a popstate event
 * @property {boolean} [maintainScroll]  — do not scroll to top after navigate
 */

// ── Loading overlay ───────────────────────────────────────────────────────────

/**
 * Options accepted by LoadingService.show().
 *
 * @typedef {Object|string} LoadingOptions
 * @property {string} [message]         — custom loading message
 * @property {number} [autoHideAfterMs] — auto-hide after N ms
 */

// ── Content item ──────────────────────────────────────────────────────────────

/**
 * A single renderable content item (button, card, or group).
 *
 * @typedef {Object} ContentItem
 * @property {string}  [type]         — 'button' | 'card' | 'group'
 * @property {string}  [id]
 * @property {string}  [api]
 * @property {string}  [text]
 * @property {string}  [content]
 * @property {string}  [jsonFile]
 * @property {boolean} [_fetched]
 * @property {Object}  [group]
 * @property {string}  [categoryId]
 * @property {string}  [image]
 * @property {any}     [imageAlt]
 * @property {any}     [title]
 * @property {any}     [name]
 * @property {any}     [description]
 * @property {string}  [link]
 * @property {string}  [className]
 */

window.NavCoreModules = window.NavCoreModules || {};