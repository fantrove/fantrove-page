---
version: 1.7.0
date: 2026-06-19T08:20:00.693Z
title: FVL — Framework หน้าโหลดใหม่ + ปรับปรุงหน้า Discover ทั้งหมด
subtitle: เปิดตัว FVL (FantroveVerse Loader) framework หน้าโหลดแยกออกจาก Nav-Core รองรับ 4 display modes (fullscreen, scoped, inline, topbar) และปรับปรุงประสบการณ์การโหลดในหน้า Discover ทั้งหมด — ฉลาดขึ้น ทนต่อการกดซ้ำ และกลมกลืนกับแถบนำทางด้านล่าง
notify: true
---

### New

- **FVL (FantroveVerse Loader) v1.0.3 — framework หน้าโหลดใหม่**
  Framework หน้าโหลดแยกออกจาก Nav-Core ใช้สถาปัตยกรรม Hybrid ไฟล์เดียว (~50KB JS + ~17KB CSS, zero dependencies) รองรับ 4 display modes: `fullscreen` (overlay ใต้ header), `scoped` (ครอบ container เฉพาะ), `inline` (spinner ในปุ่ม), และ `topbar` (แถบ progress แบบ NProgress) รองรับ i18n, theme variants (light/dark/brand/auto), `prefers-reduced-motion` และ API แบบ Promise พร้อม system events

- **Navigation Session Pattern — ทนต่อการกดซ้ำ**
  LoadingService proxy ตัวใหม่ใช้ session counter: ทุก `show()` เปิด session, ทุก `hide()` ปิด session overlay จะซ่อนก็ต่อเมื่อทุก session ปิดหมดแล้ว ทำให้ไม่เกิด race condition ที่ทำให้ overlay ค้างบนจอหลังกดซ้ำเร็วๆ — ทดสอบแล้วคงที่ผ่านการกด 30+ ครั้งใน 1 วินาที

- **Smart loading messages ในหน้า Discover**
  เมื่อนำทางระหว่างหมวดหมู่ (Symbols, Emojis, Fancy Text ฯลฯ) overlay จะแสดงข้อความตามบริบท เช่น "Loading Symbols..." หรือ "กำลังโหลดสัญลักษณ์..." แทน "Loading..." แบบเดิมๆ ข้อความถูกดึงจาก label ของปุ่มที่เลือกในภาษาที่ผู้ใช้ตั้งไว้

- **ซ่อน buttons ระหว่างการนำทาง**
  เมื่อมีการนำทางกำลังดำเนินอยู่ ปุ่ม nav หลักและ sub-nav จะจางหาย (opacity: 0, pointer-events: none) และไม่สามารถคลิกได้ ป้องกันผู้ใช้คลิกหมวดหมู่อื่นระหว่างที่กำลังโหลด และส่งสัญญาณภาพชัดเจนว่า "กำลังเปลี่ยน" ปุ่มจะ fade กลับเข้ามาเมื่อเนื้อหาพร้อม

- **Cache-busting สำหรับ nav-core sub-modules**
  `nav-core.js` ตอนนี้ส่ง query string `?v=...` ของตัวเองต่อไปยังทุก sub-module ที่โหลดจาก `nav-core-modules/` ก่อนหน้านี้ browser cache `loading.js`, `router.js` ฯลฯ แยกจากกัน — ทำให้ code ที่แก้ในไฟล์เหล่านั้นไม่ถึงมือผู้ใช้จนกว่าจะ hard-refresh ตอนนี้การ bump version ใน `<script src="nav-core.js?v=...">` ใน HTML จะ bust cache ให้ทุก 13 sub-modules พร้อมกัน

### Improved

- **Loading overlay เว้นที่ให้ bottom navigation**
  fullscreen loading overlay ตอนนี้อยู่หลัง bottom navigation bar (z-index 15999 < 16000) ทำให้ bottom nav ยังมองเห็นและกดได้ตลอดเวลาที่กำลังโหลด บนมือถือ overlay เว้น 64px + safe-area ด้านล่าง; บนเดสก์ท็อป (≥768px) เว้น 88px ด้านซ้ายสำหรับ left-rail navigation

