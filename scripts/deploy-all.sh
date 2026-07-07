#!/usr/bin/env bash
# household-ledger 통합 배포 — backend + frontend 순차 진행
# 둘 중 하나라도 실패하면 즉시 중단
#
# Usage:
#   ./scripts/deploy-all.sh
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

YELLOW='\033[1;33m'; NC='\033[0m'
section() { echo -e "\n${YELLOW}=== $* ===${NC}\n"; }

section "1/2 Backend 배포"
"$SCRIPT_DIR/deploy-backend.sh"

section "2/2 Frontend 배포"
"$SCRIPT_DIR/deploy-frontend.sh"

section "최종 헬스 체크"
"$SCRIPT_DIR/health-check.sh"

echo -e "\n${YELLOW}배포 완료${NC}\n"
