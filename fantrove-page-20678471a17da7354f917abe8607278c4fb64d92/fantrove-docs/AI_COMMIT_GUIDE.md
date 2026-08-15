# AI_COMMIT_GUIDE — มาตรฐาน Commit Message, PR, และ Changelog

> เอกสารนี้กำหนดมาตรฐานการเขียน commit message, PR description, และ changelog สำหรับ AI agents ที่ทำงานกับ repo Fantrove
>
> **สำหรับ:** AI agents ที่จะ commit หรือเปิด PR
>
> **เป้าหมาย:** ทำให้ประวัติการเปลี่ยนแปลงของ repo อ่านง่าย ค้นหาง่าย และ generate changelog อัตโนมัติได้

---

## สารบัญ

1. [Commit Message Format](#1-commit-message-format)
2. [Type และ Scope](#2-type-และ-scope)
3. [Examples](#3-examples)
4. [Pull Request Description](#4-pull-request-description)
5. [Changelog](#5-changelog)
6. [Branch Naming](#6-branch-naming)
7. [Forbidden Patterns](#7-forbidden-patterns)

---

## 1. Commit Message Format

ใช้ **Conventional Commits** format ปรับปรุง:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 1.1 ส่วนหัว (header)

- บรรทัดเดียว ไม่เกิน **72 ตัวอักษร**
- ขึ้นต้นด้วย `<type>` ตามด้วย `(<scope>)` แล้ว `: <subject>`
- `subject` ใช้ imperative mood ("Add" ไม่ใช่ "Added")
- ห้ามลงท้ายด้วยจุด

### 1.2 ส่วนเนื้อหา (body) — optional

- ขึ้นบรรทัดใหม่ 1 ครั้งหลัง header
- แต่ละบรรทัดไม่เกิน **100 ตัวอักษร**
- อธิบาย "ทำไม" ไม่ใช่ "อะไร" (code บอก "อะไร" อยู่แล้ว)
- ใช้ bullet point `-` สำหรับหลายรายการ

### 1.3 ส่วนท้าย (footer) — optional

- ขึ้นบรรทัดใหม่ 1 ครั้งหลัง body
- ใช้สำหรับ:
  - `BREAKING CHANGE:` ตามด้วยคำอธิบาย
  - `Closes #123`, `Fixes #456`, `Refs #789`
  - `Co-authored-by: Name <email>`

---

## 2. Type และ Scope

### 2.1 Type ที่อนุญาต

| Type | ใช้เมื่อ | ตัวอย่าง |
|---|---|---|
| `feat` | เพิ่มฟีเจอร์ใหม่ | `feat(search): add fuzzy matching` |
| `fix` | แก้ bug | `fix(popup): close on ESC key` |
| `docs` | เปลี่ยนเอกสาร | `docs(ure): update API reference` |
| `style` | เปลี่ยน format ไม่กระทบ logic | `style(css): format indentation` |
| `refactor` | ปรับโค้ด ไม่เพิ่ม/แก้ feature | `refactor(nav-core): extract router` |
| `perf` | ปรับประสิทธิภาพ | `perf(ure): reduce GC pressure` |
| `test` | เพิ่ม/แก้ test | `test(search): add unit tests` |
| `build` | เปลี่ยน build system | `build: upgrade cheerio to 1.0.0` |
| `ci` | เปลี่ยน CI/CD | `ci: add Cloudflare deployment` |
| `chore` | งานบ้านทั่วไป | `chore: update .gitignore` |
| `revert` | revert commit ก่อนหน้า | `revert: feat(search): add fuzzy` |
| `release` | release เวอร์ชั่นใหม่ | `release: v1.8.0` |

### 2.2 Scope ที่ใช้บ่อย

| Scope | หมายถึง |
|---|---|
| `ure` | Universal Render Engine |
| `search` | Search System |
| `nav-core` | Nav-Core System |
| `language` | Language/i18n System |
| `con-data` | ConData Service |
| `popup` | Popup System |
| `fvl` | Loading System (FVL) |
| `build` | Build System |
| `home` | Home page |
| `setting` | Settings page |
| `whats-new` | What's New page |
| `docs` | Documentation |
| `content` | Content data |
| `deps` | Dependencies |
| (ไม่ระบุ) | Cross-cutting changes |

---

## 3. Examples

### 3.1 Feature ใหม่

```
feat(search): add fuzzy matching with Fuse.js

Implements two-tier search: exact substring first, then fuzzy fallback
using Fuse.js loaded lazily from CDN. Improves search experience for
typos and partial matches.

Closes #142
```

### 3.2 Bug fix

```
fix(popup): close popup on ESC key

Previously ESC only worked when focus was inside popup body. Now
listens on document level and closes topmost popup, matching user
expectation from native dialogs.

Fixes #98
```

### 3.3 Breaking change

```
feat(language)!: replace languageChange with fv:langchange

BREAKING CHANGE: All systems listening to 'languageChange' event must
migrate to 'fv:langchange'. The old event is removed in v5.0.

Migration:
- window.addEventListener('languageChange', fn)
+ window.addEventListener('fv:langchange', fn)

Affected files:
- home.js
- new.js
- version-core.js
- modern-navigation.js
```

### 3.4 Documentation

```
docs(ure): add Adaptive Memory Management section

Document v1.7.0 changes: MemoryManager singleton, pressure detection,
budget clamping. Updates API reference for setMemoryBudget().
```

### 3.5 Performance improvement

```
perf(ure): reduce GC pressure with DOM node pooling

Recycle DOM nodes in a pool instead of create/destroy on every scroll.
Reduces GC pauses by 80-95% on long scroll sessions.

Benchmark:
- Before: 12ms GC pause every 2s (10k items)
- After: <1ms GC pause every 30s
```

### 3.6 Refactor

```
refactor(nav-core): extract router into separate module

Moves routing logic from init.js to router.js for better separation
of concerns. No behavior change — all tests pass.
```

### 3.7 Release

```
release: v1.8.0

- Smoother loading with FVL improvements
- Prevent duplicate clicks causing stuck loading
- Block scrolling during loading overlay

See assets/md/en/current.md for full release notes.
```

### 3.8 Multi-line body

```
fix(home): prevent banner carousel from breaking on slow networks

- Add timeout fallback when banner API doesn't respond in 3s
- Show static banner image as fallback
- Log timeout errors to console for debugging

The banner API (fantrove-banner.vercel.app) occasionally times out
during peak hours, leaving the carousel in a loading state indefinitely.
This commit adds graceful degradation.
```

---

## 4. Pull Request Description

### 4.1 โครงสร้าง PR description

```markdown
## Summary

<1-2 ประโยคอธิบายว่า PR นี้ทำอะไร>

## Changes

- <change 1>
- <change 2>
- <change 3>

## Files Modified

- `path/to/file.js` — <what changed>
- `path/to/other.js` — <what changed>

## Testing

- [x] Manual test on Chrome
- [x] Manual test on Firefox
- [x] Manual test on Safari
- [x] Test with Thai language
- [x] Test with English language
- [x] No regression in existing features

## Screenshots

<if UI change, attach screenshots>

## Related Issues

Closes #<issue-number>
Refs #<related-issue>

## Checklist

- [x] Code follows AI_CODING_GUIDE
- [x] No AI_FORBIDDEN violations
- [x] Documentation updated (if needed)
- [x] Release notes updated (if user-facing)
```

### 4.2 ตัวอย่าง PR จริง

```markdown
## Summary

Add fuzzy matching to search system using Fuse.js, with lazy loading
to avoid impacting initial page load performance.

## Changes

- Add Fuse.js lazy loader (loads only when search is first used)
- Implement two-tier search: substring first, fuzzy fallback
- Add search highlight in results
- Update search state to track search mode

## Files Modified

- `assets/js/search-modules/search.js` — add fuzzy search function
- `assets/js/search-modules/state.js` — add isFuzzy flag
- `assets/js/search-modules/rendering.js` — highlight matched text
- `assets/css/search.css` — style for highlight
- `fantrove-docs/02-Search-System.md` — document new behavior

## Testing

- [x] Manual test on Chrome (Mac)
- [x] Manual test on Firefox (Mac)
- [x] Manual test on Safari (iOS)
- [x] Test with Thai language
- [x] Test with English language
- [x] No regression in existing features

## Related Issues

Closes #142
```

---

## 5. Changelog

### 5.1 ไม่มี CHANGELOG.md แยก

Fantrove ไม่ใช้ `CHANGELOG.md` แยก — ใช้ release notes ใน `assets/md/{en,th}/current.md` แทน (ดู [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md))

### 5.2 การ generate changelog อัตโนมัติ

ใช้ `git log` กับ conventional commit format:

```bash
# ดู changelog ระหว่าง 2 tags
git log v1.7.0..v1.8.0 --oneline --no-merges

# ดูเฉพาะ features และ fixes
git log v1.7.0..v1.8.0 --oneline --grep='^feat\|^fix'
```

### 5.3 การเขียน release notes จาก commits

เมื่อ release เวอร์ชั่นใหม่ ให้ดู commits ตั้งแต่ tag ล่าสุด แล้วเขียน release notes:

1. รวบรวม `feat:` → หมวด **New** ใน release notes
2. รวบรวม `fix:` → หมวด **Fixed**
3. รวบรวม `perf:`, `refactor:` → หมวด **Improved**
4. รวบรวม `revert:`, หรือที่ลบ feature → หมวด **Removed**

---

## 6. Branch Naming

### 6. รูปแบบ

```
<type>/<short-description>
```

### 6.2 ตัวอย่าง

```
feat/search-fuzzy-matching
fix/popup-esc-key
docs/ure-update
refactor/nav-core-router
perf/ure-memory-pool
release/v1.8.0
```

### 6.3 กฎ

- ใช้ `kebab-case`
- ไม่เกิน 50 ตัวอักษร
- ใช้ type เดียวกับ commit message
- ไม่ใส่ issue number ในชื่อ branch (ใส่ใน PR description)

---

## 7. Forbidden Patterns

### 7.1 ❌ Commit message ห้าม

```
# ❌ ไม่มี type
updated search.js

# ❌ ใช้ past tense
added fuzzy matching

# ❌ ลงท้ายด้วยจุด
feat(search): add fuzzy matching.

# ❌ ยาวเกินไป
feat(search): add fuzzy matching with Fuse.js library that will improve user experience when searching for emojis and symbols by allowing partial matches and typo tolerance

# ❌ ไม่จำเป็น
WIP
fix typo
asdf
update

# ❌ มี emoji
feat(search): add fuzzy matching 🎉
```

### 7.2 ❌ Commit เดียวหลายสิ่ง

```
# ❌ ผสมหลายอย่าง
feat: add search fuzzy + fix popup bug + update docs + refactor utils

# ✅ แยกเป็น 4 commits
feat(search): add fuzzy matching
fix(popup): close on ESC key
docs(ure): update API reference
refactor(utils): extract helper functions
```

### 7.3 ❌ Commit ขนาดใหญ่เกินไป

- หนึ่ง commit ควรมี < 500 บรรทัดเปลี่ยนแปลง
- ถ้าใหญ่กว่านี้ ให้แบ่งเป็นหลาย commit

### 7.4 ❌ Commit message ไม่ตรงกับ code

- อย่าเขียน "fix bug X" แต่จริง ๆ แก้ bug Y
- อย่าเขียน "refactor" แต่จริง ๆ เพิ่มฟีเจอร์

---

## 8. สรุป

| สิ่งที่ต้องจำ | สรุป |
|---|---|
| Format | `<type>(<scope>): <subject>` |
| Subject | imperative, ≤72 chars, no period |
| Body | อธิบาย "ทำไม", ≤100 chars/line |
| Type | feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert, release |
| Scope | ระบบที่กระทบ (ure, search, nav-core, ...) |
| One commit = one thing | อย่าผสมหลายอย่าง |
| PR description | มี Summary, Changes, Testing, Checklist |

> Commit message ที่ดีทำให้ reviewer เข้าใจการเปลี่ยนแปลงได้โดยไม่ต้องอ่านทุกบรรทัดของ code
