type PoolNode = Node & HTMLElement;

interface Pool {
  template: PoolNode;
  free: PoolNode[];
  inUse: Set<PoolNode>;
}

const poolManager = {
  _pools: new Map<string, Pool>(),

  registerTemplate(id: string, templateNode: PoolNode, initialSize = 8) {
    if (this._pools.has(id)) return;
    const pool: Pool = { template: templateNode, free: [], inUse: new Set() };
    this._pools.set(id, pool);
    for (let i = 0; i < initialSize; i++) {
      const n = templateNode.cloneNode(true) as PoolNode;
      if (n instanceof Element) n.removeAttribute('id');
      pool.free.push(n);
    }
  },

  acquire(id: string): PoolNode {
    const pool = this._pools.get(id);
    if (!pool) throw new Error(`Pool not registered: ${id}`);
    let node: PoolNode;
    if (pool.free.length) {
      node = pool.free.pop() as PoolNode;
    } else {
      node = pool.template.cloneNode(true) as PoolNode;
      if (node instanceof Element) node.removeAttribute('id');
    }
    pool.inUse.add(node);
    return node;
  },

  release(id: string, node?: PoolNode) {
    const pool = this._pools.get(id);
    if (!pool || !node) return;
    if (pool.inUse.has(node)) {
      pool.inUse.delete(node);
      if (node instanceof Element) {
        node.classList.remove('fade-in', 'fade-out', 'active');
      }
      pool.free.push(node);
    }
  },

  prewarm(id: string, count = 4) {
    const pool = this._pools.get(id);
    if (!pool) return;
    for (let i = 0; i < count; i++) {
      const n = pool.template.cloneNode(true) as PoolNode;
      if (n instanceof Element) n.removeAttribute('id');
      pool.free.push(n);
    }
  }
};

export default poolManager;