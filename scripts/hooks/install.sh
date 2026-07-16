#!/bin/bash
# scripts/hooks/install.sh — ติดตั้ง git hooks สำหรับ 4-layer version control
#
# วิธีใช้:
#   bash scripts/hooks/install.sh
#
# หลังติดตั้ง:
#   - pre-commit hook จะรันทุกครั้งที่ git commit
#   - pre-push hook จะรันทุกครั้งที่ git push
#   - ยกเลิก: git config --unset core.hooksPath

set -e

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  echo "❌  ไม่ได้อยู่ใน git repository"
  exit 1
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
