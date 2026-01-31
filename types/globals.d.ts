declare namespace HeaderV2 {
  interface Runtime {
    poolManager?: any;
    createVirtualScroller?: any;
  }
  interface ContentLoadingManager { show?: Function; hide?: Function; LOADING_CONTAINER_ID?: string; }
  interface DataManager { loadApiDatabase?: Function; fetchWithRetry?: Function; _warmup?: Function; }
  interface Utils { showNotification?: Function; errorManager?: any; isOnline?: Function; }
}

declare global {
  interface Window {
    _headerV2_utils?: any;
    _headerV2_errorManager?: any;
    _headerV2_dataManager?: HeaderV2.DataManager;
    _headerV2_contentLoadingManager?: HeaderV2.ContentLoadingManager;
    _headerV2_contentManager?: any;
    _headerV2_scrollManager?: any;
    _headerV2_performanceOptimizer?: any;
    _headerV2_navigationManager?: any;
    _headerV2_buttonManager?: any;
    _headerV2_subNavManager?: any;
    _headerV2_runtime?: HeaderV2.Runtime;
    unifiedCopyToClipboard?: any;
    __removeInstantLoadingOverlay?: Function;
    __instantLoadingOverlayShown?: boolean;
  }
}

export {};