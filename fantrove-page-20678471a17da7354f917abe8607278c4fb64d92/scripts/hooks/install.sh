#!/bin/bash
# scripts/hooks/install.sh — ติดตั้ง git hooks สำหรับ 4-layer version control
#
# v2: เรียกอัตโนมัติผ่าน npm "prepare" script (ดู package.json) ตอน npm install
#     ผู้ใช้ไม่ต้องจำมารัน `npm run hooks:install` เองอีกต่อไป — เดิม Layer 1
#     (pre-commit) และ Layer 2 (pre-push) ไม่เคยทำงานเลยถ้าไม่มีใครรันคำสั่งนี้
#     ด้วยมือ ทำให้ "ระบบบล็อก 4 ชั้น" ทำงานจริงแค่ครึ่งเดียว (Layer 3/4 เท่านั้น)
#     อ้างอิงแพทเทิร์นเดียวกับที่ Husky ใช้: ผูก hook install เข้ากับ npm
#     "prepare" lifecycle script (https://typicode.github.io/husky/how-to.html,
#     https://github.com/typicode/husky/issues/884)
#
# วิธีใช้ (manual, ยังใช้ได้เหมือนเดิม):
#   bash scripts/hooks/install.sh
#
# หลังติดตั้ง:
#   - pre-commit hook จะรันทุกครั้งที่ git commit
#   - pre-push hook จะรันทุกครั้งที่ git push
#   - ยกเลิก: git config --unset core.hooksPath

set -e

# v2: ข้ามการติดตั้งใน CI เสมอ — ป้องกันไม่ให้ hook ไปบล็อก git commit/push
# ที่ Layer 3.4 ของ CI ทำเอง (ตาม pattern ที่ Husky แนะนำสำหรับ CI environment)
if [ -n "$CI" ]; then
  echo "ℹ️   ตรวจพบ CI environment (\$CI is set) — ข้ามการติดตั้ง git hooks"
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  # v2: ไม่ error ออกอีกต่อไป — เผื่อกรณี npm install ถูกรันในที่ที่ยังไม่ใช่ git
  # repo (เช่น extract จาก zip/tarball) ไม่ควรทำให้ npm install ทั้งหมด fail
  echo "ℹ️   ไม่ได้อยู่ใน git repository — ข้ามการติดตั้ง git hooks"
  exit 0
fi

cd "$REPO_ROOT"

# สร้าง .githooks directory
mkdir -p .githooks

# copy hooks
cp scripts/hooks/pre-commit .githooks/pre-commit
cp scripts/hooks/pre-push .githooks/pre-push

# ตั้ง executable
chmod +x .githooks/pre-commit
chmod +x .githooks/pre-push

# บอก git ให้ใช้ hooks directory นี้
git config core.hooksPath .githooks

echo "✅  ติดตั้ง git hooks สำเร็จ"
echo ""
echo "    pre-commit: .githooks/pre-commit (Layer 1)"
echo "    pre-push:   .githooks/pre-push (Layer 2)"
echo ""
echo "    ตอนนี้ทุกครั้งที่ git commit / git push จะมี validation อัตโนมัติ"
echo ""
echo "    ยกเลิก: git config --unset core.hooksPath"
echo ""
