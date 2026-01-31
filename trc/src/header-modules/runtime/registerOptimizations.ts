import poolManager from './runtime/poolManager.js';
import createVirtualScroller from './runtime/virtualScroller.js';

export function setupHeaderRuntimeAdapters(windowObj: Window & any = window) {
  try {
    const sampleCard = document.querySelector('.card') || (function() {
      const t = document.createElement('div');
      t.className = 'card';
      t.innerHTML = '<div class="card-content"><div class="card-title"></div><div class="card-description"></div></div>';
      return t;
    })();
    poolManager.registerTemplate('card', sampleCard as any, 12);
    
    const sampleBtn = document.querySelector('.button-content') || (function() {
      const t = document.createElement('button');
      t.className = 'button-content';
      t.textContent = '';
      return t;
    })();
    poolManager.registerTemplate('button', sampleBtn as any, 24);
  } catch (e) {
    console.warn('register templates failed', e);
  }
  
  if (!windowObj._headerV2_runtime) windowObj._headerV2_runtime = {};
  windowObj._headerV2_runtime.poolManager = poolManager;
  windowObj._headerV2_runtime.createVirtualScroller = createVirtualScroller;
}

export default setupHeaderRuntimeAdapters;