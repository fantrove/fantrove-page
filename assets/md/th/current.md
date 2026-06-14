---
version: 1.5.0
date: 2026-06-14T08:30:00Z
title: Central Language API — FvLang
subtitle: ระบบภาษากลางใหม่ที่ตั้งค่าทันทีก่อนทุกอย่าง ระบบ JS ทุกระบบใช้ API เดียวกันสำหรับตรวจจับและรับแจ้งเมื่อภาษาเปลี่ยน ไม่ต้องอ่าน localStorage เองอีกต่อไป เมื่อเปลี่ยนภาษา ทั้งหน้าจะอัพเดททันทีโดยไม่ต้องรีโหลด
notify: true
---

### New

- **FvLang — Central Language API (lang-core.js)**
  สคริปต์เล็กๆ ใหม่ที่โหลดก่อนทุกอย่างใน `<head>` อ่านภาษาปัจจุบันแบบ sync จาก attribute `data-fv-built` (production), URL prefix, localStorage หรือการตั้งค่า browser — รู้ภาษาทันทีโดยไม่ต้องรอ network request เลย ระบบ JS ทุกระบบใช้ `FvLang.lang` แทนการอ่าน localStorage เอง แก้ปัญหา "ภาษาโหลดไม่ทัน" ได้สำเร็จ

- **รีเฟรชทั้งหน้าอัตโนมัติเมื่อเปลี่ยนภาษา**
  เมื่อภาษาเปลี่ยน `FvLang.setLang()` จะ dispatch event `fv:langchange` และเรียก callback ที่ subscribe ไว้ทั้งหมด ทุกระบบที่แสดงข้อความ (หน้า home, navigation, What's New, update popup) subscribe แล้ว re-render อัตโนมัติ ทั้งหน้าอัพเดทเป็นภาษาใหม่ทันทีโดยไม่ต้องรีโหลดหน้า

- **Subscriber API สำหรับระบบ JS ทุกระบบ**
  สคริปต์ใดๆ สามารถใช้ `FvLang.onChange(function(lang, prevLang) { ... })` เพื่อสมัครรับแจ้งเมื่อภาษาเปลี่ยน ค่าที่ return คือ function ยกเลิกการสมัคร แทนการที่แต่ละระบบต้องอ่าน `localStorage.getItem('selectedLang')` เองและฟัง event `languageChange` แยกกัน

### Improved

- **ตั้งค่าภาษาเร็วขึ้นใน static mode**
  ใน production (pre-built pages) `lang-core.js` อ่าน attribute `data-fv-built` จาก `<html>` ได้ทันที — ไม่ต้องรอ `language.js` โหลด modules เสร็จ gate resolve ทันที และทุกสคริปต์มีภาษาที่ถูกต้องตั้งแต่บรรทัดแรก

- **Static mode ของ language.js เบาลง**
  ใน static mode `language.js` โหลดเฉพาะ 3 modules (types, config, state, gate, ui, manager) แทน 14 modules ข้าม translation, worker pool, detector, loader และ markers ทั้งหมดเพราะเนื้อหาถูก bake ลง HTML แล้ว

- **หน้า home re-render เมื่อภาษาเปลี่ยน**
  หน้า home จะ cache ข้อมูลและ subscribe ไปยัง `FvLang.onChange()` เมื่อภาษาเปลี่ยนจะ re-render หมวดหมู่ ป้ายกำกับ และปุ่ม "ดูทั้งหมด" ด้วยข้อความภาษาที่ถูกต้อง — ทันทีโดยไม่ต้องรีโหลดหน้า