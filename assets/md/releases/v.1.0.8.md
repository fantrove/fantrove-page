---
version: 1.0.8
date: 2025-01-28T09:00:00Z
title:
  en: Core infrastructure and design tokens
  th: โครงสร้างพื้นฐานและ design tokens
subtitle:
  en: Established the foundational infrastructure for the site including CSS design tokens, theme system, and the base component architecture that all future features build upon.
  th: สร้างโครงสร้างพื้นฐานของเว็บไซต์ รวมถึง CSS design tokens ระบบธีม และสถาปัตยกรรม component ฐานที่ feature ทั้งหมดในอนาคตจะสร้างบนนี้
---

### New

- **CSS design token system (tokens.css)**
  A comprehensive set of CSS custom properties defining colors, spacing, typography, border radii, shadows, and other design values. All components reference these tokens for consistent styling.

- **Theme system with dark mode support**
  Built-in dark mode using prefers-color-scheme media query. All components automatically adapt their colors and contrasts when the user's system is set to dark mode.

- **Base page layout and navigation**
  Established the standard page shell structure with the fv-app container, page shell, main content area, and footer mount point. This structure is shared by all pages on the site.

### Improved

- **Consistent visual language across pages**
  With design tokens in place, all pages now share the same visual language — same border radii, spacing rhythm, color palette, and typography scale. This creates a cohesive brand experience.