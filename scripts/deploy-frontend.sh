#!/usr/bin/env bash
# household-ledger Frontend deployment script
# - npm ci + Expo web export + /var/www/household-ledger 로 rsync + SELinux 라벨
# - nginx reload 불필요 (정적 파일만 바뀌므로)
#
# Usage:
#   ./scripts/deploy-frontend.sh
#
# Prerequisites:
#   - node + npm 설치됨
#   - sudo 권한 (rsync, chown, chcon)
#
# 주의: API_BASE 는 상대경로(/household-ledger)라 LAN IP / DuckDNS:8080 / HTTPS
#       어느 origin 에서 접속해도 그대로 동작함 (origin 별 재빌드 불필요).
set -euo pipefail

# --- 설정 ---
PROJECT_ROOT="${PROJECT_ROOT:-$HOME/projects/household-ledger}"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
DIST_DIR="$FRONTEND_DIR/dist"
WEB_ROOT="${WEB_ROOT:-/var/www/household-ledger}"
CONTEXT_ROOT="${CONTEXT_ROOT:-/household-ledger}"
# api.ts 가 이 값 뒤에 /api/... 를 붙임. 상대경로라 origin 무관하게 동작.
API_BASE="${API_BASE:-$CONTEXT_ROOT}"
PROBE_URL="http://127.0.0.1${CONTEXT_ROOT}/"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${YELLOW}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*" >&2; exit 1; }

# --- 검증 ---
[ -d "$FRONTEND_DIR" ] || fail "Frontend 디렉토리 없음: $FRONTEND_DIR"
command -v npm >/dev/null || fail "npm 미설치"
# app.json 의 baseUrl 이 CONTEXT_ROOT 와 일치하는지 확인 (자산 경로 정합성)
grep -q "\"baseUrl\": \"${CONTEXT_ROOT}\"" "$FRONTEND_DIR/app.json" \
  || fail "app.json 의 experiments.baseUrl 이 ${CONTEXT_ROOT} 가 아님 — 정적 자산 경로 깨짐"

# --- 의존성 설치 + 빌드 ---
info "npm ci..."
cd "$FRONTEND_DIR"
npm ci --silent

info "Expo web export (EXPO_PUBLIC_API_URL=${API_BASE})..."
rm -rf "$DIST_DIR"
EXPO_PUBLIC_API_URL="$API_BASE" npx expo export --platform web

[ -f "$DIST_DIR/index.html" ] || fail "dist/index.html 생성 실패"

# --- context root prefix 검증 ---
if ! grep -q "${CONTEXT_ROOT}/_expo/" "$DIST_DIR/index.html"; then
  fail "dist/index.html 에 ${CONTEXT_ROOT}/ prefix 없음 — app.json 의 baseUrl 확인 필요"
fi
ok "빌드 검증 통과 — ${CONTEXT_ROOT}/ prefix 정상"

# --- 배포 ---
info "$WEB_ROOT 으로 배포..."
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$DIST_DIR/" "$WEB_ROOT/"
sudo chown -R nginx:nginx "$WEB_ROOT"
sudo chcon -R -t httpd_sys_content_t "$WEB_ROOT" 2>/dev/null || true
ok "배포 완료"

# --- 헬스 체크 ---
info "Nginx 정상 응답 확인..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROBE_URL")
if [ "$STATUS" = "200" ]; then
  ok "$PROBE_URL → 200 OK"
else
  fail "$PROBE_URL → $STATUS (예상: 200). nginx location ${CONTEXT_ROOT}/ 설정 확인 (doc/nginx-setup.md)"
fi
