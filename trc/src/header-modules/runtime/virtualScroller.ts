export function createVirtualScroller(container: HTMLElement, options: {
  itemHeightEstimate?: number;
  buffer?: number;
  totalItems?: number;
  renderRange?: (start: number, end: number) => void;
} = {}) {
  const { itemHeightEstimate = 80, buffer = 3, totalItems = 0, renderRange } = options;
  let total = totalItems;
  let viewportHeight = container.clientHeight || window.innerHeight;
  let scrollTop = 0;

  let renderedStart = 0, renderedEnd = -1;

  function measure() {
    viewportHeight = container.clientHeight || window.innerHeight;
  }

  function onScroll() {
    scrollTop = container.scrollTop;
    scheduleRender();
  }

  let raf: number | null = null;
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      doRender();
    });
  }

  function doRender() {
    const estPer = itemHeightEstimate;
    const firstVisible = Math.floor(scrollTop / estPer);
    const visibleCount = Math.ceil(viewportHeight / estPer);
    const start = Math.max(0, firstVisible - buffer);
    const end = Math.min(total - 1, firstVisible + visibleCount + buffer);
    if (start === renderedStart && end === renderedEnd) return;
    renderedStart = start;
    renderedEnd = end;
    try { renderRange && renderRange(start, end); } catch (e) { console.error(e); }
  }

  function updateTotal(n: number) { total = n; scheduleRender(); }
  function scrollToIndex(i: number) { container.scrollTop = Math.max(0, i * itemHeightEstimate); scheduleRender(); }
  function destroy() { container.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); }

  container.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { measure(); scheduleRender(); }, { passive: true });

  measure();
  scheduleRender();

  return { updateTotal, scrollToIndex, destroy };
}

export default createVirtualScroller;