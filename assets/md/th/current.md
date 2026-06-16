---
version: 1.6.2_1
date: 2026-06-16T00:00:00Z
title: แก้ไขไอคอน Bluesky และปรับปรุงระบบ Build
subtitle: แก้ไขไอคอน Bluesky ใน footer ที่ใช้ SVG ผิดตัว และปรับปรุงระบบ Build ให้ไม่แตะไฟล์ในโฟลเดอร์ซ่อน
notify: true
---

### Fixed

- **ไอคอน Bluesky ใน Footer ใช้ SVG ผิดตัว**
  ไอคอน Bluesky ใน footer ใช้ SVG path ของ Facebook อยู่ และ aria-label ก็ระบุเป็น "Facebook" ทั้งที่ลิงก์ชี้ไปยัง bsky.app ถูกแก้ไขโดยใช้ SVG ของ Bluesky ตัวล่าสุด (Simple Icons v2.45) และแก้ aria-label เป็น "Bluesky" พร้อมทั้งปรับชื่อให้ถูกต้อง

### Improved

- **ระบบ Build ไม่แตะโฟลเดอร์ซ่อน**
  ฟังก์ชัน `copyDir()` ใน `scripts/lib/file-utils.js` ปรับให้ข้ามโฟลเดอร์ที่ขึ้นต้นด้วย `.` (เช่น `.well-known`, `.github`) ทั้งหมด เพื่อไม่ให้ build process ไปยุ่งกับไฟล์ config เหล่านี้