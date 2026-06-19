---
version: 1.7.1
date: 2026-06-19T09:18:05.948Z
title: ระบบโหลดปรับสถาปัตยกรรมใหม่ — ไม่มีดีเลย์ สอดคล้องเสมอ
subtitle: ปรับ LoadingService proxy และ FVL hide logic ทั้งหมดใหม่เพื่อกำจัดบั๊ก state-vs-DOM desync ที่ทำให้ loading overlay ค้างบนจอถาวรหลังกดซ้ำเร็วๆ สถาปัตยกรรมใหม่นี้ไม่มี smart delay และไม่มี minimum display time — overlay แสดงและซ่อนทันทีตามสถานะจริงของ FVL ที่สอดคล้องกับ DOM เสมอ
notify: true
---

### Fixed

- **Loading overlay ค้างบนจอหลังกดซ้ำเร็วๆ (แก้จริงจัง)**
  design session-counter ของ v1.7.0 ยังมีข้อบกพร่องร้ายแรง: มัน cache `_visible` flag และใช้ `_hideDeferTimer` เพื่อบังคับ minimum display time ภายใต้การกดซ้ำเร็วๆ flag ที่ cache นี้อาจ drift จากสถานะจริงของ FVL — LoadingService คิดว่า overlay กำลังแสดง (เลยข้ามการเรียก `FVL.show()`) แต่ FVL ได้ลบ DOM element ไปแล้วระหว่าง hide animation ผลคือ overlay ไม่ยอมแสดงอีกแม้มี session เปิดอยู่ หรือค้างแสดงหลัง session ปิดหมด จนต้อง refresh หน้า
  
  design v1.7.1 กำจัด cached flag ออกไปทั้งหมด `show()` ตอนนี้ forward ไป `FVL.show()` เสมอ (ซึ่งเป็น idempotent — เรียกบน instance ที่ shown อยู่แค่ update message; เรียกบน hiding instance จะ cancel hide) `hide()` เรียก `FVL.hide()` โดยตรงเมื่อ session counter ถึง 0 ไม่มี cached state ให้ drift

- **FVL hide animation callback ไปลบ DOM ของ instance ที่ re-shown แล้ว**
  เมื่อ `FVL.hide()` ถูกเรียก มันรัน leave animation พร้อม callback ที่ทำ DOM cleanup ถ้า `FVL.show()` ถูกเรียกระหว่าง animation (rapid-click scenario) show จะ restore visual state แต่ pending hide callback ยังคงทำงานเมื่อ animation จบ — ไปลบ DOM ของ instance ที่ควรจะอยู่
  
  แก้โดยเพิ่ม `_cancelHide` flag เมื่อ `show()` ตรวจพบ instance ใน state `hiding` จะ set `_cancelHide = true` hide callback ตรวจ flag นี้และกลายเป็น no-op ถ้า set อยู่ ทำให้ไม่มีการ cleanup instance ที่ re-shown แล้ว

- **Smart delay ถูกลบออกทั้งหมด**
  smart-delay timer เดิม (80ms ใน v1.0.3, 200ms ใน v1.0.0) ออกแบบมาเพื่อหลีกเลี่ยงการ flash loader สำหรับ load เร็ว แต่มันสร้างปัญหามากกว่าแก้:
  - ใน cached loads (<15ms) timer ถูก cancel โดย `hide()` ก่อน fire ทำให้ overlay ไม่แสดงเลย
  - เมื่อ `hide()` มาระหว่าง smart-delay window design v1.0.3 force-flush show — แต่สร้าง state transition ซับซ้อนที่คิดตามยาก
  
  v1.7.1 ไม่มี smart delay overlay แสดงทันทีตอน `show()` และซ่อนทันทีตอน `hide()` ง่ายกว่า คาดเดาได้ และตรงความคาดหวังของผู้ใช้

- **Minimum display time ถูกลบออก**
  design v1.0.3 บังคับ overlay อย่างน้อย 250ms (เดิม 300ms) ก่อนซ่อน เพื่อหลีกเลี่ยง 1-frame flash แต่ทำให้แม้ content พร้อมแล้ว ผู้ใช้ต้องรอ 250ms จ้อง spinner — รู้สึกช้า
  
  v1.7.1 ไม่มี minimum display time overlay ซ่อนทันทีที่ session สุดท้ายปิด สำหรับ load เร็วมาก overlay อาจ flash สั้นๆ — แต่นี่ดีกว่าค้างหรือรู้สึกช้า

### Improved

- **พฤติกรรม loading ง่ายขึ้น คาดเดาได้มากขึ้น**
  LoadingService ใหม่เล็กลง ~30% (9.3 KB จาก 13.1 KB) และคิดตามง่ายกว่ามาก:
  - `show()`: increment counter, เรียก `FVL.show()` (idempotent)
  - `hide()`: decrement counter, ถ้า 0 ก็เรียก `FVL.hide()`
  - ไม่มี cached `_visible` flag, ไม่มี `_hideDeferTimer`, ไม่มี `_scheduleHide()`, ไม่มี `_reconcile()`
  
  ความเรียบง่ายนี้ทำให้ระบบทนต่อ combination ใดๆ ของ rapid show/hide calls — ซึ่งคือสิ่งที่เกิดเมื่อผู้ใช้กดปุ่ม navigation รัวๆ

- **FVL show() idempotency น่าเชื่อถือสมบูรณ์**
  `show()` function ตอนนี้จัดการ state ที่เป็นไปได้ทั้ง 4 อย่างถูกต้อง:
  - `null` (ไม่มี instance) → สร้างใหม่
  - `'showing'` หรือ `'shown'` → update message, return existing handle
  - `'hiding'` → set `_cancelHide`, restore class `fvl-shown`, force reflow, return handle
  - `'hidden'` หรือ `'destroyed'` → สร้างใหม่
  
  ผสมกับ cancel-safe hide callback รับประกันว่า `show()` จะได้ overlay ที่แสดงและ style ถูกต้องเสมอ — ไม่ว่า instance ก่อนหน้าจะอยู่ใน state ใด

### Removed

- **Smart delay feature (option `smartDelay`)**
  ลบออกทั้งหมด option `smartDelay` ถูก ignore ถ้าส่งเข้ามา — `show()` แสดงทันทีเสมอ ถ้าคุณพึ่ง option นี้ อย่าลืมลบออกจาก calls; มันไม่มีผลแล้ว

- **Minimum display time feature (constant `MIN_DISPLAY_MS`)**
  ลบออกทั้งหมด overlay ซ่อนทันทีที่ session สุดท้ายปิด ไม่มี artificial delay

- **Internal methods: `_reconcile()`, `_scheduleHide()`, `_flushShow()`, `_pendingOpts`, `_hideDeferTimer`, `_visibleSince`**
  ลบทั้งหมด design ใหม่ไม่ต้องการ mechanism ภายในเหล่านี้ — `show()` และ `hide()` ตอนนี้เป็น thin wrappers รอบ FVL's idempotent API
