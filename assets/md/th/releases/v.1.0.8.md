---
version: 1.0.8
date: 2025-01-28T09:00:00Z
title: โครงสร้างพื้นฐานและ design tokens
subtitle: สร้างโครงสร้างพื้นฐานของเว็บไซต์ รวมถึง CSS design tokens ระบบธีม และสถาปัตยกรรม component ฐานที่ feature ทั้งหมดในอนาคตจะสร้างบนนี้
---

### New

- **ระบบ CSS design token (tokens.css)**
  ชุด CSS custom properties ครบถ้วนที่กำหนดสี ระยะห่าง ฟอนต์ ขอบมน เงา และค่าออกแบบอื่นๆ ทุก component อ้างอิง tokens เหล่านี้เพื่อสไตล์ที่สอดคล้องกัน

- **ระบบธีมพร้อมรองรับ dark mode**
  Dark mode ในตัวผ่าน media query prefers-color-scheme ทุก component ปรับสีและคอนทราสต์อัตโนมัติเมื่อระบบของผู้ใช้ตั้งเป็น dark mode

- **โครงสร้าง layout และ navigation ฐาน**
  กำหนดโครงสร้างหน้ามาตรฐานด้วย fv-app container, page shell, main content area และ footer mount point โครงสร้างนี้ใช้ร่วมกันทุกหน้า

### Improved

- **ภาษาการออกแบบที่สอดคล้องกันทุกหน้า**
  ด้วย design tokens ทุกหน้าใช้ภาษาการออกแบบเดียวกัน — ขอบมน ระยะห่าง ชุดสี และขนาดฟอนต์เดียวกัน สร้างประสบการณ์แบรนด์ที่เป็นหนึ่งเดียว