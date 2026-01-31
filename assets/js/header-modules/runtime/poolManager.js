// poolManager.js
// Simple DOM pooling for repeated components (cards/buttons).
// API:
//  poolManager.registerTemplate(id, templateNode, initialSize = 8)
//  const node = poolManager.acquire(id)
//  poolManager.release(id, node)
//  poolManager.prewarm(id, count)

const poolManager = {
  _pools: new Map(),
  
  registerTemplate(id, templateNode, initialSize = 8) {
    if (this._pools.has(id)) return;
    const pool = { template: templateNode, free: [], inUse: new Set() };
    this._pools.set(id, pool);
    // pre-create clones
    for (let i = 0; i < initialSize; i++) {
      const n = templateNode.cloneNode(true);
      n.removeAttribute('id');
      pool.free.push(n);
    }
  },
  
  acquire(id) {
    const pool = this._pools.get(id);
    if (!pool) throw new Error(`Pool not registered: ${id}`);
    let node;
    if (pool.free.length) {
      node = pool.free.pop();
    } else {
      node = pool.template.cloneNode(true);
      node.removeAttribute('id');
    }
    pool.inUse.add(node);
    return node;
  },
  
  release(id, node) {
    const pool = this._pools.get(id);
    if (!pool) return;
    if (pool.inUse.has(node)) {
      pool.inUse.delete(node);
      // cleanup node (optional)
      node.classList.remove('fade-in', 'fade-out', 'active');
      // remove any per-instance listeners if added elsewhere
      pool.free.push(node);
    }
  },
  
  prewarm(id, count = 4) {
    const pool = this._pools.get(id);
    if (!pool) return;
    for (let i = 0; i < count; i++) {
      const n = pool.template.cloneNode(true);
      n.removeAttribute('id');
      pool.free.push(n);
    }
  }
};

export default poolManager;