- **ตำแหน่ง spinner**
  spinner ตอนนี้อยู่กลางพื้นที่ที่มองเห็นจริง (ระหว่าง header และ bottom nav) ไม่ใช่ full viewport ทำให้ loading state ดูตั้งใจไม่ใช่ไปครอบ UI elements สำคัญ

- **Minimum display time (250ms)**
  เมื่อ loading overlay แสดงแล้ว จะอยู่ขั้นต่ำ 250ms ก่อนซ่อน — แม้ load จริงจะเสร็จใน <50ms ป้องกัน 1-frame flash ที่ดูเหมือน glitch และให้ผู้ใช้เห็น feedback ชัดเจนว่ามีการเปลี่ยน

- **Demo page สำหรับ FVL**
  เพิ่มหน้า demo ใหม่ที่ `/loading-demo/` โชว์ทั้ง 4 display modes พร้อมปุ่ม interactive, panel สถิติ real-time และ event log มีประโยชน์สำหรับทดสอบและ developer ใหม่ที่อยากเรียนรู้ framework

### Fixed

- **Loading overlay ค้างบนจอหลังกดซ้ำเร็วๆ**
  ก่อนหน้านี้ การกดซ้ำเร็วๆ (10+ ครั้งใน 1 วินาที) อาจทำให้ loading overlay ค้างบนจอไม่ยอมหาย จนต้อง refresh หน้า สาเหตุคือ state กับ DOM ไม่ตรงกัน: FVL state บันทึกว่า instance hidden แล้ว แต่ DOM element ไม่ถูกลบ แก้โดยเปลี่ยนเป็น session-counter pattern ใน LoadingService และเพิ่ม cancel-safe hide logic ใน FVL

- **Loading overlay ไม่แสดงในหน้า Discover**
  ในกรณี load จาก cache (load time <15ms) smart-delay timer ถูก cancel โดย `hide()` ก่อนที่ overlay จะทันแสดง — ทำให้ผู้ใช้ไม่เห็น loading feedback เลย แก้โดยลบ smart-delay timer ออกไปทั้งหมดและใช้ session pattern แทน ซึ่งรับประกันว่า overlay จะแสดงเมื่อมีอย่างน้อย 1 session เปิดอยู่

- **FVL.show() idempotency เสียเมื่อ state='hiding'**
  เมื่อ `FVL.show()` ถูกเรียกขณะที่มี existing instance อยู่ใน state `hiding` (กำลัง leave animation) มัน return handle เดิมโดยไม่ restart enter animation — ทำให้ overlay ค้างในสถานะ half-hidden แก้โดยตรวจจับ state `hiding` โดยเฉพาะ: cancel leave timer ที่ค้างอยู่, restore class `fvl-shown`, force reflow เพื่อ restart transition และ emit `shown` event ใหม่

- **Browser cache ส่ง nav-core sub-modules เวอร์ชั่นเก่า**
  เนื่องจาก `nav-core.js` โหลด sub-modules โดยไม่ส่ง query string `?v=...` ของตัวเองต่อไป browser จึงส่ง cache version ของ `loading.js`, `router.js` ฯลฯ แม้หลัง deploy แล้ว ทำให้ code changes (รวมถึง bug fixes) ไม่ถึงมือผู้ใช้จนกว่าจะ hard-refresh แก้โดย extract query string จาก nav-core.js script tag และ append ให้ทุก sub-module URL

- **Init.js ไม่ balance LoadingService session counter**
  bootstrap flow ใน `init.js` เรียก `LoadingService.show()` ใน Phase 3 แต่ไม่เคยเรียก `hide()` เพื่อ balance — ทำให้ session counter ค้างที่ 1 ตลอดไปและ overlay ไม่ยอมซ่อน แก้โดยเพิ่ม `hide()` ใน `finally` block ของ `InitService.start()`

- **Router safety timeout ไม่ reset loading state**
  เมื่อ 20-second navigation safety timeout ทำงาน มันเรียก `LoadingService.hide()` — แต่ถ้ามี `show()` ที่ค้างอยู่ session counter จะยังอยู่เหนือ 0 และ overlay ยังคงแสดง แก้โดยเปลี่ยน safety timeout ให้ใช้ `LoadingService._forceReset()` แทน ซึ่งรีเซ็ต counter เป็น 0 และซ่อน overlay ทันที
