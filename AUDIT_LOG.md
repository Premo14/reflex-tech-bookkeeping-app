# Reflex Tech Bookkeeping — Micro-Slice Audit Log

Append-only progress log. Each completed slice appends 6–10 concise lines below (files touched, fixes, UI/glow updates, measured coverage %, and any `PROPOSALS.md` RFCs).

---

## S00: Baseline Coverage & Frontend Test Infra
- Installed Vitest + @testing-library/react/jest-dom/user-event + jsdom + @vitest/coverage-v8 in frontend/
- Updated `frontend/package.json` with `test` / `test:coverage` scripts
- Created `frontend/vitest.config.ts` (jsdom, globals, coverage, `@/` alias)
- Created `frontend/src/test/setup.ts` (jest-dom matchers, cleanup hook)
- Created `frontend/src/vitest-globals.d.ts` (vitest global type declarations)
- Created `frontend/src/test/Button.test.tsx` — 2 smoke tests (renders + variant)
- Updated `frontend/tsconfig.app.json`: added `baseUrl`, `paths`, `ignoreDeprecations: "6.0"`
- **Backend baseline**: controllers 10.3%, models 29.9%, utils 17.8%, constants 11.6%
- **File-processor baseline**: 22.1%
- **Frontend baseline**: 0.11% statements (smoke test only)
- Verification Gate: all 3 layers build/vet/test pass, zero errors

## S01: Infra, Docker & Cross-Service Comms
- **docker-compose.yml**: Added `deploy.resources.limits` (CPU/memory caps) to all 7 services: frontend 2CPU/1G, backend 4CPU/2G, postgres 2CPU/4G, file-processor 2CPU/2G, ollama 8CPU/16G, nginx 0.5CPU/128M, scanner-smb 0.5CPU/128M. Added nginx healthcheck. Added comment documenting purpose of `/host_fs:rw` mount and Go-side path sanitization.
- **nginx/nginx.conf**: Added 4 security headers — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`. Removed unnecessary empty `events {}` block.
- **start.sh**: Replaced `chmod -R 777` (world-writable) with `chmod -R 755` + targeted `chmod 775` on document-data/inbox/processed for scanner UID 1000 write access.
- **ollama/entrypoint.sh**: Added 60s server startup timeout (30 retries x 2s), post-pull model verification (explicit `grep -q` for both `llama3.1` and `qwen2.5vl`), and `exit 1` on failure.
- **.env.example**: Added section headers, inline comments for every variable, and `host.docker.internal` note for local Ollama development.
- **Files touched**: `docker-compose.yml`, `nginx/nginx.conf`, `start.sh`, `start.bat`, `ollama/entrypoint.sh`, `.env.example`.
- **Verification**: `docker compose config` passes, `bash -n` passes for start.sh and entrypoint.sh, Go build/vet pass zero errors, frontend TypeScript + build + lint pass zero errors (pre-existing 163 warnings untouched).

## S02: Backend Entry, Routing, SSE & Constants
- **events.go Broadcast race fix**: Replaced map iteration under RLock with key snapshot approach — collect keys first, release lock, then iterate snapshot. Prevents panic when concurrent Unsubscribe closes/deletes channels during broadcast.
- **routes.go**: Removed duplicate `/system/backup` route (same handler as `/system/backup/export`).
- **eventsController.go**: Removed dead `BroadcastEvent` wrapper (unused, replaced by `events.Broadcast` in all callers).
- **Health controller**: Added `no_models_loaded` status when Ollama returns HTTP 200 but models list is empty (previously misreported as `ready: true`).
- **main.go graceful shutdown**: Added `shutdownCh` signal; background reconciliation ticker now exits cleanly on SIGTERM/SIGINT.
- **Cross-controller import migration**: Added `"reflex-tech-bookkeeping-app-api/events"` import to 5 controller files (reconciliation, expense, account, invoice, settings) and replaced all `BroadcastEvent(` with `events.Broadcast(`.
- **New tests**: `events_test.go` — 3 new cases (concurrent subscribe/unsubscribe, unsubscribed client drop, snapshot behavior). `health_controller_test.go` — 13 new tests (database, storage, HTTP health, compute status, Ollama tags, filename, file processor, company name). `events_controller_test.go` — 3 tests (SSE stream handler, panic safety, broadcast wrapper).
- **Backend test coverage**: events package ~100%, constants ~100%, controllers improved with new coverage. All 3 layers build/vet/test pass zero errors.
- **Nginx SSE**: Verified `proxy_buffering off`, `proxy_read_timeout 24h`, `chunked_transfer_encoding off` already in place (no changes needed).
- **CORS**: Verified `AllowOrigins: ["http://localhost:5173"]` + `AllowCredentials: true` — appropriate for LAN-only model.
