# household-ledger 전체 배포 가이드

Rocky Linux (사설망) + 다중 앱 동거 환경에 household-ledger 를 운영 배포하는 절차.
`mome` 와 **같은 서버·같은 nginx** 에 `/household-ledger/` context root 로 얹는다.
(mome 의 `doc/deployment-guide.md` 컨벤션을 따름 — Python/FastAPI + Expo 로 치환)

---

## 0. 환경 개요

### 스택

| 항목 | 값 |
|---|---|
| OS | Rocky Linux 10 (RHEL 계열) |
| Backend | Python 3.12 · FastAPI · uvicorn (systemd) |
| Frontend | Expo (React Native Web) 정적 export |
| 패키지 | uv (backend), npm (frontend) |
| DB | PostgreSQL (원격) |
| Backend 포트 | **8000** (8080=myapp/mome, 3000, 5000 이미 사용 중이라 회피) |
| Context root | `/household-ledger/` |

### 라우팅 (기존 nginx `myapp.conf` 단일 server 블록에 추가)

```
서버 nginx :80  (myapp.conf — location 분기)
  ├── /mome/ ...              (기존)
  ├── /household-ledger/api/  → 127.0.0.1:8000  (FastAPI, prefix 를 /api/ 로 재작성)
  ├── /household-ledger/      → /var/www/household-ledger  (Expo 정적 SPA)
  └── /                       (기존 myapp)
```

### 시스템 파일 위치 (mome 와 동일 컨벤션)

| 용도 | 경로 |
|---|---|
| 백엔드 운영 런타임 + venv | `/opt/household-ledger/backend` |
| 백엔드 환경변수 | `/etc/household-ledger/household-ledger.env` (mode 600, root:root) |
| 영수증 업로드 | `/var/lib/household-ledger/uploads` |
| 프론트엔드 정적 | `/var/www/household-ledger` (nginx:nginx, SELinux `httpd_sys_content_t`) |
| systemd unit | `/etc/systemd/system/household-ledger-backend.service` |
| Nginx 설정 | `/etc/nginx/conf.d/myapp.conf` (mome 와 공유) |
| 소스 (개발용) | `~/projects/household-ledger` |

> **왜 소스(~/projects)와 런타임(/opt)을 분리?** SELinux/systemd(init_t)는 user home
> (`user_home_t`)에서 EnvironmentFile 읽기·실행을 거부한다. 운영 런타임은 `/opt`,
> 시크릿은 `/etc` 같은 시스템 경로에 둔다. `deploy-backend.sh` 가 소스→/opt 동기화를 담당.

---

## 1. 사전 준비 (1회만)

### 1.1 패키지

```bash
sudo dnf install -y nginx policycoreutils policycoreutils-python-utils rsync
```

### 1.2 uv (Python 런타임/패키지)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
uv --version
```

### 1.3 Node.js (프론트 빌드용) — nvm 권장

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm use 20
node -v && npm -v
```

### 1.4 PostgreSQL

운영 DB(원격 또는 로컬)에 `household_ledger` 데이터베이스와 계정 준비. 접속정보는 2절 env 에 기입.

### 1.5 시스템 디렉토리 + systemd unit (자동)

```bash
cd ~/projects/household-ledger
./scripts/initial-setup.sh
```
→ `/opt/household-ledger/backend`, `/etc/household-ledger`, `/var/lib/household-ledger/uploads`,
`/var/www/household-ledger` 생성 + SELinux/방화벽 + systemd unit 등록.

---

## 2. 환경변수 파일

`initial-setup.sh` 가 템플릿(`scripts/household-ledger.env.example`)을
`/etc/household-ledger/household-ledger.env` 로 **600 root:root 로 복사**해 둡니다.
따라서 처음부터 작성할 필요 없이 **`CHANGE_ME` / `HOST` 값만 채우면** 됩니다:

```bash
sudo nano /etc/household-ledger/household-ledger.env
# JWT_SECRET 생성:  openssl rand -base64 32
```

> initial-setup 을 안 거치고 수동으로 배치하려면:
> ```bash
> sudo install -m 600 -o root -g root \
>   scripts/household-ledger.env.example /etc/household-ledger/household-ledger.env
> ```

### 템플릿 내용 (`/etc/household-ledger/household-ledger.env`)

```ini
# App
APP_ENV=production
APP_DEBUG=false

# Database (둘 다 필요 — 앱은 async, alembic 도 async 엔진 사용)
DATABASE_URL=postgresql+asyncpg://household_ledger:CHANGE_ME@HOST:5432/household_ledger
SYNC_DATABASE_URL=postgresql+psycopg://household_ledger:CHANGE_ME@HOST:5432/household_ledger

# JWT — openssl rand -base64 32 로 생성
JWT_SECRET=CHANGE_ME_LONG_RANDOM_STRING
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=14

# CORS — 같은 도메인에서 프론트+API 서빙하면 비워둬도 됨
CORS_ORIGINS=

# AI (선택) — 없으면 AI 기능 자동 비활성
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# 영수증 업로드 위치
UPLOAD_DIR=/var/lib/household-ledger/uploads
```

> 권한(600 root:root)은 `initial-setup.sh` 가 `install -m 600 -o root -g root` 로 이미 설정.
> 값 수정 후 별도 chmod 불필요.

> **왜 600 root:root**: systemd(PID 1)가 EnvironmentFile 을 읽어 자식 프로세스(User=$USER)에
> 환경변수로 주입. 실행 사용자가 시크릿 파일을 직접 못 읽는 게 더 안전. 그리고 `/etc`(etc_t)라야
> SELinux 가 systemd 의 읽기를 허용(home 의 user_home_t 는 거부).

---

## 3. 백엔드 — systemd 서비스

