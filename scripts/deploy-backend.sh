#!/usr/bin/env bash
# household-ledger Backend deployment script
# - 소스(~/projects)를 운영 위치(/opt/household-ledger/backend)로 동기화
# - uv sync 로 venv 갱신 + systemd 재시작
# - DB 마이그레이션은 systemd unit 의 ExecStartPre(alembic upgrade)에서
#   /etc/household-ledger/household-ledger.env 를 읽어 실행됨 (재시작 시 자동)
#
# 왜 /opt 로 복사?  mome 와 동일한 이유 — SELinux/systemd 는 user home($HOME,
# user_home_t)에서 실행/EnvironmentFile 읽기를 거부. 운영 런타임은 시스템 경로에 둔다.
#
# Usage:
#   ./scripts/deploy-backend.sh
#
# Prerequisites:
#   - ~/projects/household-ledger 에서 코드 받아둔 상태 (git pull 은 수동)
#   - ./scripts/initial-setup.sh 로 /opt/... + systemd unit 준비됨
#   - uv 설치됨, sudo 권한
set -euo pipefail

# --- 설정 ---
PROJECT_ROOT="${PROJECT_ROOT:-$HOME/projects/household-ledger}"   # 소스 (git)
APP_HOME="${APP_HOME:-/opt/household-ledger}"                     # 운영 런타임
SRC_BACKEND="$PROJECT_ROOT/backend"
RUN_BACKEND="$APP_HOME/backend"
SERVICE_NAME="household-ledger-backend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
HEALTH_URL="http://127.0.0.1:${BACKEND_PORT}/api/health"

# --- 색깔 헬퍼 ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${YELLOW}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*" >&2; exit 1; }

# --- 검증 ---
[ -d "$SRC_BACKEND" ] || fail "소스 Backend 디렉토리 없음: $SRC_BACKEND"
[ -f "$SRC_BACKEND/pyproject.toml" ] || fail "pyproject.toml 없음: $SRC_BACKEND"
[ -d "$RUN_BACKEND" ] || fail "운영 디렉토리 없음: $RUN_BACKEND (먼저 ./scripts/initial-setup.sh)"
command -v uv >/dev/null || fail "uv 미설치 (curl -LsSf https://astral.sh/uv/install.sh | sh)"
systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service" \
  || fail "systemd 서비스 미등록: $SERVICE_NAME (먼저 ./scripts/initial-setup.sh)"

# --- 소스 → 운영 위치 동기화 (venv/캐시/시크릿 제외) ---
info "소스 → $RUN_BACKEND 동기화..."
rsync -a --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.env' --exclude '*.pyc' \
  "$SRC_BACKEND/" "$RUN_BACKEND/"
ok "동기화 완료"

# --- 의존성 동기화 (venv 생성/갱신, dev 제외) ---
info "uv sync (운영 의존성)..."
cd "$RUN_BACKEND"
uv sync --no-dev
[ -x "$RUN_BACKEND/.venv/bin/uvicorn" ] || fail ".venv/bin/uvicorn 없음 — uv sync 실패?"
[ -x "$RUN_BACKEND/.venv/bin/alembic" ] || fail ".venv/bin/alembic 없음 — uv sync 실패?"
ok "의존성 동기화 완료"

# --- 재시작 (ExecStartPre 에서 alembic upgrade head 자동 실행) ---
info "$SERVICE_NAME 재시작 (DB 마이그레이션 포함)..."
sudo systemctl restart "$SERVICE_NAME"

# --- 헬스 체크 (최대 30초 대기) ---
info "백엔드 부팅 대기..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" | grep -q "^200$"; then
    ok "백엔드 응답 확인 (${i}초) — $HEALTH_URL"
    info "최근 startup 로그:"
    sudo journalctl -u "$SERVICE_NAME" --since "1 min ago" --no-pager | tail -6
    exit 0
  fi
  sleep 1
done

fail "백엔드가 30초 안에 200 응답 안 함. 마이그레이션/DB 확인: journalctl -u $SERVICE_NAME -n 50"
