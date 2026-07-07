#!/usr/bin/env bash
# household-ledger 헬스 체크 — 모든 컴포넌트 정상 동작 여부 확인
#
# Usage:
#   ./scripts/health-check.sh
#
# Exit codes:
#   0: 전체 정상
#   1: 하나 이상 실패

BACKEND_PORT="${BACKEND_PORT:-8000}"
CONTEXT_ROOT="${CONTEXT_ROOT:-/household-ledger}"
WEB_ROOT="${WEB_ROOT:-/var/www/household-ledger}"
ENV_FILE="/etc/household-ledger/household-ledger.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
FAIL_COUNT=0

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo -e "${GREEN}[OK]${NC}   $name"
  else
    echo -e "${RED}[FAIL]${NC} $name"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo -e "${YELLOW}=== household-ledger Health Check ===${NC}"

# --- systemd 서비스 ---
check "nginx 서비스 active"                    systemctl is-active --quiet nginx
check "household-ledger-backend 서비스 active" systemctl is-active --quiet household-ledger-backend

# --- 백엔드 직접 ---
check "백엔드 ${BACKEND_PORT} /api/health 200" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${BACKEND_PORT}/api/health | grep -q '^200$'"

# --- Nginx 경유 ---
check "${CONTEXT_ROOT}/ SPA 응답 (200)" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1${CONTEXT_ROOT}/ | grep -q '^200$'"
check "${CONTEXT_ROOT}/api/health 백엔드 도달 (200)" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1${CONTEXT_ROOT}/api/health | grep -q '^200$'"

# --- 파일 / 권한 ---
check "${WEB_ROOT}/index.html 존재"            test -f "${WEB_ROOT}/index.html"
check "${ENV_FILE} 600 root:root" \
  bash -c "stat -c '%a %U %G' '${ENV_FILE}' | grep -q '^600 root root$'"
check "${WEB_ROOT} SELinux 라벨" \
  bash -c "ls -ldZ '${WEB_ROOT}' | grep -q httpd_sys_content_t"

# --- SELinux 부울 ---
check "SELinux httpd_can_network_connect on" \
  bash -c "getsebool httpd_can_network_connect | grep -q 'on$'"

echo ""
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}=== 모든 체크 통과 ===${NC}"
  exit 0
else
  echo -e "${RED}=== $FAIL_COUNT 개 실패 ===${NC}"
  exit 1
fi
