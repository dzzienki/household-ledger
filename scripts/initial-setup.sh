#!/usr/bin/env bash
# household-ledger 초기 셋업 스크립트 — 1회만 실행
# 새 서버(Rocky/RHEL 계열)에서 처음 배포할 때 시스템 디렉토리/서비스 만들어둠
#
# Usage:
#   ./scripts/initial-setup.sh
#
# 이 스크립트가 만드는 것:
#   - /opt/household-ledger/backend            (백엔드 운영 런타임 + venv)
#   - /etc/household-ledger                     (env 파일 위치)
#   - /var/lib/household-ledger/uploads         (영수증 업로드)
#   - /var/www/household-ledger                 (frontend dist)
#   - /etc/systemd/system/household-ledger-backend.service
#   - /etc/household-ledger/household-ledger.env (템플릿 복사 — 값은 CHANGE_ME 상태)
#
# 이 스크립트가 만들지 않는 것 (수동 작업 필요):
#   - env 의 실제 시크릿 값 (템플릿 복사 후 sudo nano 로 채움)
#   - /etc/nginx/conf.d/myapp.conf 의 location 블록 (doc/nginx-setup.md 참고)
#   - PostgreSQL, Node, uv, Nginx 등 패키지
set -euo pipefail

RUN_USER="${RUN_USER:-$USER}"
APP_HOME="${APP_HOME:-/opt/household-ledger}"   # 운영 런타임 (SELinux 안전 경로)
RUN_BACKEND="$APP_HOME/backend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
WORKERS="${WORKERS:-2}"
ENV_FILE="/etc/household-ledger/household-ledger.env"
SERVICE_FILE="/etc/systemd/system/household-ledger-backend.service"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
EXAMPLE_ENV="$SCRIPT_DIR/household-ledger.env.example"

YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${YELLOW}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $*"; }

# --- 시스템 디렉토리 ---
info "시스템 디렉토리 생성..."
sudo mkdir -p "$RUN_BACKEND" /etc/household-ledger /var/lib/household-ledger/uploads /var/www/household-ledger
# 운영 런타임(/opt/...)은 배포 유저 소유 — deploy-backend.sh 가 rsync + uv sync 함
sudo chown -R "$RUN_USER:$RUN_USER" "$APP_HOME"
sudo chown -R "$RUN_USER:$RUN_USER" /var/lib/household-ledger
sudo chown -R nginx:nginx /var/www/household-ledger 2>/dev/null || true
ok "디렉토리 생성 완료"

# --- SELinux ---
info "SELinux 설정..."
sudo chcon -R -t httpd_sys_content_t /var/www/household-ledger 2>/dev/null || true
sudo setsebool -P httpd_can_network_connect 1
ok "SELinux 설정 완료"

# --- 방화벽 ---
info "방화벽 — http/https 열기..."
sudo firewall-cmd --permanent --add-service=http 2>/dev/null || true
sudo firewall-cmd --permanent --add-service=https 2>/dev/null || true
sudo firewall-cmd --reload 2>/dev/null || true
ok "방화벽 설정 완료"

# --- systemd unit ---
if [ -f "$SERVICE_FILE" ]; then
  info "$SERVICE_FILE 이미 존재 — 건너뜀"
else
  info "$SERVICE_FILE 생성..."
  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=household-ledger FastAPI Backend
After=network.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$RUN_BACKEND

EnvironmentFile=$ENV_FILE

# DB 마이그레이션을 부팅 직전에 실행 (EnvironmentFile 로 DB 접속정보 주입됨)
ExecStartPre=$RUN_BACKEND/.venv/bin/alembic upgrade head
ExecStart=$RUN_BACKEND/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $BACKEND_PORT --workers $WORKERS

Restart=always
RestartSec=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=household-ledger-backend

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  ok "systemd unit 등록 완료 (enable 은 첫 배포 후)"
fi

# --- env 템플릿 배치 (값은 사용자가 채움) ---
ENV_PLACED=0
if [ -f "$ENV_FILE" ]; then
  info "$ENV_FILE 이미 존재 — 덮어쓰지 않음"
elif [ -f "$EXAMPLE_ENV" ]; then
  info "env 템플릿 배치 → $ENV_FILE (600 root:root)"
  sudo install -m 600 -o root -g root "$EXAMPLE_ENV" "$ENV_FILE"
  ENV_PLACED=1
  ok "템플릿 복사 완료 — 이제 CHANGE_ME / HOST 값만 채우면 됩니다"
else
  info "템플릿 없음($EXAMPLE_ENV) — env 는 수동 작성 필요"
fi

# --- 다음 단계 안내 ---
echo ""
echo -e "${YELLOW}=== 다음 단계 ===${NC}"
if [ "$ENV_PLACED" = "1" ]; then
  echo "1. env 값 채우기 (틀은 이미 배치됨 — CHANGE_ME / HOST 만 수정):"
  echo "   sudo nano $ENV_FILE"
  echo "   # JWT_SECRET 은:  openssl rand -base64 32"
else
  echo "1. env 작성 (doc/deployment-guide.md 2절 참고):"
  echo "   sudo install -m 600 -o root -g root scripts/household-ledger.env.example $ENV_FILE"
  echo "   sudo nano $ENV_FILE"
fi
echo ""
echo "2. nginx location 추가 (doc/nginx-setup.md) → /etc/nginx/conf.d/myapp.conf"
echo "   sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "3. 첫 배포:"
echo "   ./scripts/deploy-backend.sh"
echo "   sudo systemctl enable household-ledger-backend"
echo "   ./scripts/deploy-frontend.sh"
echo ""
echo "4. 헬스 체크:  ./scripts/health-check.sh"
