# household-ledger — Nginx 세팅 가이드

Rocky Linux 기준. **이미 `mome`/`myapp` 등이 돌고 있는 기존 nginx 에 얹는** 방식입니다.
새 `server` 블록을 만들지 않고, 기존 단일 server 블록(`/etc/nginx/conf.d/myapp.conf`) 안에
`/household-ledger/` location 을 **추가**합니다. (같은 `server_name` 으로 server 블록을 또 만들면
`conflicting server name` 충돌)

## 1. 사전 체크리스트

- [ ] 백엔드가 systemd 로 `127.0.0.1:8000` 에 떠있음 (`household-ledger-backend`)
- [ ] 프론트 정적 파일이 `/var/www/household-ledger` 에 배포됨 (`deploy-frontend.sh`)
- [ ] `app.json` 의 `experiments.baseUrl` = `/household-ledger` (정적 자산 경로)
- [ ] SELinux `httpd_can_network_connect` on (initial-setup.sh 가 설정)

> **포트 8000 선택 이유**: 같은 서버에서 `myapp`/`mome`(8080), `mayhemdex`(3000),
> `grafana`(5000)가 이미 사용 중 → household-ledger 는 겹치지 않는 `8000` 사용.

## 2. `/etc/nginx/conf.d/myapp.conf` 에 location 추가

기존 `server { ... }` **블록 안**에 아래 3개 location 을 추가합니다 (기존 `/mome/` 블록들 옆):

```nginx
  # ===== /household-ledger/api/ → FastAPI 8000 =====
  # proxy_pass 끝에 /api/ 가 붙어있음: location 프리픽스(/household-ledger/api/)를
  # /api/ 로 치환 → 백엔드는 원래대로 /api/... 를 받음 (FastAPI 가 /api 로 네임스페이스됨).
  location /household-ledger/api/ {
      proxy_pass http://127.0.0.1:8000/api/;
      proxy_http_version 1.1;
      proxy_set_header Host              $host;
      proxy_set_header X-Real-IP         $remote_addr;
      proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      # 영수증 이미지 업로드/다운로드 대응
      proxy_request_buffering off;
      proxy_buffering off;
      proxy_read_timeout 120s;
      proxy_send_timeout 120s;
  }

  # ===== /household-ledger → /household-ledger/ 301 (trailing slash 보정) =====
  # $host 가 아니라 $http_host 사용 — 외부 비표준 포트(8080 포워딩) 보존.
  # $host 는 포트를 떼버려서 외부(:8080) 접속이 80 포트로 새버림.
  location = /household-ledger {
      return 301 $scheme://$http_host/household-ledger/;
  }

  # ===== /household-ledger/ → 정적 SPA =====
  location /household-ledger/ {
      alias /var/www/household-ledger/;
      try_files $uri $uri/ /household-ledger/index.html;
  }
```

**핵심 결정**:
- location 매칭은 longest-prefix: `/household-ledger/api/` (21자) > `/household-ledger/` (17자) > `/mome/...` > `/`. 순서와 무관하게 정확히 분기됨.
- `location = /household-ledger` (등호=exact) 로 슬래시 없는 것만 301. 등호 빼면 `/household-ledger/abc` 까지 가로채 SPA 라우팅이 깨짐.
- `alias` (root 아님): 요청 `/household-ledger/_expo/x.js` → `/var/www/household-ledger/_expo/x.js`.
- 업로드 용량: 기존 server 블록에 `client_max_body_size 60M` 이 이미 있으면 그대로 커버(영수증 ≤10MB). 없거나 12M 미만이면 server 블록에 `client_max_body_size 12M;` 추가.

## 3. 반영 + 확인

```bash
sudo nginx -t
sudo systemctl reload nginx

# 정적 SPA
curl -I http://127.0.0.1/household-ledger/            # 200 + text/html

# API (백엔드 도달)
curl -s http://127.0.0.1/household-ledger/api/health  # {"status":"ok"}
```

외부:
```bash
curl -s http://dzzienki.duckdns.org:8080/household-ledger/api/health   # {"status":"ok"}
# 브라우저: http://dzzienki.duckdns.org:8080/household-ledger/
```

## 4. HTTPS

기존 도메인에 이미 인증서가 있으면 location 만 추가하면 끝(별도 작업 없음). 신규라면 mome 와 동일:
```bash
sudo certbot --nginx -d <도메인>
```

## 5. 흔히 막히는 지점

| 증상 | 원인 / 해결 |
|---|---|
| 새로고침 시 404 | `try_files ... /household-ledger/index.html;` 빠짐 |
| `/household-ledger/api/` 502/503 | 백엔드 안 떠있거나 SELinux `httpd_can_network_connect` off |
| `/household-ledger/api/*` 가 html(SPA) 응답 | nginx reload 안 함 → `nginx -t && systemctl reload nginx` |
| 정적 파일 403 | `/var/www/household-ledger` SELinux 라벨(`chcon -t httpd_sys_content_t`) 또는 권한 |
| 외부(:8080) 에서 `/household-ledger` 리다이렉트가 80으로 샘 | `return 301` 에 `$host` 씀 → `$http_host` 로 교체 |
| 자산 404 (`/_expo/...`) | `app.json` baseUrl ≠ `/household-ledger` 상태로 빌드됨 → 재빌드 |
