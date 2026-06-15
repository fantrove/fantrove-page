---
version: 1.6.0
date: 2026-06-16T00:00:00Z
title: Fullscreen Popup & Error Notification Overhaul
subtitle: A major upgrade to the popup system introducing fullscreen popups, and a complete overhaul of how errors are displayed across the entire application. All error notifications now use a fullscreen popup with detailed error information and a one-click copy button, replacing the old toast-based approach. Also fixes the version update notification popup that was broken due to an API mismatch.
notify: true
---

### New

- **Fullscreen Popup Type (PopupSystem.fullscreen)**
  A brand new popup type that covers the entire viewport (100vw x 100vh) with a clean, immersive layout. Ideal for rich content panels, error details, search interfaces, or any content that needs the full screen. Supports header toggle (showHeader), two content layout modes ('fit' for internal scrolling, 'stretch' for full-height fill), and browser back button support via the History API (hideOnBack). Uses opacity-only animation for a smooth, app-like transition experience. Operates at z-index 28000, the highest layer in the popup system.

- **showErrorFullscreen() — Centralized Error Display**
  A new utility function in the nav-core system that replaces all scattered error notifications with a single, consistent fullscreen error popup. Every error is now displayed in a structured layout showing the error message, error type classification, timestamp (in both Thai and English), the full error object details, and a prominent "Copy error details" button. The function supports Thai and English labels automatically based on the current language, includes inline CSS injection for self-contained styling, and falls back to a toast notification if the PopupSystem is not yet initialized.

### Improved

- **Error Boundary Now Uses Fullscreen Popups (performance.js)**
  The global error boundary that catches unhandled JavaScript errors has been upgraded to use `showErrorFullscreen()` instead of the old `showNotification()` toast. Errors are now presented with full detail and context, making debugging significantly easier. A 2-second throttle has been added to prevent error popup spam when multiple errors occur in rapid succession.

- **Navigation Error Display (router.js)**
  Navigation failures and routing errors that previously showed as small, easily-missed toasts are now displayed as fullscreen error popups. Users get a clear view of what went wrong during page navigation, with the ability to copy the full error details for reporting.

- **Data Fetching Error Display (data.js)**
  When content fetching fails after all retry attempts are exhausted, the error is now presented as a fullscreen popup instead of a dismissible toast. This ensures users are properly informed about data loading failures and can take action (such as copying the error for support).

- **Initialization Error Handling (init.js)**
  Three error catch blocks in the nav-core initialization module have been updated to use `showErrorFullscreen()`. This means that any errors during the bootstrap phase of the navigation system are now surfaced prominently rather than being silently shown as fleeting toasts.

### Fixed

- **Version Update Notification Popup Not Showing**
  The update notification popup (shown when a new version is deployed) has been broken for an extended period. The root cause was that `version-core.js` was calling `PopupSystem.container()`, a method that does not exist in the PopupSystem API. The correct method `PopupSystem.open()` was always available but was never wired up. This has been fixed, and the update notification popup now correctly displays when a new version is detected, using the standard dialog popup type with the custom update notification content and styling.