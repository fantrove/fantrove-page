---
version: 1.7.2
date: 2026-06-19T15:18:20.246Z
title: โหลดแสดงทุกครั้ง + สปินเนอร์หมุนลื่นไหล
subtitle: แก้ปัญหาสำคัญ 2 อย่างของระบบ loading: (1) overlay ตอนนี้แสดงทุกครั้งที่นำทาง แม้ติดกัน พร้อม pulse animation เพื่อส่งสัญญาณ operation ใหม่; (2) สปินเนอร์ตอนนี้หมุนลื่นไหลที่ refresh rate เต็ม โดยย้าย CSS keyframes ออกจาก @layer ลบ transform: translateZ(0) ที่ขัดแย้ง และเพิ่ม backface-visibility สำหรับ GPU acceleration
notify: true
---

### Fixed

- **Loading overlay ไม่แสดงทุกครั้งที่นำทาง**
  เมื่อนำทางระหว่างหมวดหมู่เร็วๆ design v1.7.1 เดิมพึ่ง idempotency ของ FVL — การเรียก show() บน instance ที่ shown อยู่แค่ update message แปลว่า navigation ถัดไปไม่มี loading state ที่มองเห็น เพราะ overlay อยู่แล้ว
  
  v1.7.2 แก้โดย ALWAYS เรียก FVL.show() (ซึ่งเป็น idempotent และจัดการ state ทั้งหมดถูกต้อง) แล้วเพิ่ม "pulse" animation (opacity dip สั้นๆ + scale) เมื่อ overlay อยู่แล้ว ทำให้ผู้ใช้เห็น feedback ชัดเจนว่า operation ใหม่เริ่มแล้ว แม้ระหว่าง navigation ติดกัน

- **สปินเนอร์ดูค้าง / หมุนน้อยมาก**
  ปัญหา CSS 2 อย่างทำให้สปินเนอร์ค้างหรือหมุนช้ามาก:
  1. `@keyframes _fvl_spin` อยู่ใน `@layer fvl` — browser บางตัว (และ headless test environments) ไม่ parse keyframes ใน @layer อย่างสมบูรณ์ ทำให้ animation ไม่ทำงาน
  2. `transform: translateZ(0)` ถูกตั้งบน arc element — มัน OVERRIDE animation's `transform: rotate()` ทำให้สปินเนอร์ค้างที่ 0deg
  
  แก้โดย:
  - ย้าย @keyframes ทั้งหมดออกจาก @layer (มันเป็น global โดยธรรมชาติ ไม่ต้องการ layer isolation)
  - ลบ `transform: translateZ(0)` จาก arc — ใช้ `will-change: transform` + `backface-visibility: hidden` แทนสำหรับ GPU acceleration
  - ลบ `contain: strict` จาก fullscreen/topbar overlays (เปลี่ยนเป็น `contain: layout style`) — `strict` รวม `paint` + `size` containment ที่อาจ freeze child animations
  - เพิ่ม `animation-play-state: running` อย่างชัดเจนเพื่อป้องกัน paused state ที่ inherited

- **Overlay มองไม่เห็นเพราะ `hidden` attribute ค้าง**
  `buildFullscreen()` renderer เดิมตั้ง `hidden=""` attribute บน overlay element แต่ CSS มี rule `.fvl-fullscreen[hidden] { display: none !important }` ที่ซ่อนถาวร แม้เราจะลบ CSS rule ในเวอร์ชั่นก่อน แต่ attribute ยังถูกตั้ง ทำให้ `display: none` ใน browser บางตัว
  
  แก้โดยลบ `hidden` attribute จาก renderer ทั้งหมด — visibility ควบคุมด้วย class `.fvl-entering` / `.fvl-shown` / `.fvl-leaving` (opacity transitions) เท่านั้น

- **LoadingService.hide() ถูกเรียกเร็วเกินไปโดย ContentService**
  ContentService เรียก LoadingService.hide() หลายครั้งหลัง render content ใน cached loads (<50ms) ทำให้ overlay flash 1 frame แล้วหาย — เร็วเกินไปที่ผู้ใช้จะเห็น v1.7.2 เพิ่ม MIN_VISIBLE_MS (200ms) check: ถ้า overlay แสดงน้อยกว่า 200ms ที่ผ่านมา hide() จะถูกเลื่อนจนกว่า 200ms จะครบ นี่ไม่ใช่ delay บน show() (overlay แสดงทันที) เป็นเพียง minimum visible time บน hide()

- **Router ไม่ balance LoadingService sessions**
  router เรียก LoadingService.show() ที่จุดเริ่ม navigateTo() แต่เรียก hide() ใน catch block — แปลว่า navigation สำเร็จ session counter ค้างที่ 1 ตลอดไป v1.7.2 ย้าย hide() call ไป finally block เพื่อให้ทำงานเสมอ ไม่ว่า navigation จะสำเร็จหรือล้มเหลว

### Improved

- **สปินเนอร์หมุนแบบ GPU-accelerated และ refresh-rate-independent**
  arc ของสปินเนอร์ใช้ `will-change: transform` + `backface-visibility: hidden` สำหรับ compositor-layer promotion animation หมุนทั้งหมดบน GPU แยกจาก main thread (ซึ่งอาจยุ่งกับ navigation/data-fetching) แปลว่า:
  - หมุนลื่นไหลที่ refresh rate ใดๆ (60Hz, 90Hz, 120Hz, 144Hz)
  - ไม่ stutter เมื่อ main thread โหลด
  - ความเร็วหมุนสม่ำเสมอไม่ว่า CPU จะใช้มากแค่ไหน

- **ระยะเวลาหมุน 0.7s ตามมาตรฐาน**
  เปลี่ยนระยะเวลาหมุนจาก 0.8s เป็น 0.7s ต่อรอบ — มาตรฐาน de-facto สำหรับ Material Design และ iOS spinners รู้สึก responsive มากขึ้นโดยไม่เร็วเกินไป

- **Pulse animation ส่งสัญญาณ operation ใหม่**
  เมื่อ show() ถูกเรียกขณะ overlay อยู่แล้ว (เช่น ผู้ใช้คลิกหมวดหมู่อื่นระหว่างโหลดอันก่อน) overlay จะ dip เป็น 0.6 opacity + scale เป็น 0.97 สั้นๆ แล้วกลับปกติ pulse 350ms นี้ให้ feedback ชัดเจนว่า operation ใหม่เริ่มแล้ว แม้สปินเนอร์กำลังหมุนอยู่

### Removed

- **`transform: translateZ(0)` บน spinner arc**
  ลบเพราะมัน override animation's `transform: rotate()` ทำให้สปินเนอร์ค้าง แทนที่ด้วย `backface-visibility: hidden` สำหรับ GPU acceleration

- **`contain: strict` บน fullscreen และ topbar overlays**
  เปลี่ยนเป็น `contain: layout style` — `strict` รวม `paint` + `size` containment ที่อาจ freeze child animations ใน browser บางตัว

- **`@keyframes` ใน `@layer fvl`**
  ย้าย @keyframes ทั้งหมดออกจาก @layer เพื่อ browser compatibility สูงสุด keyframes เป็น global โดยธรรมชาติ ไม่ได้ประโยชน์จาก layer isolation