`initial-setup.sh` 가 만드는 `/etc/systemd/system/household-ledger-backend.service`:

```ini
[Unit]
Description=household-ledger FastAPI Backend
After=network.target

[Service]
Type=simple
User=<you>
Group=<you>
WorkingDirectory=/opt/household-ledger/backend
EnvironmentFile=/etc/household-ledger/household-ledger.env

# 부팅 직전 DB 마이그레이션 (env 주입된 상태로 실행)
ExecStartPre=/opt/household-ledger/backend/.venv/bin/alembic upgrade head
ExecStart=/opt/household-ledger/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2

Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=household-ledger-backend

[Install]
WantedBy=multi-user.target
```

**핵심 결정**:
- `ExecStartPre=alembic upgrade head` — 마이그레이션을 배포 스크립트가 아니라 서비스 부팅에 묶었다.
  그래야 EnvironmentFile 의 DB 접속정보를 그대로 쓸 수 있음(배포 셸은 600 env 를 못 읽음).
  실패하면 서비스가 안 뜨고 → `deploy-backend.sh` 헬스체크가 잡아냄.
- `.venv/bin/uvicorn` 직접 실행 — 런타임에 uv 불필요, PATH/HOME 의존 없음.
- `Restart=always` — 비정상 종료 시 항상 복구. 의도적 `systemctl stop` 은 systemd 가 구분해서 재시작 안 함.

등록/시작:

```bash
./scripts/deploy-backend.sh                 # 소스→/opt 동기화 + uv sync + restart(+migrate)
sudo systemctl enable household-ledger-backend
```

확인:

```bash
curl -s http://127.0.0.1:8000/api/health    # {"status":"ok"}
sudo journalctl -u household-ledger-backend -f
```

---

## 4. 프론트엔드 — 빌드 + 배포

### 4.1 context root 설정 (이미 커밋됨)

| 파일 | 설정 |
|---|---|
| `frontend/app.json` | `expo.experiments.baseUrl = "/household-ledger"` (정적 자산 경로) |
| 빌드 env | `EXPO_PUBLIC_API_URL=/household-ledger` (api.ts 가 뒤에 `/api/...` 붙임) |

> **API_BASE 를 상대경로(`/household-ledger`)로 두는 이유**: LAN IP · `duckdns:8080` · HTTPS 도메인
> 어느 origin 에서 접속해도 재빌드 없이 동작. 절대 URL 로 박으면 origin 마다 다시 빌드해야 함.

### 4.2 빌드 + 배포 (자동)

```bash
./scripts/deploy-frontend.sh
```
→ `npm ci` → `EXPO_PUBLIC_API_URL=/household-ledger npx expo export --platform web` →
`dist/` 를 `/var/www/household-ledger` 로 rsync + `chown nginx:nginx` + SELinux 라벨.
(정적 파일만 바뀌므로 nginx reload 불필요)

---

## 5. Nginx

기존 `myapp.conf` 에 `/household-ledger/` location 3개를 추가한다. 상세는
**[doc/nginx-setup.md](nginx-setup.md)** 참고. 요약:

```bash
# myapp.conf 의 server{} 안에 location 추가 후
sudo nginx -t && sudo systemctl reload nginx
curl -s http://127.0.0.1/household-ledger/api/health   # {"status":"ok"}
```

---

## 6. 배포 스크립트

```bash
cd ~/projects/household-ledger
git pull origin main

./scripts/deploy-backend.sh    # backend/ 변경 시
./scripts/deploy-frontend.sh   # frontend/ 변경 시
./scripts/deploy-all.sh        # 양쪽 다
./scripts/health-check.sh      # 상태 점검
```

---

## 7. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 서비스가 env 못 읽음 (`Permission denied` on EnvironmentFile) | env 를 home 에 둠 → `/etc/household-ledger/household-ledger.env` (etc_t) 로 이전 |
| `alembic upgrade` 실패로 서비스 안 뜸 | env 의 `DATABASE_URL` 오타/DB 미접속 → `journalctl -u household-ledger-backend -n 50` |
| `/household-ledger/api/` 502/503 | 백엔드 다운 또는 SELinux `httpd_can_network_connect` off |
| 정적 파일 403 | `/var/www/household-ledger` SELinux 라벨 또는 권한 (`chcon -t httpd_sys_content_t`) |
| 새로고침 404 | nginx `try_files ... /household-ledger/index.html;` 누락 |
| 자산 404 (`/_expo/...`) | `app.json` baseUrl ≠ `/household-ledger` 로 빌드됨 → `deploy-frontend.sh` 재실행 |
| 외부(:8080) 리다이렉트가 80 으로 샘 | nginx `return 301` 에 `$host` 대신 `$http_host` 사용 |
| 포트 충돌 | 8000 이 이미 점유됐는지 `ss -ltnp | grep 8000` 확인 |

---

## 8. 명령어 치트시트

```bash
# 백엔드
sudo systemctl status household-ledger-backend
sudo journalctl -u household-ledger-backend -f
sudo systemctl restart household-ledger-backend
curl -s http://127.0.0.1:8000/api/health

# 환경변수 변경 후
sudo nano /etc/household-ledger/household-ledger.env
sudo systemctl restart household-ledger-backend

# Nginx
sudo nginx -t && sudo systemctl reload nginx
sudo tail -f /var/log/nginx/error.log

# SELinux
sudo ausearch -m AVC -ts recent | tail -20
ls -Z /var/www/household-ledger
sudo chcon -R -t httpd_sys_content_t /var/www/household-ledger
sudo setsebool -P httpd_can_network_connect 1

# 배포
cd ~/projects/household-ledger && git pull origin main && ./scripts/deploy-all.sh
```
