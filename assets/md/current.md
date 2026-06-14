---
version: 1.4.0
date: 2025-06-14T03:00:00Z
title:
  en: What's New system — Markdown-based
  th: ระบบหน้ามีอะไรใหม่ — ใช้ Markdown
subtitle:
  en: The entire What's New page has been redesigned to use Markdown files instead of JSON for easier update authoring. Release history is now automatically stored and never lost, even if files are removed.
  th: หน้ามีอะไรใหม่ทั้งหมดถูกออกแบบใหม่ให้ใช้ไฟล์ Markdown แทน JSON เพื่อความสะดวกในการเขียนอัพเดท ประวัติการอัพเดทจะถูกบันทึกอัตโนมัติและไม่หาย แม้ไฟล์จะถูกลบ
notify: true
---

### New

- **What's New page now reads Markdown instead of JSON**
  The page fetches MD files, parses front matter and content, and renders release cards. No more manual JSON formatting required — just write plain Markdown with a YAML header.

- **Automatic release history storage in localStorage**
  Every release that is read from MD or imported from legacy JSON is permanently stored in the browser's localStorage. Once stored, the history persists even if the source file is deleted or modified. This ensures no release is ever accidentally lost.

- **Legacy JSON auto-import for seamless migration**
  The system automatically detects and imports data from the old whats-new.json and release-history.json files on first visit. This means the transition to MD is completely transparent — no history is lost during the format change.

- **MD documentation for the update system**
  A dedicated documentation file explains how the system works, how to write MD updates correctly, and the expected format for front matter and content sections.

### Improved

- **Version-core.js now reads from localStorage cache**
  The update notification popup no longer depends on whats-new.json. It reads the latest release from the localStorage cache, which is populated by the MD parser. This unifies the data source and eliminates JSON dependency.

- **Smarter version detection and history deduplication**
  When MD files or legacy JSON are imported, the system intelligently deduplicates entries by version number. If an entry already exists in localStorage, it is updated only if the new data is more recent — preventing duplicate or stale records.

### Fixed

- **release-history.json being empty no longer breaks history display**
  The old system relied entirely on the JSON file for history. If the file was empty or missing, all history vanished. The new localStorage-based system remembers everything independently of source files.