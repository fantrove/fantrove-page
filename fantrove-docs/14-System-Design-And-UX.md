# 14 — System Design และ UX (System Design & User Experience)

> เอกสารนี้อธิบาย **หลักการออกแบบระบบและประสบการณ์ผู้ใช้** ของ Fantrove อย่างละเอียด — ตั้งแต่ design tokens, สไตล์การออกแบบ, mobile-first strategy, responsive design, UX patterns, component design, animation, accessibility, ไปจนถึง performance-driven design
>
> **สำหรับ:** AI agents และนักพัฒนาที่จะสร้างหน้าเว็บใหม่ใน Fantrove หรือ **นำหลักการไปใช้กับเว็บอื่น** — เอกสารนี้ออกแบบมาเป็น training data ที่ทำให้ AI เข้าใจหลักการออกแบบได้อย่างถ่องแท้
>
> **เป้าหมาย:** หลังอ่านเอกสารนี้ AI ควรสามารถสร้างหน้าเว็บใหม่หรือเว็บใหม่ที่มีคุณภาพการออกแบบเทียบเท่า Fantrove ได้โดยไม่ต้องดูตัวอย่างเพิ่มเติม

---

## สารบัญ

1. [ภาพรวมและปรัชญาการออกแบบ](#1-ภาพรวมและปรัชญาการออกแบบ)
2. [หลักการออกแบบหลัก (Core Design Principles)](#2-หลักการออกแบบหลัก-core-design-principles)
3. [Design Tokens (มาตรฐานตัวแปรดีไซน์)](#3-design-tokens-มาตรฐานตัวแปรดีไซน์)
4. [สไตล์การออกแบบ (Design Style)](#4-สไตล์การออกแบบ-design-style)
5. [Mobile-First Design Strategy](#5-mobile-first-design-strategy)
6. [Responsive Design Strategy](#6-responsive-design-strategy)
7. [UX Patterns (ประสบการณ์ผู้ใช้)](#7-ux-patterns-ประสบการณ์ผู้ใช้)
8. [Component Design Patterns](#8-component-design-patterns)
9. [Animation & Motion Design](#9-animation--motion-design)
10. [Accessibility Design](#10-accessibility-design)
11. [Performance-Driven Design](#11-performance-driven-design)
12. [Internationalization (i18n) Design](#12-internationalization-i18n-design)
13. [Visual Hierarchy & Typography](#13-visual-hierarchy--typography)
14. [Color System](#14-color-system)
15. [Layout System](#15-layout-system)
16. [Design Checklist สำหรับหน้าใหม่](#16-design-checklist-สำหรับหน้าใหม่)
17. [Anti-patterns (สิ่งที่ห้ามทำ)](#17-anti-patterns-สิ่งที่ห้ามทำ)
18. [การนำไปใช้กับเว็บอื่น (Applying to Other Projects)](#18-การนำไปใช้กับเว็บอื่น-applying-to-other-projects)
19. [อ้างอิงข้ามเอกสาร](#19-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวมและปรัชญาการออกแบบ

Fantrove เป็นเว็บไซต์แบบ static ที่รวบรวมอีโมจิ สัญลักษณ์ ข้อความแฟนซี และคอลเลกชันอื่น ๆ ให้ผู้ใช้คัดลอกและใช้งานได้ทันทีโดยไม่ต้องสมัครสมาชิก การออกแบบของ Fantrove ผสมผสานระหว่างความสวยงามที่ทันสมัย ประสบการณ์ผู้ใช้ที่ราบรื่น และประสิทธิภาพระดับ platform ที่ทำให้แสดงข้อมูลจำนวนมหาศาลได้โดยไม่ช้าลง เอกสารฉบับนี้ไม่ใช่แค่คู่มือของ Fantrove เท่านั้น แต่เป็นข้อมูลฝึกอบรม (training data) ที่ออกแบบมาเพื่อให้ AI agents เข้าใจหลักการออกแบบเหล่านี้อย่างถ่องแท้ และสามารถนำไปประยุกต์ใช้กับการสร้างหน้าเว็บใหม่ใน Fantrove เอง หรือแม้กระทั่งเว็บอื่นที่จะพัฒนาในอนาคตก็ตาม

### 1.1 ปรัชญาหลัก

การออกแบบของ Fantrove ยึดถือปรัชญา "function follows form, but form serves everyone" กล่าวคือ ทุกการตัดสินใจออกแบบต้องผ่านคำถาม 3 ข้อเสมอ — สิ่งนี้ทำให้ผู้ใช้ทำสิ่งที่ต้องการได้ง่ายขึ้นไหม สิ่งนี้ทำงานได้ดีบนอุปกรณ์ทุกประเภทไหม และสิ่งนี้ยังคงความสวยงามและสอดคล้องกับแบรนด์ไหม ถ้าคำตอบของข้อใดข้อหนึ่งเป็น "ไม่" ก็ต้องกลับไปทำการบ้านต่อ ปรัชญานี้สะท้อนให้เห็นในทุกรายละเอียดของเว็บ ตั้งแต่การเลือกสีหลักที่เป็น teal ซึ่งดูสดใสแต่ไม่ล้าตา ไปจนถึงการใช้ border radius ที่ไม่ใช่ค่ามาตรฐาน (12/17/27/37/47px) เพื่อสร้างความนุ่มนวลที่เป็นเอกลักษณ์

### 1.2 ผู้ใช้เป้าหมาย

ผู้ใช้ของ Fantrove คือทุกคนที่ต้องการอีโมจิหรือสัญลักษณ์อย่างรวดเร็ว — นักเรียนที่แชตคุยกับเพื่อน, คนทำงานที่เขียน social media, นักเล่นเกมที่ตั้งชื่อ in-game, คนทั่วไปที่ต้องการข้อความแฟนซีสำหรับโพสต์ ผู้ใช้เหล่านี้มีลักษณะร่วมคือต้องการสิ่งของที่จะใช้ "ทันที" ไม่ต้องสมัคร ไม่ต้อง login ไม่ต้องรอโหลดนาน ๆ และไม่ต้องการ popup หรือโฆษณาที่รบกวน การออกแบบทุกส่วนต้องตอบสนองความต้องการนี้ — เปิดเว็บแล้วใช้ได้ทันที ค้นหาเจอเร็ว คัดลอกง่าย และปิดไปเมื่อไหร่ก็ได้โดยไม่ต้องกังวล

### 1.3 บริบทเทคนิค

Fantrove เป็น static website ที่ทำงานฝั่ง client ทั้งหมด ไม่มี backend server หรือ database ของผู้ใช้ ทำงานบน Cloudflare Pages CDN ทั่วโลก รองรับ 2 ภาษา (อังกฤษและไทย) แบบ pre-built static HTML สำหรับแต่ละภาษา การออกแบบต้องคำนึงถึงข้อจำกัดและจุดแข็งของ static site เสมอ — ไม่มี server-side rendering ดังนั้นทุกอย่างต้องอยู่ใน static HTML ตอน build แล้ว แต่ขณะเดียวกันก็ต้องมี interactivity ที่ราบรื่นผ่าน JavaScript ที่ deferred load ทั้งหมด

---

## 2. หลักการออกแบบหลัก (Core Design Principles)

การออกแบบของ Fantrove ยึดตาม 10 หลักการหลัก ที่ทุกการตัดสินใจด้านดีไซน์ต้องผ่านการพิจารณาเสมอ:

### 2.1 Mobile-First

Fantrove ออกแบบสำหรับมือถือก่อนเป็นอันดับแรก เพราะผู้ใช้ส่วนใหญ่เข้าถึงเว็บจากมือถือ การออกแบบเริ่มจากหน้าจอเล็ก (320px-600px) แล้วค่อยขยายไป tablet (768px) และ desktop (1024px+) สิ่งที่ต้องคำนึงถึงบนมือถือคือ — ปุ่มต้องใหญ่พอที่จะกดด้วยนิ้วโป้งได้สบาย (44x44px ขั้นต่ำ), ข้อความต้องอ่านได้โดยไม่ต้องซูม (16px ขั้นต่ำ), และ layout ต้องไม่บังคับให้ horizontal scroll เกิดขึ้น

### 2.2 Performance-First

ทุกการตัดสินใจด้านดีไซน์ต้องคำนึงถึงผลกระทบต่อประสิทธิภาพ — CSS containment เพื่อจำกัด layout scope, `will-change` เพื่อ promote GPU layers, `font-display: swap` เพื่อไม่ให้ตัวอักษรมองไม่เห็นระหว่างรอ font load, และ deferred scripts เพื่อไม่ให้ JS บล็อก first paint Core Web Vitals (LCP, INP, CLS) ต้องผ่าน thresholds ของ Google เสมอ เพราะ SEO ของเราขึ้นอยู่กับมัน

### 2.3 Token-Driven

ทุกค่าดีไซน์ (สี ระยะห่าง ขนาดตัวอักษร รัศมีมุม เงา) ต้องเป็น CSS custom property ใน `tokens.css` ห้าม hardcoded values ใน components ยกเว้นกรณีจำเป็นจริง ๆ วิธีนี้ทำให้เราเปลี่ยน theme หรือปรับแต่งได้จากที่เดียว และทำให้ components สอดคล้องกันโดยอัตโนมัติ

### 2.4 i18n-First

ทุกข้อความใน UI ต้องผ่าน `data-translate` attribute เพื่อให้ระบบภาษาแปลได้ การออกแบบ layout ต้องคำนึงถึงว่าข้อความในภาษาอื่นอาจยาวหรือสั้นกว่าภาษาอังกฤษ และต้องไม่ break layout ภาษาไทยที่ยาวกว่าอังกฤษมาก เช่น "Settings" → "การตั้งค่า" ต้องมีพื้นที่พอรับได้โดยไม่กระโดดขึ้นบรรทัดใหม่กะทันหัน

### 2.5 Progressive Enhancement

เนื้อหาสำคัญต้องอยู่ใน static HTML เสมอ — แม้ผู้ใช้ปิด JavaScript ก็ต้องอ่านได้ JavaScript ใช้เพื่อ enhance experience (search, popup, animation) ไม่ใช่เพื่อ render เนื้อหาหลัก วิธีนี้ทำให้ทั้ง SEO ดี (Googlebot crawl ได้ทันที) และ accessibility ดี (screen reader อ่านได้)

### 2.6 Accessibility-First

ทุก interactive element ต้องใช้งานได้ด้วย keyboard, มี ARIA attributes ที่ถูกต้อง, และมี focus management ที่ชัดเจน `prefers-reduced-motion` ต้องได้รับการเคารพเสมอ — ผู้ใช้ที่ตั้งค่านี้จะไม่เห็น animation ใด ๆ ที่อาจทำให้แพ้หรือ不舒服ได้ Color contrast ต้องผ่าน WCAG AA ขั้นต่ำ

### 2.7 SEO-First

ทุกหน้าต้องมี meta tags ครบ (title, description, OG, Twitter Card, hreflang, canonical), structured data (JSON-LD), และ semantic HTML (`<header>`, `<main>`, `<nav>`, `<footer>`) ห้าม render เนื้อหาสำคัญด้วย JavaScript อย่างเดียว ดูรายละเอียดใน [`12-SEO-Guide.md`](./12-SEO-Guide.md)

### 2.8 Visual Hierarchy

ลำดับความสำคัญของเนื้อหาต้องชัดเจนผ่าน — ขนาดตัวอักษร, น้ำหนักตัวอักษร, สี, ระยะห่าง, และตำแหน่ง ผู้ใช้ควรเห็นสิ่งที่สำคัญที่สุดก่อน (เช่น search bar บนหน้า search) โดยไม่ต้องสแกนทั้งหน้า การใช้ gradient text สำหรับ heading หลัก และการใช้ section labels (uppercase, letter-spacing) สำหรับกลุ่มเนื้อหา เป็นวิธีสร้าง hierarchy โดยไม่ต้องพึ่งขนาดอย่างเดียว

### 2.9 Consistency

Components ที่ทำหน้าที่เดียวกันต้องดูเหมือนกันและทำงานเหมือนกันทุกที่ — ปุ่ม primary ทุกปุ่มต้องใช้ gradient เดียวกัน, popup ทุกตัวต้องมี transition เดียวกัน, ระยะห่างระหว่าง sections ต้องเท่ากันทุกหน้า ความสม่ำเสมอนี้สร้างความน่าเชื่อถือและทำให้ผู้ใช้เรียนรู้ interface ได้เร็วขึ้น

### 2.10 User-Centered

ทุกการตัดสินใจต้องตอบคำถาม "สิ่งนี้ช่วยอะไรผู้ใช้?" — ไม่ใช่ "สิ่งนี้ดูเท่ไหม?" หรือ "เราทำได้ไหม?" ตัวอย่างเช่น เราใส่ loading overlay ไม่ใช่เพราะดูเท่ แต่เพราะป้องกันไม่ให้ผู้ใช้เห็นเนื้อหากระตุกขณะโหลด เราใช้ bottom navigation ไม่ใช่เพราะสวย แต่เพราะนิ้วโป้งเข้าถึงง่ายกว่าบนมือถือ

---

## 3. Design Tokens (มาตรฐานตัวแปรดีไซน์)

Design tokens คือรากฐานของระบบดีไซน์ทั้งหมด — ทุกค่าดีไซน์ (สี, ระยะห่าง, ขนาด, เงา) ถูกกำหนดเป็น CSS custom property ใน `assets/css/tokens.css` ซึ่งต้องโหลดเป็น CSS แรกสุดในทุกหน้า

### 3.1 โครงสร้าง Token

Token ทั้งหมดใช้ prefix `--fv-*` (Fantrove) เพื่อหลีกเลี่ยงการชนกับ third-party libraries มี token ประมาณ 100+ ตัว แบ่งเป็น 11 หมวด นอกจากนี้ยังมี alias แบบ legacy (`--brand-*`, `--wn-*`, `--ui-*`) เก็บไว้เพื่อ backward compatibility — แต่ code ใหม่ต้องใช้ `--fv-*` เท่านั้น

### 3.2 Brand Colors

```css
/* หลัก */
--fv-brand-teal:           #13b47f;  /* Primary brand color */
--fv-brand-teal-light:     #00CEB0;  /* Lighter variant for accents */
--fv-brand-teal-dark:      #0a9273;  /* Darker variant for hover/active */
--fv-brand-cyan:           #0eb0d5;  /* Secondary accent */
--fv-brand-cyan-accent:    #11c3ec;  /* Bright cyan for highlights */

/* ตติยภูมิ */
--fv-brand-purple:         #B58CFF;  /* For h2 headings */
--fv-brand-purple-dark:    #9B6EFF;  /* Purple gradient start */
--fv-brand-green-vivid:    #11C291;
--fv-brand-green-bright:   #18E4A1;  /* Green gradient end */
```

กฎการใช้: teal เป็นสีหลักของแบรนด์ ใช้กับปุ่ม primary, active states, และ accent ต่าง ๆ cyan เป็นสีเสริม ใช้เมื่อต้องการความแตกต่างจาก teal แต่ยังอยู่ในโทนเดียวกัน purple ใช้เฉพาะ headings และ gradients เพื่อสร้าง contrast กับ teal โดยไม่ใช้สีที่ clash กัน

### 3.3 Text Colors

```css
--fv-text-primary:   #0f2629;  /* สีเข้มที่สุด — สำหรับเนื้อหาหลัก */
--fv-text-heading:   #152a2f;  /* สำหรับ h1, h2 */
--fv-text-body:      #2f5157;  /* สำหรับ body text */
--fv-text-secondary: #52638A;  /* สำหรับข้อมูลรอง */
--fv-text-muted:     #6d8590;  /* สำหรับ metadata, timestamps */
--fv-text-faint:     #8ea1b8;  /* สำหรับ placeholders */
--fv-text-inverse:   #ffffff;  /* สำหรับ text บนพื้นเข้ม */
```

Text colors มี 7 ระดับ จากเข้มสุดไปอ่อนสุด ทำให้สร้าง visual hierarchy ได้โดยไม่ต้องพึ่งขนาดอย่างเดียว — เนื้อหาหลักใช้ `--fv-text-primary`, ข้อมูลรองใช้ `--fv-text-secondary`, metadata ใช้ `--fv-text-muted` หรือ `--fv-text-faint`

### 3.4 Surface / Background Colors

```css
--fv-surface-page:        #ffffff;              /* พื้นหลังหน้า */
--fv-surface-card:        #ffffff;              /* พื้นการ์ด */
--fv-surface-card-alpha:  rgba(255, 255, 255, 0.94);  /* พื้นการ์ดโปร่งแสง */
--fv-surface-subtle:      #f8faff;              /* พื้นหลัง subtle */
--fv-surface-soft:        #f6f7fb;              /* พื้นหลัง soft */
--fv-surface-teal-hover:  rgba(248, 255, 253, 1);  /* Hover state สี teal */
```

### 3.5 Border Colors

```css
--fv-border-default:        rgba(14, 176, 213, 0.06);   /* Border ปกติ */
--fv-border-subtle:         rgba(0, 0, 0, 0.07);        /* Border subtle */
--fv-border-teal:           rgba(0, 206, 176, 0.25);    /* Border teal */
--fv-border-teal-strong:    rgba(0, 206, 176, 0.80);    /* Border teal เข้ม */
--fv-border-focus-ring:     rgba(19, 180, 127, 0.16);   /* Focus ring */
```

### 3.6 Spacing Scale

```css
--fv-space-1:  0.25rem   (4px)    /* ระยะห่างขั้นต่ำ */
--fv-space-2:  0.5rem    (8px)    /* ระยะห่างเล็ก */
--fv-space-3:  0.75rem   (12px)
--fv-space-4:  1rem      (16px)   /* ระยะห่างมาตรฐาน */
--fv-space-5:  1.25rem   (20px)
--fv-space-6:  1.5rem    (24px)
--fv-space-7:  1.75rem   (28px)
--fv-space-8:  2rem      (32px)
--fv-space-10: 2.5rem    (40px)
--fv-space-12: 3rem      (48px)
--fv-space-16: 4rem      (64px)
--fv-space-20: 5rem      (80px)   /* ระยะห่างระหว่าง sections */
```

Spacing scale เป็นแบบ 4px base unit (เหมือน Tailwind, Material) ทำให้ค่าทุกตัวหารด้วย 4 ลงตัว ยกเว้น `--fv-space-7` (28px) และ `--fv-space-10` (40px) ที่เป็น multiples ของ 4 อยู่แล้ว การใช้ scale ที่สม่ำเสมอทำให้ layout ดูเป็นระเบียบและสอดคล้องกัน

### 3.7 Border Radius Scale

```css
--fv-radius-xs:   12px;
--fv-radius-sm:   17px;
--fv-radius-md:   27px;
--fv-radius-lg:   37px;
--fv-radius-xl:   47px;
--fv-radius-pill: 999px;
```

**หมายเหตุสำคัญ:** Border radius ของ Fantrove ใช้ค่าที่ไม่ใช่ multiples ของ 4 หรือ 8 (ซึ่งเป็นมาตรฐานอุตสาหกรรม) แต่เป็น 12/17/27/37/47 ซึ่งเป็นสูตรเฉพาะของ Fantrove ที่ให้ความรู้สึก "นุ่มนวลแต่ไม่ generic" — ดู soft แต่ยังคงความเป็นเอกลักษณ์ การเลือกค่าเหล่านี้มาจากการทดลองว่าค่าไหนทำให้ components ดู "friendly" โดยไม่ดูเด็กเกินไป ห้ามเปลี่ยนเป็นค่ามาตรฐาน 4/8/12/16/24 เพราะจะทำลายเอกลักษณ์ของแบรนด์

### 3.8 Typography

```css
/* Font stack */
--fv-font-stack: 'Noto Sans', 'Segoe UI', 'Noto Sans Thai',
                  -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

/* Font sizes */
--fv-text-xs:    0.75rem    (12px)
--fv-text-sm:    0.875rem   (14px)
--fv-text-base:  1rem       (16px)   /* ขนาด body text มาตรฐาน */
--fv-text-lg:    1.125rem   (18px)
--fv-text-xl:    1.25rem    (20px)
--fv-text-2xl:   1.5rem     (24px)
--fv-text-3xl:   1.875rem   (30px)
--fv-text-4xl:   2.25rem    (36px)

/* Font weights */
--fv-font-normal:    400
--fv-font-medium:    500
--fv-font-semibold:  600
--fv-font-bold:      700
--fv-font-extrabold: 800
--fv-font-black:     900

/* Line heights */
--fv-leading-tight:   1.25    /* สำหรับ headings */
--fv-leading-normal:  1.6     /* สำหรับ body */
--fv-leading-relaxed: 1.75    /* สำหรับ long-form text */
```

Font stack เริ่มด้วย Noto Sans (รองรับ Thai ผ่าน Noto Sans Thai) แล้ว fallback ไป system fonts ตามลำดับ — Segoe UI สำหรับ Windows, -apple-system สำหรับ Apple, system-ui สำหรับ Android/modern browsers ลำดับนี้ทำให้ text แสดงผลได้ดีที่สุดบนทุกแพลตฟอร์มโดยไม่ต้องโหลด web font เพิ่ม (ยกเว้น Sofia ที่ใช้เฉพาะ footer logo)

### 3.9 Shadows

```css
--fv-shadow-sm:     0 2px 8px rgba(6, 20, 24, 0.04)
--fv-shadow-md:     0 10px 28px rgba(6, 20, 24, 0.06)
--fv-shadow-lg:     0 22px 50px rgba(19, 180, 127, 0.06)   /* มี teal tint */
--fv-shadow-teal:   0 4px 24px rgba(19, 180, 127, 0.12)    /* สำหรับ primary buttons */
--fv-shadow-focus:  0 0 0 4px rgba(19, 180, 127, 0.16)     /* Focus ring */
```

Shadows ของ Fantrove มีลักษณะเฉพาะคือ — soft และ subtle แม้ระดับ lg ก็ยังไม่ "หนัก" เกินไป เงาระดับ lg และ teal มี teal tint อยู่ในเงาเอง ทำให้เงาดูเป็นสีเดียวกับแบรนด์ ไม่ใช่สีดำทึบ

### 3.10 Transitions

```css
/* Easing functions */
--fv-ease-standard:  cubic-bezier(0.4, 0, 0.2, 1)     /* Material standard */
--fv-ease-spring:    cubic-bezier(0.2, 0.9, 0.2, 1)   /* Fantrove spring */

/* Durations */
--fv-transition-fast:    150ms cubic-bezier(0.4, 0, 0.2, 1)
--fv-transition-normal:  260ms cubic-bezier(0.2, 0.9, 0.2, 1)  /* spring ease */
--fv-transition-slow:    400ms cubic-bezier(0.2, 0.9, 0.2, 1)
```

Fantrove มี easing ที่เป็นเอกลักษณ์คือ `cubic-bezier(0.2, 0.9, 0.2, 1)` ซึ่งเป็น "spring" curve ที่ทำให้ animations ดูมีชีวิตชีวากว่า linear หรือ ease-in-out มาตรฐาน นอกจากนี้ยังมี Back-out easing `cubic-bezier(0.34, 1.56, 0.64, 1)` สำหรับ overshoot effects เช่น nav underline indicator

### 3.11 Layout Tokens

```css
--fv-container-max:    1110px;   /* Container หลัก */
--fv-container-md:     860px;    /* Container ขนาดกลาง (search) */
--fv-container-sm:     600px;    /* Container เล็ก */
--fv-nav-bottom-h:     64px;     /* ความสูง bottom nav */
--fv-nav-top-h:        50px;     /* ความสูง top nav */
--fv-page-pad-x:       1.6rem;   /* Page horizontal padding */
```

### 3.12 Z-index Scale

```css
--fv-z-sticky:   100;       /* Sticky elements */
--fv-z-nav:      16000;     /* Navigation bars */
--fv-z-overlay:  17000;     /* Overlays */
--fv-z-modal:    18000;     /* Modals/dialogs */
--fv-z-toast:    19000;     /* Toast notifications */
```

Z-index ใช้ scale 4 ระดับ (sticky, nav, overlay, modal, toast) เพื่อให้จัดการ stacking context ได้ง่าย ระดับเริ่มที่ 100 (sticky) เพราะต่ำกว่านั้นใช้สำหรับ local stacking contexts ใน components แต่ละตัว

---

## 4. สไตล์การออกแบบ (Design Style)

สไตล์การออกแบบของ Fantrove ผสมผสานระหว่าง modern minimal, soft organic, และ playful motion ที่สร้างความรู้สึก friendly โดยไม่ดูเด็กเกินไป

### 4.1 Modern Minimal

พื้นฐานเป็น modern minimal — whitespace มาก, typography ที่สะอาด, สีที่จำกัด (mainly teal + cyan + purple), และ components ที่ไม่เยอะจนรก ทุกหน้ามี "breathing room" ที่เพียงพอ ไม่มีกราฟิกที่ไม่จำเป็น ทุกองค์ประกอบต้องมีหน้าที่ ถ้าไม่มีหน้าที่ก็ตัดทิ้ง

### 4.2 Soft Organic

Soft organic มาจาก border radius ที่ผิดปกติ (12/17/27/37/47px) — ค่าเหล่านี้ให้ความรู้สึก "organic" มากกว่าค่ามาตรฐาน 4/8/12/16 ที่ดู "engineered" เกินไป รวมกับ shadows ที่ soft มาก ๆ และ gradients ที่ใช้ radial gradients (ไม่ใช่ linear อย่างเดียว) ทำให้ components ดู "soft" และน่าสัมผัส

### 4.3 Teal-Forward Brand Identity

Teal (`#13b47f`) เป็นสีหลักของแบรนด์ — ใช้ในทุกที่ที่ต้องการ "brand presence": ปุ่ม primary, active states, focus rings, brand gradient, theme-color meta tag, และแม้แต่ tint ใน shadows ระดับ lg. Teal ถูกเลือกเพราะ — สดใสแต่ไม่ล้าตา (ต่างจาก bright red หรือ pure blue), ดูเป็นมิตรและ friendly (ต่างจาก corporate blue), และ distinguish ได้ชัดจากคู่แข่งที่มักใช้ blue หรือ purple

### 4.4 Light-Mode Primary

ปัจจุบัน Fantrove เป็น light-mode only — พื้นหลังขาว, text เข้ม, accent สด มีเพียงหน้า What's New (`new.css`) ที่รองรับ `prefers-color-scheme: dark` และ loading system ที่มี opt-in dark theme การเลือก light-mode เป็น default มาจาก — ผู้ใช้ส่วนใหร้อยใช้ light mode (StatCounter: ~80%), content ที่เป็น emojis/symbols มองเห็นได้ชัดกว่าบนพื้นขาว, และ color contrast ทำได้ง่ายกว่า อย่างไรก็ตาม หากจะเพิ่ม dark mode ในอนาคต ต้องเพิ่มเป็น system-wide ผ่าน tokens.css ไม่ใช่ per-page แบบที่เป็นอยู่

### 4.5 Shadow-as-Border Technique

Fantrove ใช้เทคนิค "shadow as border" — แทนที่จะใช้ `border: 1px solid` ใช้ `box-shadow: 0 0 0 1px color` แทน เทคนิคนี้มีข้อดีคือ — ไม่กระทบ box model (border เพิ่มขนาด element, shadow ไม่), ทำ layered borders ได้ (shadow หลายชั้น), และทำให้ใช้ gradient backgrounds ได้โดยไม่มีปัญหา border ตัดเส้น gradient เทคนิคนี้ใช้ใน footer, nav buttons, และ links

### 4.6 Gradient Accents

Gradients ใช้แบบ strategic ไม่ใช่ทุกที่ — มี 4 gradients หลัก:
- `--fv-gradient-brand` — radial purple + radial green + linear purple-to-green (ใช้ใน hero h1, overlay)
- `--fv-gradient-teal` — linear teal to cyan (ใช้ใน page-title gradient text)
- `--fv-gradient-btn` — linear cyan to teal (ใช้ใน primary buttons)
- `--fv-gradient-accent-bar` — linear teal to cyan (ใช้ใน section title accent bar)

Gradient text เป็นเทคนิคที่ใช้บ่อย — ใช้ `background-clip: text` + `-webkit-text-fill-color: transparent` เพื่อทำให้ text มี gradient แทนสีทึบ ใช้ใน hero h1, page titles, และ heading สำคัญ

### 4.7 Playful Motion

Animations ของ Fantrove มีลักษณะ "playful" โดยใช้ spring easing (`cubic-bezier(0.2, 0.9, 0.2, 1)`) และ Back-out easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`) ที่ทำให้ animations "overshoot" เล็กน้อยก่อนจะหยุด — ทำให้ดูมีชีวิตชีวากว่า ease-out มาตรฐาน ตัวอย่างเช่น nav underline indicator ที่ขยายจาก center พร้อม overshoot, back-to-top button ที่ spring up เมื่อ appear, และ popup ที่ scale up พร้อม slight bounce

---

## 5. Mobile-First Design Strategy

Fantrove ออกแบบสำหรับมือถือเป็นอันดับแรกเสมอ เพราะผู้ใช้ส่วนใหญ่เข้าถึงเว็บจากมือถือ (โดยเฉพาะในเอเชียตะวันออกเฉียงใต้ที่ mobile penetration สูงมาก) การออกแบบ mobile-first ไม่ใช่แค่ "ทำให้ใช้ได้บนมือถือ" แต่คือ "เริ่มจากมือถือแล้วค่อยขยายไป desktop"

### 5.1 ทำไมต้อง Mobile-First

การเริ่มจากมือถือบังคับให้เราโฟกัสที่สิ่งสำคัญที่สุดก่อน — เพราะหน้าจอเล็ก ไม่มีที่สำหรับของที่ไม่จำเป็น ทุก element ต้องมีหน้าที่ชัดเจน นอกจากนี้ยังทำให้ performance ดีขึ้น เพราะโค้ดที่ออกแบบสำหรับมือถือมักเบากว่า (น้อย DOM nodes, น้อย CSS) และเมื่อขยายไป desktop ก็แค่เพิ่ม enhancements ไม่ใช่ลดอะไรออก

### 5.2 Touch-Friendly Targets

ทุก interactive element ต้องกดได้สบายด้วยนิ้วโป้ง — ขนาดขั้นต่ำ 44×44px (ตาม Apple HIG) หรือ 48×48dp (ตาม Material Design) ในทางปฏิบัติ Fantrove ใช้:

```css
/* ปุ่ม nav items */
.nav-item .svg-wrapper {
  width: 52px;
  height: 42px;
}

/* ปุ่ม popup */
.fp-btn {
  min-height: 40px;
  padding: var(--fv-space-2) var(--fv-space-6);
}

/* ปุ่ม back-to-top */
#back-to-top {
  width: 50px;
  height: 50px;
}
```

นอกจากขนาด ยังต้องคำนึงถึงระยะห่างระหว่าง targets ด้วย — ปุ่มที่อยู่ใกล้กันเกินไปทำให้กดผิด ต้องมี spacing อย่างน้อย 8px ระหว่าง targets ที่อยู่ติดกัน

### 5.3 Viewport Setup

ทุกหน้าต้องมี meta viewport ที่ถูกต้อง:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

สำหรับหน้าที่ต้องจัดการ iOS notch (เช่น discover page):

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

`viewport-fit=cover` ทำให้เนื้อหาขยายเต็มหน้าจอรวมถึงพื้นที่ notch แล้วใช้ `env(safe-area-inset-*)` เพื่อเพิ่ม padding ในจุดที่ต้องการ

### 5.4 Safe-Area Handling (iOS Notch)

iOS devices ที่มี notch หรือ dynamic island ต้องได้รับการจัดการพิเศษ — ใช้ `env(safe-area-inset-*)` เพื่อเพิ่ม padding ในจุดที่อาจถูก notch บัง:

```css
/* Bottom navigation — เผื่อที่ให้ home indicator */
.bottom-nav {
  padding: 10px 0 calc(env(safe-area-inset-bottom, 0px) + 0px);
}

/* Popup ที่อยู่ด้านล่าง */
.fp-pos-bottom {
  bottom: env(safe-area-inset-bottom, 0px);
}

/* Loading fullscreen — เผื่อที่ให้ bottom nav */
.fvl-fullscreen {
  bottom: calc(var(--fv-nav-bottom-h, 64px) + env(safe-area-inset-bottom, 0px));
}
```

### 5.5 Bottom Navigation Pattern

Fantrove ใช้ bottom navigation bar บนมือถือ (ไม่ใช่ top nav หรือ hamburger menu) เพราะ — นิ้วโป้งเข้าถึงได้ง่ายที่สุด, เป็น pattern ที่ผู้ใช้คุ้นเคยจาก native apps, และทำให้ top area ว่างสำหรับ content

Bottom nav มีลักษณะเฉพาะ:
- `position: fixed; inset: auto 0 0 0` — ติดอยู่ด้านล่างเสมอ
- `border-radius: 47px 47px 0 0` — มุมบนโค้ง (ใช้ `--fv-radius-xl`)
- ใช้ `contain: layout paint style` เพื่อ isolate rendering
- ใช้ `transform: translateZ(0)` + `will-change: transform` เพื่อ GPU promotion
- Active state มี "halo" effect (radial gradient + border + inset shadow)

### 5.6 Desktop Transformation: Bottom Nav → Left Rail

เมื่อ viewport ≥ 768px bottom nav จะ transform เป็น left rail (vertical sidebar) โดยใช้ JavaScript reparenting:

```javascript
// เมื่อ viewport >= 768px
document.body.classList.add('has-left-rail');
// wrap ทุก element ยกเว้น .bottom-nav ใน .site-main
// เปลี่ยน .bottom-nav ให้เป็น vertical
```

```css
/* Mobile (default) */
.bottom-nav {
  position: fixed;
  inset: auto 0 0 0;
  height: 64px;
  flex-direction: row;
}

/* Desktop (>= 768px) */
body.has-left-rail {
  display: flex;
  min-height: 100vh;
}

.bottom-nav {
  inset: 0 auto 0 0;
  width: 88px;
  height: 100vh;
  flex-direction: column;
  border-radius: 0 16px 16px 0;
}
```

การ transform นี้ทำให้ผู้ใช้ desktop ได้รับประสบการณ์ที่เหมาะสม (left rail ดูเป็นมืออาชีพกว่า) โดยไม่ต้องสร้าง component ใหม่

### 5.7 Scroll-Snap for Carousels

Carousels บนมือถือใช้ CSS scroll-snap แทน JavaScript-driven carousel เพราะ — performance ดีกว่า (native scrolling), รู้สึกเป็นธรรมชาติกว่า (ใช้ gesture เดียวกับ scroll ปกติ), และทำงานได้แม้ JS ไม่โหลด

```css
.carousel-track {
  display: flex;
  gap: 1.5rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;  /* ซ่อน scrollbar */
}

.item-card {
  scroll-snap-align: start;
  scroll-snap-stop: normal;
}
```

### 5.8 Mobile Keyboard Handling

หน้า search ต้องจัดการ mobile keyboard โดยเฉพาะ — เมื่อ keyboard โผล่ขึ้นมา viewport จะเปลี่ยน ทำให้ sticky header อาจถูกบัง ต้องใช้ `visualViewport` API หรือ `100svh` (small viewport height) แทน `100vh`:

```css
.search-result-here {
  min-height: var(--placeholder-h, 60svh);  /* svh = small viewport height */
}
```

### 5.9 Tap Highlight Removal

Fantrove ลบ tap highlight ของ Android ออกเพื่อความสะอาด:

```css
body {
  -webkit-tap-highlight-color: transparent;
}
```

แต่ต้องแน่ใจว่ายังมี feedback อื่นแทน (เช่น `:active` state ที่เปลี่ยนสีหรือ scale)

### 5.10 Mobile-First CSS Strategy

CSS เขียนสำหรับมือถือก่อน แล้วค่อยเพิ่ม `@media (min-width: ...)` สำหรับ larger screens:

```css
/* Mobile-first base styles */
.container {
  padding: 0 1rem;
  font-size: 16px;
}

/* Tablet+ */
@media (min-width: 768px) {
  .container {
    padding: 0 2rem;
    font-size: 17px;
  }
}

/* Desktop+ */
@media (min-width: 1024px) {
  .container {
    padding: 0 3rem;
    font-size: 18px;
  }
}
```

---

## 6. Responsive Design Strategy

Fantrove ใช้ responsive strategy แบบ "mixed approach" — บางส่วนเป็น mobile-first (`min-width` queries), บางส่วนเป็น desktop-first (`max-width` queries) ขึ้นกับว่า component นั้นออกแบบมาจากฝั่งไหนก่อน

### 6.1 Breakpoint Inventory

Fantrove ใช้ breakpoints หลายระดับที่ calibrated ตามอุปกรณ์จริง:

| Breakpoint | Type | อุปกรณ์เป้าหมาย | การใช้งานหลัก |
|---|---|---|---|
| `max-width: 320px` | Tiny phone | iPhone SE (old) | Logo shrink, nav compact |
| `max-width: 420px` | Small phone | iPhone 13 mini | Form controls shrink |
| `max-width: 450px` | Small phone | Most iPhones portrait | Container padding reduce |
| `max-width: 480px` | Phone | iPhone Pro Max portrait | Search layout compact |
| `max-width: 560px` | Large phone | iPhone landscape | Footer → single column |
| `max-width: 600px` | Phone | Small tablet portrait | Major mobile breakpoint |
| `max-width: 640px` | Phone landscape | iPhone Pro landscape | Body padding adjust |
| `max-width: 700px` | Tablet portrait | iPad mini | Section padding reduce |
| `max-width: 768px` | Tablet | iPad portrait | Search/nav adjust |
| `max-width: 860px` | Tablet landscape | iPad landscape | Footer → 2 columns |
| `max-width: 900px` | Tablet landscape | iPad Pro landscape | Hero stacks vertical |
| `max-width: 960px` | Small desktop | Small laptop | Footer grid rebalance |
| `max-width: 1024px` | Desktop | iPad Pro / laptop | Search layout adjust |
| `min-width: 768px` | Tablet+ | iPad portrait+ | Bottom nav → left rail |
| `min-width: 1024px` | Desktop+ | Desktop | Nav dropdown widen |
| `min-width: 1280px` | Wide desktop | Wide monitor | Settings card widen |
| `min-width: 1536px` | Very wide | 4K monitor | Settings card widen more |

### 6.2 ทำไมใช้หลาย Breakpoints

การใช้ breakpoints หลายระดับทำให้ layout ปรับได้ละเอียดตามขนาดจริงของอุปกรณ์ แทนที่จะมีแค่ 3-4 breakpoints แบบ conventional (sm/md/lg/xl) ที่ทำให้ layout "พอดี" ในบางช่วงแต่ "หลวม" ในบางช่วง

อย่างไรก็ตาม การมี breakpoints เยอะทำให้ CSS ซับซ้อนขึ้น ดังนั้นต้องใช้อย่างประหยัด — เพิ่ม breakpoint ใหม่เฉพาะเมื่อ layout จริง ๆ พังในช่วงนั้น ไม่ใช่เพราะ "อยากให้ดีขึ้น"

### 6.3 Fluid Typography with clamp()

แทนที่จะใช้ breakpoints สำหรับ font sizes ใช้ `clamp()` สำหรับ fluid typography ที่ปรับขนาดตาม viewport อย่างต่อเนื่อง:

```css
h1.page-title-about {
  font-size: clamp(1.3rem, 1.4rem + 0.9vw, 1.8rem);
}

h2.title {
  font-size: clamp(1.02rem, 1.06rem + 0.4vw, 1.16rem);
}

p.content {
  font-size: clamp(1.02rem, 1.05rem + 0.35vw, 1.12rem);
}
```

`clamp(min, preferred, max)` ทำให้ font ไม่เล็กเกินไปบนมือถือ และไม่ใหญ่เกินไปบน desktop โดยปรับขนาดอย่างต่อเนื่องตาม `vw`

### 6.4 กฎการเลือก Breakpoint

เมื่อต้องเพิ่ม breakpoint ใหม่ ให้ถามตัวเอง:

1. **จำเป็นไหม?** — layout จริง ๆ พังไหมในช่วงนั้น ถ้าไม่พัง ไม่ต้องเพิ่ม
2. **ใช้ breakpoint ที่มีอยู่แล้วได้ไหม?** — ดูตารางข้างบน ถ้าใกล้เคียงก็ใช้ของเดิม
3. **เป็น min-width หรือ max-width?** — ถ้า component เป็น mobile-first ใช้ `min-width`, ถ้า desktop-first ใช้ `max-width`
4. **มีเหตุผลที่ชัดเจนไหม?** — ต้องอธิบายได้ว่าทำไมเลือกค่านี้ (เช่น "768px เพราะ iPad portrait")

### 6.5 Container Queries (Future)

ในอนาคต Fantrove อาจใช้ CSS Container Queries แทน Media Queries สำหรับ component-level responsiveness — ทำให้ component ปรับ layout ตามขนาด container แทนที่จะตาม viewport แต่ปัจจุบันยังไม่ใช้เพราะ browser support ยังไม่ครบ

### 6.6 Print Styles

ทุกหน้าที่มีเนื้อหาอ่านได้ (search, discover, about, settings) ต้องมี `@media print` ที่:
- ซ่อน navigation, buttons, ads
- รีเซ็ต backgrounds เป็น white
- ขยาย container เต็มหน้ากระดาษ
- ลด font size ให้พอดีกับกระดาษ

```css
@media print {
  header, nav, .navbar-toggle, #copyToast, .search-footer {
    display: none !important;
  }
  body {
    background: none;
    color: #000;
  }
}
```

---

## 7. UX Patterns (ประสบการณ์ผู้ใช้)

UX patterns ของ Fantrove ออกแบบมาให้ผู้ใช้ทำสิ่งที่ต้องการได้โดยไม่ต้องคิดมาก — เปิดเว็บ ค้นหา คัดลอก ใช้งาน ปิดไป ทั้งหมดในไม่กี่วินาที

### 7.1 Loading States

Fantrove มีระบบ loading ที่ครอบคลุม 4 modes ตาม context การใช้งาน:

1. **Fullscreen** — ใช้เมื่อเปลี่ยนหน้าหรือโหลดข้อมูลใหม่ทั้งหน้า ครอบเต็มจอ (ยกเว้น bottom nav) เพื่อป้องกันผู้ใช้เห็นเนื้อหากระตุกขณะโหลด
2. **Scoped** — ใช้เมื่อโหลดข้อมูลในบริเวณเฉพาะ (เช่น card content) ครอบเฉพาะ container นั้น
3. **Inline** — ใช้สำหรับ feedback ขนาดเล็ก (เช่น button loading) แสดง spinner เล็ก ๆ ข้าง text
4. **Topbar** — ใช้สำหรับ background operations (เช่น fetch ข้อมูล) แสดง progress bar บนสุด 3px สูง

หลักการสำคัญ: **ทุก loading state ต้องมี end** — ห้ามมี loading ที่ "ค้าง" ไม่รู้ว่าจะจบเมื่อไหร่ ถ้า operation อาจใช้เวลานาน ให้แสดง progress bar แทน indeterminate spinner

### 7.2 Popup/Modal System

Popup system มี 9 presets ตาม use case:

| Preset | Use case | Z-index |
|---|---|---|
| dialog | General dialog | 25000 |
| alert | Quick message | 26000 |
| confirm | Yes/No question | 26000 |
| sheet | Bottom sheet (mobile) | 24000 |
| toast | Notification | 22000 |
| drawer | Side drawer | 23000 |
| tooltip | Hover info | 20000 |
| popover | Click info | 21000 |
| fullscreen | Full-screen takeover | 28000 |

หลักการ:
- ใช้ `PopupSystem.open()` API เดียวสำหรับทุก preset
- ทุก popup มี overlay (ยกเว้น tooltip/popover)
- ปิดได้ด้วย ESC, click overlay, หรือปุ่ม X
- Mobile: ทุก popup ขยายเต็ม viewport (ยกเว้น toast/tooltip)
- Animation: scale + fade (center) หรือ slide (top/bottom/left/right)

### 7.3 Search Experience

Search ของ Fantrove ออกแบบให้ "instant" — ผู้ใช้พิมพ์แล้วเห็นผลทันที ไม่ต้องกด Enter:

1. **Sticky search header** — อยู่ด้านบนเสมอ ซ่อนเมื่อ scroll down โผล่เมื่อ scroll up
2. **Two-tier search** — substring search ทันที, fuzzy search (Fuse.js) โหลด lazy ใน idle time
3. **Virtual scroll results** — แสดงผลได้หลายหมื่นรายการโดยไม่ช้า (ด้วย URE)
4. **Copy toast** — คัดลอกแล้วมี toast โผล่ด้านบนขวา
5. **URL history** — ใช้ two-stack model ทำให้ back/forward ทำงานถูกต้อง

### 7.4 Navigation Patterns

- **Bottom nav (mobile) / Left rail (desktop)** — นำทางระหว่างหน้าหลัก
- **Top bar with back button** — หน้า sub (about, settings, what's new) มี back button ด้านซ้าย
- **Breadcrumb** — ใช้ใน discover page เพื่อบอก hierarchy
- **Active state** — ปุ่ม nav ที่ active มี halo effect + color change + underline indicator

### 7.5 Feedback Patterns

- **Copy notification** — toast ด้านบนขวาเมื่อคัดลอก
- **Error messages** — ใช้ PopupSystem.alert() ไม่ใช้ `alert()` ธรรมดา
- **Success feedback** — toast สั้น ๆ ("Saved!", "Copied!")
- **Loading feedback** — FVL overlay ตาม section 7.1

### 7.6 Progressive Disclosure

เนื้อหาที่ไม่จำเป็นทันทีจะถูกซ่อนจนกว่าผู้ใช้ต้องการ:

- **FAQ** — ใช้ pure-CSS accordion (`<input type="checkbox">` + `:checked`)
- **Settings** — ซ่อน advanced options ใน "Advanced" section
- **Carousels** — แสดงไม่กี่ items แรก ที่เหลือ scroll ดู
- **Popups** — โหลด lazy เมื่อจะใช้

### 7.7 Empty States

เมื่อไม่มีเนื้อหา (เช่น search ไม่เจอ) ต้องมี:
- ข้อความอธิบายชัดเจน ("No results for 'xyz'")
- คำแนะนำ ("Try different keywords")
- Illustration หรือ icon (optional)

### 7.8 Error States

เมื่อเกิด error:
- ข้อความอธิบายสิ่งที่ผิดพลาด (ไม่ใช่ "Error 500")
- คำแนะนำว่าจะทำอย่างไร ("Try again" หรือ "Contact support")
- ปุ่ม retry (ถ้าเป็น network error)
- ห้ามแสดง stack trace หรือ technical details แก่ผู้ใช้ทั่วไป

---

## 8. Component Design Patterns

Components ของ Fantrove ออกแบบให้ reusable, consistent, และ accessible ทุกตัว ต่อไปนี้คือ patterns หลัก:

### 8.1 Buttons

```css
/* Base button */
.button, .btn {
  padding: 1.9em 1.7em;
  border-radius: var(--fv-radius-xl);  /* 47px */
  background: linear-gradient(to right, #E6F7FF 0%, #f1fff8 100%);
  color: var(--fv-brand-teal);
  border: 5px solid #d8efe7;
  box-shadow: 0 6px 20px rgba(8, 20, 40, 0.06);
  letter-spacing: 0.013em;
}

/* Primary button */
.button-primary {
  background: var(--fv-gradient-btn);  /* cyan → teal */
  color: #fff;
  border: 1.5px solid var(--fv-brand-teal);
  font-weight: 800;
  box-shadow: var(--fv-shadow-teal);
}

/* Secondary button */
.button-secondary {
  background-color: #E9ECFF;  /* lavender */
  color: #5FC7C1;
  border: 1px solid #7FD8D2;
}
```

หลักการ:
- Primary ใช้ gradient + teal shadow — ดู "important"
- Secondary ใช้ solid color + thin border — ดู "optional"
- Base ใช้ subtle gradient + thick soft border — ดู "friendly"
- ทุก button มี `:active` state ที่ scale ลงเล็กน้อย (squish effect)

### 8.2 Cards

```css
/* Section card */
section {
  background: var(--fv-surface-card);
  border-radius: var(--fv-radius-lg);  /* 37px */
  border: 1.5px solid var(--fv-border-default);
  box-shadow: inset 0 0 12px 4px var(--fv-border-default);  /* inset glow */
  padding: 2.1rem 2.2rem;
  display: flex;
  flex-direction: column;
  gap: 1.3rem;
}

/* Item card (carousel) */
.item-card {
  background: var(--fv-surface-card);
  border-radius: var(--fv-radius-lg);
  width: 140px;
  padding: 1.25rem 0.72rem 1.05rem;
  border: 1.4px solid #e6ecf7;
  box-shadow: inset 0 0 11px 2px #F7FAFF;
  scroll-snap-align: start;
  contain: paint;
}
```

### 8.3 Forms

```css
.setting-item select,
#language-button {
  width: 100%;
  padding: calc(var(--fv-space-2) + 8px) var(--fv-space-4);
  font-size: 0.9em;
  border-radius: var(--fv-radius-xl);  /* 47px - pill shape */
  background-color: var(--fv-surface-page);
  color: var(--fv-text-primary);
  appearance: none;  /* ลบ native styling */
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
```

### 8.4 Navigation Items

```css
nav ul li button {
  padding: 11px 13px;
  border-radius: var(--fv-radius-pill);  /* 999px - full pill */
  background: transparent;
  border: 1px solid transparent;
  color: var(--fv-text-secondary);
  transition: background 200ms, border-color 200ms, color 200ms;
}

nav ul li button.active {
  color: var(--fv-brand-teal-light);
  background: var(--fv-surface-teal-hover);
  border-color: rgba(0, 206, 176, 0.51);
  transform: scale(0.98);  /* squish on active */
}

/* Underline indicator with Back-out easing */
nav ul li button::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 40%;
  height: 3px;
  background: var(--fv-brand-teal-light);
  border-radius: 10px 10px 0 0;
  transform: translateX(-50%) scaleX(0);  /* start collapsed */
  transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);  /* Back-out */
}

nav ul li button.active::after {
  transform: translateX(-50%) scaleX(1);  /* expand with overshoot */
}
```

### 8.5 Footer

Footer ใช้ 4-column grid บน desktop, ลดเป็น 2-column บน tablet, และ 1-column บน mobile:

```css
.footer-grid {
  display: grid;
  grid-template-columns: 2.2fr 1fr 1fr 1.2fr;  /* brand wider */
  gap: 2.5rem 3rem;
}

@media (max-width: 860px) {
  .footer-grid {
    grid-template-columns: 1fr 1fr;  /* 2 columns */
  }
}

@media (max-width: 560px) {
  .footer-grid {
    grid-template-columns: 1fr;  /* single column */
  }
}
```

### 8.6 Header

Header ใช้ grid layout 3 columns (back | title | spacer):

```css
nav {
  display: grid;
  grid-template-columns: 50px 1fr 50px;
  align-items: center;
  position: fixed;
  top: 0;
  background: rgba(253, 254, 255, 0.85);  /* semi-transparent */
  backdrop-filter: blur(6px);  /* glassmorphism */
  z-index: var(--fv-z-nav);
}

.page-title {
  font-size: 1.06rem;
  font-weight: bold;
  background: var(--fv-gradient-teal);  /* gradient text */
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### 8.7 Loading Spinner

Spinner ใช้ SVG แทน CSS (เพื่อ control ที่ดีกว่า):

```css
.fvl-spinner .fvl-track {
  stroke: var(--fvl-spinner-track);
  stroke-width: 3.5;
  fill: none;
}

.fvl-spinner .fvl-arc {
  stroke: var(--fvl-spinner-arc);
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-dasharray: 88 132;  /* partial circle */
  animation: _fvl_spin 0.7s linear infinite;  /* Material/iOS standard speed */
}
```

---

## 9. Animation & Motion Design

Motion design ของ Fantrove มีหลักการว่า "motion ต้องมีหน้าที่ ไม่ใช่แค่สวย" — ทุก animation ต้องตอบคำถามว่า "motion นี้ช่วยให้ผู้ใช้เข้าใจอะไรดีขึ้นไหม" ถ้าไม่ ก็ตัดทิ้ง

### 9.1 Transition Durations

Fantrove มี transition durations 3 ระดับหลัก:

```css
--fv-transition-fast:    150ms;   /* Hover states, button presses */
--fv-transition-normal:  260ms;   /* Modal open, panel expand */
--fv-transition-slow:    400ms;   /* Page transitions, large elements */
```

นอกจากนี้ยังมีค่าอื่น ๆ ที่ใช้เฉพาะกรณี:
- `140ms` — FVL shown (loading overlay appear)
- `180ms` — FVL leaving (loading overlay disappear)
- `200ms` — Most hover transitions
- `300ms` — back-to-top SVG, language overlay
- `450ms` — back-to-top button appear/disappear
- `700ms` — language dropdown zoom-in
- `1200ms` — topbar indeterminate animation cycle

กฎ: ห้ามใช้ duration > 500ms สำหรับ interactions ปกติ (ทำให้รู้สึกช้า) และห้ามใช้ < 100ms (มองไม่เห็น)

### 9.2 Easing Functions

```css
/* Material standard — ใช้สำหรับ general transitions */
--fv-ease-standard:  cubic-bezier(0.4, 0, 0.2, 1);

/* Fantrove spring — ใช้สำหรับ playful animations */
--fv-ease-spring:    cubic-bezier(0.2, 0.9, 0.2, 1);

/* Back-out (overshoot) — ใช้สำหรับ indicators, appear animations */
cubic-bezier(0.34, 1.56, 0.64, 1);

/* Back-out variant — ใช้สำหรับ back-to-top */
cubic-bezier(0.175, 0.885, 0.32, 1.275);
```

เลือก easing ตาม context:
- **Standard** — สำหรับ state changes ทั่วไป (hover, focus, color change)
- **Spring** — สำหรับ transforms ที่ต้องการความ "lively" (scale, translate)
- **Back-out** — สำหรับ elements ที่ "appear" (popup, indicator, button appear)

### 9.3 will-change Strategy

`will-change` ใช้เพื่อบอก browser ล่วงหน้าว่า property ไหนจะเปลี่ยน ทำให้ browser เตรียม GPU layer ได้ทัน:

```css
/* ใช้เมื่อ element จะ animate จริง ๆ */
.fp-popup { will-change: transform, opacity; }
.fvl-spinner { will-change: transform; }
#back-to-top { will-change: transform, opacity; }

/* ห้ามใช้ถ้าไม่จำเป็น — ใช้ memory */
❌ .every-element { will-change: transform; }
```

กฎ: ใช้ `will-change` เฉพาะ elements ที่จะ animate จริง ๆ และ remove ออกเมื่อ animation จบ (หรือใช้ transient class)

### 9.4 CSS Containment

`contain` property จำกัดการคำนวณ layout ให้อยู่ใน subtree เดียว ทำให้ browser ไม่ต้อง reflow ทั้งหน้าเมื่อ element หนึ่งเปลี่ยน:

```css
/* Layout + paint containment — สำหรับ components ที่ไม่ affect ภายนอก */
.bottom-nav { contain: layout paint style; }
.footer-inner { contain: content; }  /* = layout style paint */
.vs-container { contain: layout style paint; }

/* ห้ามใช้ contain: strict กับ elements ที่มี animations ข้างใน */
❌ .fvl-fullscreen { contain: strict; }  /* จะ freeze spinner */
```

### 9.5 prefers-reduced-motion

**ทุก CSS file** ต้องมี `@media (prefers-reduced-motion: reduce)` ที่ disable animations:

```css
/* Aggressive — ใช้ใน search.css */
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}

/* Moderate — ใช้ใน about.css, home.css */
@media (prefers-reduced-motion: reduce) {
  * {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
  }
}

/* Targeted — ใช้ใน popup.css, footer.css */
@media (prefers-reduced-motion: reduce) {
  .fp-popup, .fp-popup *, .fp-overlay {
    transition: none !important;
    animation: none !important;
  }
}
```

### 9.6 เมื่อไหร่ควร/ไม่ควร animate

**ควร animate:**
- State changes (hover, focus, active)
- Appear/disappear (modal open, toast appear)
- Loading states (spinner, progress bar)
- Navigation transitions (page change, route change)
- Feedback (copy success, error)

**ไม่ควร animate:**
- Layout shifts (ทำให้ CLS สูง)
- Content that user is reading (distracting)
- Decorative elements that don't communicate anything
- Anything that takes > 500ms for interaction feedback

### 9.7 Keyframe Animations

Fantrove มี keyframes หลัก:

```css
/* Spinner rotation */
@keyframes _fvl_spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Fade in/out */
@keyframes _fvl_in { from { opacity: 0; } to { opacity: 1; } }
@keyframes _fvl_out { from { opacity: 1; } to { opacity: 0; } }

/* Topbar indeterminate progress */
@keyframes _fvl_topbar_indeterminate {
  0%   { transform: translateX(-100%) scaleX(0.4); }
  50%  { transform: translateX(0%)     scaleX(0.7); }
  100% { transform: translateX(250%)   scaleX(0.4); }
}

/* Pulse (signals new operation) */
@keyframes _fvl_pulse {
  0%   { opacity: 1; transform: scale(1); }
  30%  { opacity: 0.6; transform: scale(0.97); }
  100% { opacity: 1; transform: scale(1); }
}

/* Background gradient shift */
@keyframes gradientShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
```

---

## 10. Accessibility Design

Accessibility (a11y) เป็น priority ของ Fantrove — ทุกคนต้องใช้เว็บได้ ไม่ว่าจะใช้ screen reader, keyboard only, หรือมี visual impairment

### 10.1 Visually Hidden Class

สำหรับเนื้อหาที่ต้องการให้ screen reader อ่านแต่ไม่ต้องการให้มองเห็น:

```css
.fv-sr-only {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

ใช้สำหรับ: SEO h1, skip links (ก่อน focus), additional context for screen readers

### 10.2 Skip Links

Skip link ช่วยให้ keyboard users ข้าม navigation ไปยัง main content ได้:

```html
<a href="#fv-main" class="fv-sr-only fv-skip-link">Skip to main content</a>
```

```css
.fv-skip-link:focus {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 99999;
  padding: 10px 20px;
  background: var(--fv-brand-teal-light);
  color: #fff;
  font-weight: 700;
  border-radius: 8px;
}
```

### 10.3 ARIA Attributes

Fantrove ใช้ ARIA อย่างครอบคลุม:

```html
<!-- Navigation -->
<nav role="navigation" aria-label="Main navigation">

<!-- Main content -->
<main id="fv-main" role="main">

<!-- Search results (announce to screen readers) -->
<main id="searchResults" role="main" aria-live="polite" aria-label="Search results" tabindex="0">

<!-- Filter toggle -->
<button aria-expanded="false" aria-controls="filterCatWrap">Filters</button>

<!-- FAQ -->
<input type="checkbox" id="faq1" class="faq-toggle" hidden />
<label for="faq1" class="faq-question">Question?</label>
<div class="faq-answer" role="region" aria-labelledby="faq1">Answer</div>

<!-- Footer -->
<footer role="contentinfo" aria-label="Site footer">
```

### 10.4 Focus Management

Focus ต้องชัดเจนเสมอ:

```css
/* Focus ring — ใช้ box-shadow แทน outline */
.fp-popup:focus-visible {
  box-shadow: var(--fp-shadow, var(--fv-shadow-lg)), var(--fv-shadow-focus);
}

p.content a:focus {
  outline: none;
  box-shadow: var(--fv-shadow-focus);  /* 4px teal ring */
  border-radius: 10px;
}
```

กฎ:
- ใช้ `:focus-visible` แทน `:focus` (ไม่ show ring เมื่อ click)
- ห้าม `outline: none` โดยไม่มี replacement
- Focus ต้อง visible บนทุก interactive element

### 10.5 Keyboard Navigation

ทุก interactive element ต้องใช้ได้ด้วย keyboard:
- Tab — เลื่อน focus ไปยัง element ถัดไป
- Shift+Tab — เลื่อนกลับ
- Enter/Space — activate button/link
- ESC — close popup/modal
- Arrow keys — navigate within component (tabs, lists)

### 10.6 Color Contrast

Text ต้องมี contrast ratio ขั้นต่ำ:
- **WCAG AA** (ขั้นต่ำ): 4.5:1 สำหรับ body text, 3:1 สำหรับ large text
- **WCAG AAA** (เป้าหมาย): 7:1 สำหรับ body text, 4.5:1 สำหรับ large text

ตัวอย่าง:
- `--fv-text-primary` (#0f2629) on white = 14.8:1 ✅ AAA
- `--fv-text-muted` (#6d8590) on white = 4.6:1 ✅ AA
- `--fv-text-faint` (#8ea1b8) on white = 3.1:1 ❌ (use only for large text)

### 10.7 prefers-reduced-motion

ดู section 9.5 — ทุก CSS file ต้องมี reduced-motion support

### 10.8 Touch Target Size

ดู section 5.2 — ขั้นต่ำ 44×44px

### 10.9 A11y Gaps ที่ต้องปรับปรุง

ปัจจุบันยังมี gaps ที่ต้องแก้:
- Skip links มีเฉพาะหน้า home (ควรมีทุกหน้า)
- `#back-to-top` ลบ outline โดยไม่มี replacement
- ใช้ `:focus` แทน `:focus-visible` ในบางที่
- ไม่มี `aria-current="page"` บน active nav items
- ไม่มี `role="tablist"`/`role="tab"` สำหรับ tabbed UIs

---

## 11. Performance-Driven Design

Performance เป็น priority #3 ของ Fantrove (รองจาก Documentation และ SEO) เพราะส่งผลต่อทั้ง UX และ SEO (Core Web Vitals)

### 11.1 CSS Containment

ใช้ `contain` property อย่างครอบคลุมเพื่อจำกัด layout calculations:

```css
contain: layout paint;        /* สำหรับ components ทั่วไป */
contain: layout paint style;  /* สำหรับ nav, footer, vs-container */
contain: layout style;        /* สำหรับ loading overlays */
contain: content;             /* = layout style paint (shorthand) */
```

### 11.2 GPU Layer Promotion

Elements ที่ animate บ่อยควร promote ไป GPU layer:

```css
.bottom-nav {
  transform: translateZ(0);
  will-change: transform;
  backface-visibility: hidden;
}

.fvl-spinner {
  backface-visibility: hidden;
  will-change: transform;
}
```

### 11.3 Font Loading Strategy

```css
@font-face {
  font-family: 'FoglihtenNo07calt';
  src: url('/assets/fonts/FoglihtenNo07calt.ttf') format('truetype');
  font-display: swap;  /* แสดง fallback ก่อน, swap เมื่อโหลดเสร็จ */
}
```

`font-display: swap` ทำให้ text มองเห็นได้ทันที (ไม่มองไม่เห็นระหว่างรอ font load) และ swap เป็น custom font เมื่อโหลดเสร็จ

### 11.4 Preload Strategy

Critical CSS และ fonts ต้อง preload:

```html
<link rel="preload" href="/assets/css/tokens.css" as="style" />
<link rel="preload" href="/assets/css/home.css" as="style" onload="this.rel='stylesheet'" />
<noscript><link rel="stylesheet" href="/assets/css/home.css" /></noscript>
```

### 11.5 Deferred Scripts

JavaScript ที่ไม่จำเป็นต้องโหลดทันทีใช้ `defer`:

```html
<script defer src="/assets/js/popup.js"></script>
<script defer src="/assets/js/modern-navigation.js"></script>
<script defer src="/assets/js/footer-template.js"></script>
```

### 11.6 Body Opacity Fade-In

หน้า home เริ่มต้นด้วย `opacity: 0` แล้ว fade in เมื่อ JS พร้อม เพื่อป้องกัน FOUC (Flash of Unstyled Content):

```html
<body style="opacity: 0">
```

```javascript
// ใน home.js
document.body.style.transition = 'opacity 0.3s ease';
document.body.style.opacity = '1';
```

### 11.7 Core Web Vitals Targets

| Metric | Good | Needs Improvement | Poor |
|---|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 2.5s | 2.5s - 4.0s | > 4.0s |
| INP (Interaction to Next Paint) | ≤ 200ms | 200ms - 500ms | > 500ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | 0.1 - 0.25 | > 0.25 |

วิธีทำให้ผ่าน:
- **LCP** — preload critical CSS, lazy load images, use CDN
- **INP** — URE virtual scroll (DOM เล็ก), Web Worker (งานหนัก off main thread)
- **CLS** — กำหนด width/height ของ images, หลีกเลี่ยง layout shifts

### 11.8 Virtual Scrolling

สำหรับ lists ที่มีหลายพันรายการ ใช้ URE (Universal Render Engine) ที่ render เฉพาะ items ใน viewport:

```javascript
URE.mount({
  container: '#list',
  data: myItems,  // 10,000+ items
  template: (item, lang) => `<div>${item.name}</div>`,
  buffer: 600,  // px นอก viewport
  recycling: true,  // reuse DOM nodes
});
```

---

## 12. Internationalization (i18n) Design

Fantrove รองรับหลายภาษา (ปัจจุบัน en + th) และออกแบบมาให้เพิ่มภาษาใหม่ได้ง่าย

### 12.1 data-translate Markers

ทุกข้อความใน UI ใช้ `data-translate` attribute:

```html
<h1 data-translate="home-title">Welcome to Fantrove</h1>
<button data-translate="action.save">Save</button>
```

Build script จะแปล markers เป็น text จริงในแต่ละภาษาตอน build time

### 12.2 Language Detection Before Paint

Language detection ต้องทำก่อน paint เพื่อไม่ให้ผู้ใช้เห็นภาษาผิดแป๊บนึง:

```html
<!-- โหลดเป็น script แรกสุดใน <head> -->
<script src="/assets/js/lang-proxy.js"></script>
<script src="/assets/js/lang-sync.js"></script>
```

### 12.3 Font Stack ที่รองรับหลายภาษา

```css
--fv-font-stack: 'Noto Sans', 'Segoe UI', 'Noto Sans Thai',
                  -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
```

Noto Sans รองรับหลายภาษา (รวม Thai ผ่าน Noto Sans Thai) ทำให้ text แสดงผลได้ดีในทุกภาษา

### 12.4 Layout ที่ยืดหยุ่นกับความยาวข้อความ

ข้อความในภาษาต่าง ๆ มีความยาวต่างกันมาก:
- "Settings" → "การตั้งค่า" (ยาวกว่า 50%)
- "Search" → "ค้นหา" (สั้นกว่า)

Layout ต้องรับความยาวต่างกันได้โดยไม่ break:

```css
/* ใช้ flexbox ที่ยืดหยุ่น */
.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1em 1.5em;  /* em-based padding */
}

/* หลีกเลี่ยง fixed widths สำหรับ text containers */
❌ .button { width: 100px; }  /* อาจไม่พอสำหรับ "การตั้งค่า" */
✅ .button { min-width: 100px; }
```

### 12.5 RTL/LTR Considerations

ปัจจุบันรองรับเฉพาะ LTR (Left-to-Right) แต่ถ้าจะเพิ่ม RTL (Arabic, Hebrew) ต้อง:
- ใช้ `dir="rtl"` บน `<html>`
- ใช้ logical properties (`margin-inline-start` แทน `margin-left`)
- ใช้ `flex-direction` ที่สะท้อน (row-reverse สำหรับ RTL)

### 12.6 ภาษาที่รองรับ

modern-navigation.js รองรับ 16 ภาษาใน NavPrefixManager:
- `th` (Thai), `en` (English) — active
- `ja, ko, zh, fr, de, es, it, pt, ru, ar, vi, id, ms, tl` — reserved สำหรับอนาคต

---

## 13. Visual Hierarchy & Typography

Visual hierarchy ทำให้ผู้ใช้เห็นสิ่งสำคัญก่อน โดยไม่ต้องสแกนทั้งหน้า

### 13.1 Typography Scale

```css
--fv-text-xs:    0.75rem    (12px)   /* Labels, captions */
--fv-text-sm:    0.875rem   (14px)   /* Secondary text */
--fv-text-base:  1rem       (16px)   /* Body text (ขั้นต่ำสำหรับ readability) */
--fv-text-lg:    1.125rem   (18px)   /* Lead text */
--fv-text-xl:    1.25rem    (20px)   /* Subheadings */
--fv-text-2xl:   1.5rem     (24px)   /* h3 */
--fv-text-3xl:   1.875rem   (30px)   /* h2 */
--fv-text-4xl:   2.25rem    (36px)   /* h1 */
```

### 13.2 Heading Hierarchy

```html
<h1>Page Title (1 อันต่อหน้า, ใช้ gradient text)</h1>
  <h2>Section Title</h2>
    <h3>Subsection Title</h3>
<p class="fv-section-label">EYEBROW LABEL</p>  <!-- uppercase, letter-spacing -->
```

Heading colors ใช้สีต่างกันเพื่อ create hierarchy:
- h1 — gradient brand (purple→green)
- h2 — purple (`--fv-brand-purple`)
- h3 — teal-light (`--fv-brand-teal-light`)
- Section labels — teal uppercase

### 13.3 Font Weights

```css
--fv-font-normal:    400;  /* Body text */
--fv-font-medium:    500;  /* Buttons, labels */
--fv-font-semibold:  600;  /* Subheadings */
--fv-font-bold:      700;  /* Headings */
--fv-font-extrabold: 800;  /* h1, strong emphasis */
--fv-font-black:     900;  /* Display (rarely used) */
```

### 13.4 Line Heights

```css
--fv-leading-tight:   1.25;   /* Headings */
--fv-leading-normal:  1.6;    /* Body */
--fv-leading-relaxed: 1.75;   /* Long-form text */
```

### 13.5 Letter Spacing

```css
/* Headings — slightly tighter */
h1 { letter-spacing: 0.045em; }
h2 { letter-spacing: 0.018em; }
h3 { letter-spacing: 0.013em; }

/* Body — normal */
body { letter-spacing: 0.01em; }

/* Section labels — wider for uppercase */
.fv-section-label { letter-spacing: 0.09em; }
```

### 13.6 Gradient Text Technique

```css
h1.hero-title {
  background: var(--fv-gradient-brand);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: brightness(0.95) contrast(1.35) saturate(1.2);  /* boost gradient */
}
```

### 13.7 Fluid Typography

สำหรับ headings ที่ต้องปรับขนาดตาม viewport:

```css
h1.page-title {
  font-size: clamp(1.3rem, 1.4rem + 0.9vw, 1.8rem);
}
```

---

## 14. Color System

ระบบสีของ Fantrove ออกแบบมาให้สื่อสารได้ทั้ง brand identity และ semantic meaning

### 14.1 Brand Palette

| Color | Hex | Usage |
|---|---|---|
| Teal | `#13b47f` | Primary brand — buttons, active states, focus |
| Teal Light | `#00CEB0` | Accents, hover states, gradient endpoints |
| Teal Dark | `#0a9273` | Active/pressed states |
| Cyan | `#0eb0d5` | Secondary accent |
| Cyan Accent | `#11c3ec` | Highlights, gradient start |
| Purple | `#B58CFF` | h2 headings, gradient |
| Purple Dark | `#9B6EFF` | Gradient start |
| Green Vivid | `#11C291` | Gradient mid |
| Green Bright | `#18E4A1` | Gradient end |

### 14.2 Text Color Hierarchy

```css
--fv-text-primary:   #0f2629;  /* สีเข้มสุด — เนื้อหาหลัก */
--fv-text-heading:   #152a2f;  /* Headings */
--fv-text-body:      #2f5157;  /* Body */
--fv-text-secondary: #52638A;  /* ข้อมูลรอง */
--fv-text-muted:     #6d8590;  /* Metadata */
--fv-text-faint:     #8ea1b8;  /* Placeholders */
--fv-text-inverse:   #ffffff;  /* บนพื้นเข้ม */
```

### 14.3 Surface Colors

```css
--fv-surface-page:        #ffffff;              /* พื้นหลังหน้า */
--fv-surface-card:        #ffffff;              /* พื้นการ์ด */
--fv-surface-card-alpha:  rgba(255, 255, 255, 0.94);  /* การ์ดโปร่งแสง */
--fv-surface-subtle:      #f8faff;              /* subtle bg */
--fv-surface-soft:        #f6f7fb;              /* soft bg */
--fv-surface-teal-hover:  rgba(248, 255, 253, 1);  /* hover สี teal */
```

### 14.4 Border Colors

```css
--fv-border-default:        rgba(14, 176, 213, 0.06);   /* ปกติ */
--fv-border-subtle:         rgba(0, 0, 0, 0.07);        /* subtle */
--fv-border-teal:           rgba(0, 206, 176, 0.25);    /* teal */
--fv-border-teal-strong:    rgba(0, 206, 176, 0.80);    /* teal เข้ม */
--fv-border-focus-ring:     rgba(19, 180, 127, 0.16);   /* focus */
```

### 14.5 Gradients

```css
/* Brand gradient — purple radial + green radial + purple-to-green linear */
--fv-gradient-brand:
  radial-gradient(circle at 30% 30%, rgba(181, 140, 255, 0.75) 0%, transparent 60%),
  radial-gradient(circle at 70% 70%, rgba(24, 228, 161, 0.75) 0%, transparent 60%),
  linear-gradient(135deg, #9B6EFF 0%, #11C291 100%);

/* Teal gradient — linear teal to cyan */
--fv-gradient-teal: linear-gradient(90deg, #13b47f 20%, #0eb0d5 80%);

/* Button gradient — cyan to teal */
--fv-gradient-btn: linear-gradient(to right, #11c3ec 0%, #13b47f 100%);

/* Accent bar — teal to cyan vertical */
--fv-gradient-accent-bar: linear-gradient(180deg, #13b47f, #0eb0d5);
```

### 14.6 Semantic Colors

| Semantic | Color | Usage |
|---|---|---|
| Success | `--fv-brand-teal` | Save success, copy success |
| Error | `#ff4444` | Error messages |
| Warning | `#CA8400` | Notices, warnings |
| Info | `--fv-brand-cyan` | Info messages |

### 14.7 กฎการใช้สี

- ห้าม hardcoded hex values ใน components — ใช้ tokens เสมอ
- ห้ามใช้สีที่ไม่อยู่ใน palette (ยกเว้น semantic colors ที่กำหนด)
- Color contrast ต้องผ่าน WCAG AA (4.5:1 สำหรับ body text)
- ห้ามใช้สีเป็นสื่อสารเดียว — ต้องมี text หรือ icon รองรับ (สำหรับ colorblind users)

---

## 15. Layout System

### 15.1 Container Max-Widths

```css
--fv-container-max: 1110px;  /* หน้าหลัก (home, about) */
--fv-container-md:  860px;   /* หน้า search */
--fv-container-sm:  600px;   /* หน้า settings */
```

### 15.2 Page Padding

```css
--fv-page-pad-x: 1.6rem;  /* ≈25.6px horizontal padding */
```

### 15.3 Section Spacing

```css
--fv-space-20: 5rem;  /* ระยะห่างระหว่าง sections (80px) */
```

### 15.4 Grid Layouts

```css
/* Footer 4-column */
.footer-grid {
  display: grid;
  grid-template-columns: 2.2fr 1fr 1fr 1.2fr;
  gap: 2.5rem 3rem;
}

/* Settings single column */
.settings {
  max-width: 28rem;
  margin: 0 auto;
}
```

### 15.5 Flexbox Patterns

```css
/* Hero — center align */
.hero {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3rem;
}

/* Nav — space evenly */
.bottom-nav {
  display: flex;
  justify-content: space-evenly;
  align-items: center;
}
```

### 15.6 Position Strategies

```css
/* Fixed nav */
.bottom-nav { position: fixed; inset: auto 0 0 0; }

/* Sticky header */
.search-sticky { position: sticky; top: 0; }

/* Absolute (virtual scroll items) */
.vs-item { position: absolute; left: 0; right: 0; }
```

### 15.7 Z-index Scale

```css
--fv-z-sticky:   100;       /* Sticky elements */
--fv-z-nav:      16000;     /* Navigation */
--fv-z-overlay:  17000;     /* Overlays */
--fv-z-modal:    18000;     /* Modals */
--fv-z-toast:    19000;     /* Toasts */
```

### 15.8 Safe-Area Handling

```css
padding: 10px 0 calc(env(safe-area-inset-bottom, 0px) + 0px);
```

---

## 16. Design Checklist สำหรับหน้าใหม่

เมื่อสร้างหน้าเว็บใหม่ ให้รันผ่าน checklist นี้:

### 16.1 Tokens & Foundation

- [ ] ใช้ `tokens.css` เป็น CSS แรกสุด
- [ ] ใช้ `--fv-*` tokens ไม่ใช่ hardcoded values
- [ ] ใช้ `--fv-font-stack` สำหรับ font-family
- [ ] ใช้ spacing scale (`--fv-space-*`) ไม่ใช่ magic numbers
- [ ] ใช้ border radius scale (`--fv-radius-*`) ไม่ใช่ค่าอื่น

### 16.2 Responsive

- [ ] มี `<meta name="viewport">` ที่ถูกต้อง
- [ ] ใช้ mobile-first CSS (base = mobile, `min-width` สำหรับ larger)
- [ ] ทดสอบบน 320px, 768px, 1024px, 1440px
- [ ] ไม่มี horizontal scroll บนมือถือ
- [ ] ใช้ `clamp()` สำหรับ fluid typography ที่จำเป็น

### 16.3 Accessibility

- [ ] มี skip link
- [ ] ใช้ semantic HTML (`<header>`, `<main>`, `<nav>`, `<footer>`)
- [ ] มี ARIA attributes ที่ถูกต้อง
- [ ] ทุก interactive element ใช้ keyboard ได้
- [ ] มี `:focus-visible` styles
- [ ] Color contrast ผ่าน WCAG AA
- [ ] มี `prefers-reduced-motion` support

### 16.4 Performance

- [ ] ใช้ `contain` บน components ที่ isolate ได้
- [ ] ใช้ `will-change` บน elements ที่ animate
- [ ] Images มี `width` + `height` (ป้องกัน CLS)
- [ ] Hero image ไม่ใช้ `loading="lazy"`
- [ ] Non-critical JS ใช้ `defer`
- [ ] Lighthouse Performance ≥ 90

### 16.5 i18n

- [ ] ทุกข้อความใช้ `data-translate`
- [ ] Layout รับความยาวข้อความต่างกันได้
- [ ] มี translation ใน `en.json` และ `th.json`

### 16.6 SEO

- [ ] มี `<title>` และ `<meta description>`
- [ ] มี hreflang tags
- [ ] มี canonical
- [ ] มี Open Graph + Twitter Card
- [ ] มี JSON-LD structured data (ถ้าเกี่ยวข้อง)
- [ ] มี `<html lang="...">`
- [ ] มี `<h1>` อันเดียว
- [ ] ใช้ semantic HTML

### 16.7 Components

- [ ] ใช้ `PopupSystem` ไม่ใช่ `alert()`/`confirm()`
- [ ] ใช้ `FVL` สำหรับ loading states
- [ ] ใช้ design tokens สำหรับ colors/spacing
- [ ] ปุ่มขนาด ≥ 44×44px
- [ ] มี `:active` state สำหรับ feedback

---

## 17. Anti-patterns (สิ่งที่ห้ามทำ)

### 17.1 ห้าม Hardcoded Values

```css
/* ❌ ห้าม */
.button { color: #13b47f; padding: 16px; }

/* ✅ ถูก */
.button { color: var(--fv-brand-teal); padding: var(--fv-space-4); }
```

### 17.2 ห้ามใช้ Border แทน Shadow (ในกรณีที่ต้องการ layered borders)

```css
/* ❌ ห้าม — ถ้าต้องการ gradient bg ด้วย */
.card { border: 1px solid #ccc; background: linear-gradient(...); }

/* ✅ ถูก */
.card { box-shadow: 0 0 0 1px var(--fv-border-default); background: linear-gradient(...); }
```

### 17.3 ห้ามลืม prefers-reduced-motion

```css
/* ❌ ห้าม — ไม่มี reduced-motion support */
.animated { animation: spin 1s infinite; }

/* ✅ ถูก */
.animated { animation: spin 1s infinite; }
@media (prefers-reduced-motion: reduce) {
  .animated { animation: none !important; }
}
```

### 17.4 ห้ามลืม Safe-Area

```css
/* ❌ ห้าม — บน iOS notch จะบัง */
.bottom-nav { padding: 10px 0; }

/* ✅ ถูก */
.bottom-nav { padding: 10px 0 calc(env(safe-area-inset-bottom, 0px) + 0px); }
```

### 17.5 ห้ามใช้ JS Animation แทน CSS

```javascript
/* ❌ ห้าม — ช้ากว่า CSS animations */
function animate() {
  element.style.transform = `translateX(${x}px)`;
  requestAnimationFrame(animate);
}

/* ✅ ถูก — ใช้ CSS transitions/animations */
// CSS: .element { transition: transform 0.3s; }
element.classList.add('moved');
```

### 17.6 ห้าม Skip Accessibility

```html
<!-- ❌ ห้าม -->
<div onclick="doSomething()">Click me</div>

<!-- ✅ ถูก -->
<button onclick="doSomething()" aria-label="Do something">Click me</button>
```

### 17.7 ห้าม Render Content ด้วย JS อย่างเดียว

```javascript
/* ❌ ห้าม — Google ไม่เห็น */
document.getElementById('content').innerHTML = '<h1>Important Title</h1>';

/* ✅ ถูก — อยู่ใน static HTML */
// <h1>Important Title</h1>
```

### 17.8 ห้ามใช้ `alert()` / `confirm()` / `prompt()`

```javascript
/* ❌ ห้าม */
alert('Saved!');
if (confirm('Delete?')) { ... }

/* ✅ ถูก */
await PopupSystem.toast('Saved!');
const ok = await PopupSystem.confirm('Delete?');
```

### 17.9 ห้าม Fixed Widths สำหรับ Text Containers

```css
/* ❌ ห้าม — ไม่รองรับหลายภาษา */
.button { width: 100px; }

/* ✅ ถูก */
.button { min-width: 100px; padding: 1em 1.5em; }
```

### 17.10 ห้าม Layout Shifts

```css
/* ❌ ห้าม — ทำให้ CLS สูง */
.image-container { width: 100%; }  /* ไม่มี height */

/* ✅ ถูก */
.image-container { width: 100%; aspect-ratio: 16 / 9; }
```

---

## 18. การนำไปใช้กับเว็บอื่น (Applying to Other Projects)

เอกสารนี้ออกแบบมาเป็น training data สำหรับ AI เพื่อนำหลักการไปใช้กับเว็บอื่นได้ ต่อไปนี้คือคำแนะนำ:

### 18.1 Universal Principles (นำไปใช้ได้เลย)

หลักการเหล่านี้ใช้ได้กับทุกเว็บ:
- Mobile-first design
- Performance-driven (Core Web Vitals)
- Accessibility-first (WCAG AA)
- Token-driven design system
- Progressive enhancement
- i18n-first
- SEO-first

### 18.2 Fantrove-Specific (ต้อง adapt)

สิ่งที่เป็นเอกลักษณ์ของ Fantrove ต้อง adapt ก่อนใช้กับเว็บอื่น:
- Brand colors (teal/cyan/purple) — เปลี่ยนเป็นสีของแบรนด์ใหม่
- Border radius scale (12/17/27/37/47) — อาจใช้ค่ามาตรฐาน 4/8/12/16/24 แทน
- Easing functions (spring, back-out) — อาจปรับตาม personality ของแบรนด์
- Bottom nav → left rail pattern — ขึ้นกับประเภทเว็บ

### 18.3 การ Adapt Tokens

เมื่อนำไปใช้กับเว็บใหม่:
1. เปลี่ยน prefix `--fv-*` เป็น prefix ของโปรเจกต์ใหม่ (เช่น `--myapp-*`)
2. ปรับ brand colors ตามแบรนด์ใหม่
3. คง spacing scale, typography scale, shadows, transitions ไว้ (universal)
4. ปรับ border radius ถ้าจำเป็น (แต่แนะนำให้คงความ "soft" ไว้)

### 18.4 การ Adapt Breakpoints

Breakpoints ควร calibrated ตามอุปกรณ์เป้าหมายของเว็บใหม่:
- ถ้าเว็บใช้บน tablet เยอะ → เพิ่ม breakpoints รอบ 768px-1024px
- ถ้าเว็บใช้บน desktop เยอะ → เพิ่ม breakpoints รอบ 1280px-1920px
- ถ้าเว็บใช้บนมือถือเยอะ → คง mobile-first approach

### 18.5 การ Maintain Design Consistency ข้ามโปรเจกต์

ถ้ามีหลายเว็บใน portfolio เดียวกัน:
- ใช้ design tokens ที่สอดคล้องกัน (spacing, typography, shadows)
- ใช้ component patterns เดียวกัน (buttons, cards, forms)
- ใช้ animation philosophy เดียวกัน (durations, easings)
- แต่ละเว็บมี brand colors ของตัวเอง แต่ structure เดียวกัน

### 18.6 คำแนะนำสำหรับ AI Agents

เมื่อ AI สร้างเว็บใหม่โดยใช้เอกสารนี้เป็น reference:
1. **อ่านทั้งเอกสารก่อน** เพื่อเข้าใจหลักการทั้งหมด
2. **เริ่มจาก tokens** — สร้าง design tokens ก่อน แล้วค่อยสร้าง components
3. **Mobile-first เสมอ** — เริ่มจาก mobile layout แล้วค่อยขยาย
4. **Test ทุก breakpoint** — ไม่ใช่แค่ desktop
5. **Verify accessibility** — ใช้ keyboard, screen reader
6. **Measure performance** — Lighthouse, Core Web Vitals
7. **ไม่ copy ทั้งหมด** — เลือกเฉพาะที่เหมาะกับเว็บใหม่

---

## 19. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`01-Virtual-Scroll-Rendering.md`](./01-Virtual-Scroll-Rendering.md) — URE (ใช้สำหรับ lists ใหญ่)
- [`06-Popup-System.md`](./06-Popup-System.md) — Popup system (9 presets)
- [`07-Loading-System.md`](./07-Loading-System.md) — FVL (4 loading modes)
- [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) — Performance techniques (Core Web Vitals)
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO Guide (priority #2)
- [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) — 🥇 Documentation Standard (priority #1)
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — Coding standards
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — Forbidden patterns
- [`INDEX.md`](./INDEX.md) — สารบัญเอกสารทั้งหมด

### External resources

- [Material Design 3](https://m3.material.io/) — Design system reference
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) — iOS/macOS design
- [WCAG 2.1](https://www.w3.org/TR/WCAG21/) — Accessibility guidelines
- [web.dev](https://web.dev/) — Performance & UX best practices
- [CSS-Tricks: Complete Guide to CSS Grid](https://css-tricks.com/snippets/css/complete-guide-grid/) — Grid reference
- [CSS-Tricks: Complete Guide to Flexbox](https://css-tricks.com/snippets/css/a-guide-to-flexbox/) — Flexbox reference
- [Can I Use](https://caniuse.com/) — Browser compatibility
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) — Color contrast validation
