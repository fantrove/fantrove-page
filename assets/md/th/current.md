---
version: 1.6.1
date: 2026-06-16T00:00:00Z
title: แก้ไขลิงก์นำทางหน้า Home & ย้าย Popup เลือกภาษา
subtitle: แก้ไขลิงก์ปุ่มบนหน้า home ที่พาไปผิดหน้า เนื่องจากใช้ identifier เก่าที่ไม่มีในระบบแล้ว และย้าย popup เลือกภาษามาใช้ PopupSystem ทำให้มี accessibility, การนำทางด้วยคีย์บอร์ด, รองรับโหมดมืด และ behavior ที่สม่ำเสมอกับระบบอื่นๆ ของแอป
notify: true
---

### Improved

- **Popup เลือกภาษาใช้ PopupSystem แล้ว (ui.js)**
  popup เลือกภาษาบนหน้า Settings ถูกเขียนใหม่ทั้งหมดโดยใช้ `PopupSystem.open()` แทนการสร้าง modal เอง ระบบเก่าสร้าง overlay, scroll lock และ DOM elements เองด้วย inline styles ที่ไม่รองรับโหมดมืดและไม่มีการรองรับคีย์บอร์ด ระบบใหม่ใช้คุณสมบัติที่ PopupSystem จัดการให้: z-index layer ที่ถูกต้อง (25000+), focus trap, กด Escape เพื่อปิด, คลิก overlay เพื่อปิด, return-focus กลับไปที่ปุ่มที่กด, จัดการ scroll lock, แอนิเมชันเปิด/ปิด, ARIA roles, รองรับโหมดมืด และลบ DOM อัตโนมัติเมื่อปิด เมธอด `showError()` ยังใช้ `PopupSystem.toast()` เป็นตัวแสดงผลหลัก พร้อม fallback แบบ inline กรณี PopupSystem ยังไม่พร้อม โมดูล state ถูกทำความสะอาดโดยลบการอ้างอิง overlay/dropdown แบบเก่า

### Fixed

- **ปุ่มข้อความแฟนซีบนหน้า Home พาไปผิดหน้า**
  ปุ่ม Hero "ข้อความแฟนซี" บนหน้า home ใช้ `type=special-characters__` เป็น URL parameter ซึ่งเป็น identifier แบบเก่าที่ไม่มีในระบบ routing แล้ว เมื่อคลิก router ไม่พบ button ที่ตรงกันจึง fallback ไปแสดง feed "ทั้งหมด" แทนเนื้อหาข้อความแฟนซี URL ถูกแก้ไขเป็น `type=fancy` ซึ่ง resolve ไปยังเนื้อหาข้อความแฟนซีพร้อมหมวดหมู่ Unicode ทั้ง 10 แบบถูกต้อง

- **ลิงก์ "ดูสัญลักษณ์ทั้งหมด" บนหน้า Home ชี้ไป URL ผิด**
  การ์ด "ดูสัญลักษณ์ทั้งหมด" ใน carousel ที่สร้างโดย JavaScript ใช้ URL เก่า `type=special-characters__` เช่นกัน ทำให้เกิดปัญหาเดียวกัน ถูกแก้ไขเป็น `type=symbols` นำทางไปหน้าเนื้อหาสัญลักษณ์ถูกต้อง

- **ไม่มีการตั้งค่า "ดูทั้งหมด" สำหรับข้อความแฟนซี**
  อ็อบเจกต์ `VIEW_ALL_CONFIGS` ใน `home.js` ไม่มี entry สำหรับ `fancy` เมื่อหน้า home แสดงการ์ด "ดูทั้งหมด" ของส่วนข้อความแฟนซี จะ fallback ไปใช้ค่า default ที่ชี้ไป `/data/verse/discover/` โดยไม่มี query parameter ทำให้แสดง feed "ทั้งหมด" entry ใหม่ `fancy` ถูกเพิ่มเข้าไปพร้อม URL `?type=fancy` และป้ายกำกับภาษาไทย/อังกฤษที่ถูกต้อง