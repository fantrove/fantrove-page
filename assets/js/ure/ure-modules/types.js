// Path:    assets/js/ure/ure-modules/types.js
// Purpose: Central JSDoc typedefs for the Universal Render Engine.
//          No runtime code — load first so all modules benefit from type hints.
// Used by: All URE modules

// ── Engine options ────────────────────────────────────────────────────────────

/**
 * Configuration object passed to `new URE.Engine(options)`.
 *
 * @typedef {Object} UREngineOptions
 * @property {Element|string}  container             - Mount target (Element or CSS selector)
 * @property {any[]}           data                  - Array of items to render
 * @property {RenderFn}        template              - (item, lang) => HTML string
 * @property {number}          [estimatedItemHeight=96]  - px estimate per item before measure
 * @property {number}          [buffer=600]          - px outside viewport to pre-render
 * @property {boolean}         [recycling=true]      - Enable DOM node pool reuse
 * @property {boolean}         [diffing=true]        - Enable data diffing (only re-render changed)
 * @property {string}          [keyField='id']       - Field used as item identity for diffing
 * @property {string}          [lang='en']           - Language code passed to template
 * @property {number}          [poolCap=60]          - Max nodes kept in recycle pool per type
 * @property {OnVisibleFn}     [onVisible]           - Called when item enters buffer zone
 * @property {OnHiddenFn}      [onHidden]            - Called when item leaves buffer zone
 * @property {OnUpdateFn}      [onUpdate]            - Called after any data update completes
 * @property {OnItemClickFn}   [onItemClick]         - Delegated click handler for rendered items
 */

/**
 * Template render function.
 * @callback RenderFn
 * @param {any}    item - Data item to render
 * @param {string} lang - Active language code
 * @returns {string} HTML string representing the item
 */

/**
 * @callback OnVisibleFn
 * @param {any}         item - The data item
 * @param {HTMLElement} el   - The DOM element now visible
 */

/**
 * @callback OnHiddenFn
 * @param {any} item - The data item that was hidden
 */

/**
 * @callback OnUpdateFn
 * @param {{ added: number, removed: number, changed: number }} stats
 */

/**
 * @callback OnItemClickFn
 * @param {MouseEvent} event
 * @param {any}        item  - Data item associated with the clicked element
 */

// ── Internal types ────────────────────────────────────────────────────────────

/**
 * Internal item record used by the engine.
 * @typedef {Object} URItemRecord
 * @property {any}              data    - Original data item
 * @property {string}           key     - Derived identity key
 * @property {number}           index   - Current array index
 * @property {HTMLElement|null} el      - Mounted DOM node (null = pooled/removed)
 */

/**
 * A pending task in the scheduler queue.
 * @typedef {Object} URTask
 * @property {'visual'|'background'} priority
 * @property {Function} fn
 * @property {string}   name  - Debug label
 */

/**
 * Diff result comparing old vs new data arrays.
 * @typedef {Object} URDiffResult
 * @property {Map<string, {index:number, item:any}>} added
 * @property {Set<string>}                           removed
 * @property {Map<string, {index:number, item:any}>} changed
 * @property {Map<string, number>}                   moved
 */

/**
 * Pool entry keyed by template type.
 * @typedef {Object} URPoolBucket
 * @property {HTMLElement[]} nodes
 * @property {number}        cap
 */

window.UREModules = window.UREModules || {};