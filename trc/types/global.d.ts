declare interface HeaderV2Runtime {
  poolManager ? : any;
  createVirtualScroller ? : any;
}

declare interface HeaderV2Elements {
  header ? : HTMLElement | null;
  navList ? : HTMLElement | null;
  subButtonsContainer ? : HTMLElement | null;
  contentLoading ? : HTMLElement | null;
  logo ? : HTMLElement | null;
  subNav ? : HTMLElement | null;
  subNavInner ? : HTMLElement | null;
}

declare global {
  interface Window {
    _headerV2_runtime ? : HeaderV2Runtime;
    _headerV2_utils ? : any;
    _headerV2_errorManager ? : any;
    _headerV2_dataManager ? : any;
    _headerV2_contentLoadingManager ? : any;
    _headerV2_contentManager ? : any;
    _headerV2_scrollManager ? : any;
    _headerV2_performanceOptimizer ? : any;
    _headerV2_navigationManager ? : any;
    _headerV2_buttonManager ? : any;
    _headerV2_subNavManager ? : any;
    _headerV2_elements ? : HeaderV2Elements;
    unifiedCopyToClipboard ? : any;
    __removeInstantLoadingOverlay ? : () => void;
    __instantLoadingOverlayShown ? : boolean;
  }
}

export {};