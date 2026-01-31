// registerOptimizations.js
// Integrate pool + virtual scroller with existing contentManager (lightweight adapter).
import poolManager from './runtime/poolManager.js';
import createVirtualScroller from './runtime/virtualScroller.js';

export function setupHeaderRuntimeAdapters(windowObj = window) {
  // Register templates from DOM (if page includes template nodes)
  try {
    const sampleCard = document.querySelector('.card') || (function() {
      // create minimal template matching CSS structure (visuals unaffected)
      const t = document.createElement('div');
      t.className = 'card';
      t.innerHTML = '<div class="card-content"><div class="card-title"></div><div class="card-description"></div></div>';
      return t;
    })();
    poolManager.registerTemplate('card', sampleCard, 12);
    
    const sampleBtn = document.querySelector('.button-content') || (function() {
      const t = document.createElement('button');
      t.className = 'button-content';
      t.textContent = '';
      return t;
    })();
    poolManager.registerTemplate('button', sampleBtn, 24);
  } catch (e) { console.warn('register templates failed', e); }
  
  // Expose poolManager to global headerV2 so other modules (contentManager) can use it
  if (!windowObj._headerV2_runtime) windowObj._headerV2_runtime = {};
  windowObj._headerV2_runtime.poolManager = poolManager;
  windowObj._headerV2_runtime.createVirtualScroller = createVirtualScroller;
}

export default setupHeaderRuntimeAdapters;