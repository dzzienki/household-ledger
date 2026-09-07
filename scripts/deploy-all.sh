#!/usr/bin/env bash
# household-ledger 통합 배포 — backend + frontend 순차 진행
# 둘 중 하나라도 실패하면 즉시 중단
#
# Usage:
#   ./scripts/deploy-all.sh
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
section() { echo -e "\n${YELLOW}=== $* ===${NC}\n"; }

# --- Git 최신 상태 확인 ---
if command -v git >/dev/null 2>&1 && [ -d "$PROJECT_ROOT/.git" ]; then
  CURRENT_COMMIT=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  COMMIT_MSG=$(git -C "$PROJECT_ROOT" log -1 --pretty=%s 2>/dev/null || echo "")
  echo -e "${GREEN}[INFO] 현재 로컬 커밋: [$CURRENT_COMMIT] $COMMIT_MSG${NC}"

  if git -C "$PROJECT_ROOT" fetch origin main --quiet 2>/dev/null; then
    LOCAL_HASH=$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")
    REMOTE_HASH=$(git -C "$PROJECT_ROOT" rev-parse origin/main 2>/dev/null || echo "")
    if [ -n "$LOCAL_HASH" ] && [ -n "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
      echo -e "${YELLOW}[경고] 원격(origin/main)에 아직 pull 받지 않은 새 커밋이 있습니다!${NC}"
      echo -e "${YELLOW}[경고] 최신 코드를 배포하려면 'git pull origin main' 을 먼저 실행하세요.${NC}\n"
    fi
  fi
fi

section "1/2 Backend 배포"
"$SCRIPT_DIR/deploy-backend.sh"

section "2/2 Frontend 배포"
"$SCRIPT_DIR/deploy-frontend.sh"

section "최종 헬스 체크"
"$SCRIPT_DIR/health-check.sh"

echo -e "\n${YELLOW}배포 완료${NC}\n"
