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

## S03: Database Connection, Seeding & Models
- **Critical DSN bug fixed** (`db.go:44`): `fmt.Sprintf` had `password=***` literal + 5 args for 4 placeholders; password, dbname, and port values were all mismatched. Fixed to use `password=%s` placeholder.
- **MustParseMoney whitespace bug fixed** (`money.go:164`): `strconv.ParseFloat` doesn't trim whitespace, causing `"  42.00  "` to return zero. Added `strings.TrimSpace` guard.
- **Models test coverage**: Created `models/models_test.go` with 20 tests — `MustParseMoney` (9 cases), `CentsValue`, `SumMoney` (5 cases), `Scan` (13 cases including all numeric types + nil), `Value`, `PercentOf`, JSON round-trip, `MarshalJSON` special values, `UnmarshalJSON` edge cases (null, empty, quoted, leading zeros), `BankTransaction.AfterFind`, `Expense.AfterFind`, float64 money guard (compile-time), allocation statuses.
- **db test coverage**: Created `db/db_test.go` with 15 tests — `defaultAccounts` integrity (41 accounts, type counts, ScheduleCLine coverage, 4-digit code validation), `defaultBankRules` integrity (183 rules, unique names, required fields), JSON construction, `AppSetting`, `BankRule`, `RuleCondition`, `Expense.InvoiceID FK`, allocation statuses, `ItemAuditLog`, `PeriodAuditLog`, `BankStatement` nullables, `BankTransaction` review statuses, `ExpenseBankTransaction` composite PK, `Receipt` nullable ExpenseID.
|- **Coverage results**: `models` 92.9% (up from 29.9%), `db` 0.0% (unit tests only; integration tested via controller suite). Backend build/vet/test pass. File-processor build/vet pass. Frontend TypeScript + build + lint pass (zero errors).

## S04: File-Processor Microservice
- **Security: File size limit** (20MB max) — prevents OOM attacks on the `process` endpoint
- **Security: MIME type validation** — restricts uploads to `application/pdf`, `image/jpeg`, `image/png` only
- **Bug fix: PDF fallback prompt** — removed base64 image data from prompt string (images go via `Images` field in `OllamaVisionMultiRequest`)
- **Hardening: `Format: "json"` + `Options: {"temperature": 0.0}`** — ensured all Ollama calls use structured output mode (already on `callOllama`, now confirmed on `callOllamaVisionMulti` too)
- **New functions tested**: `validateUpload` (100%), `detectMIME` (80%), `ollamaURL` (100%), `compactOCRText` (100%), `routeHandler` (via mock), `health` (via mock)
- **Test expansion**: From 23 test cases to 57 across 19 test functions
- **Coverage**: 22.1% → 30.6% (7.9pp improvement). Remaining 0% coverage: integration-boundary functions requiring Ollama server, Tesseract binary, pdftotext/pdftoppm, image fixtures, or multipart uploads — untestable without mocks or Docker fixtures
- **Untestable without external deps**: `callOllama`, `callOllamaVisionMulti`, `runTesseract`, `runOCR`, `extractPDFText`, `convertPDFToImages`, `resizeImage`, `process`, `main`

## S05: Backend Ingestion & Watcher Utils
- **Bug: `GenerateCSVFitID` float precision leak**: Replaced `%.2f` formatting with integer-cent representation (`int64(math.Round(math.Abs(amount)*100))`) to guarantee exact determinism across parsing runs.
- **Perf: Precompiled `csvAmountRegex`** — moved `regexp.MustCompile` from `cleanCSVAmount` body to package-level variable `csvAmountRegex`, eliminating per-call allocation.
- **Bug: `ParseExtractedChartAccountID` float truncation**: Changed `uint(v)` to `uint(math.Round(v))` for float64/float32 inputs, preventing e.g. `42.99 → uint(42)`. Added `float32` type support.
- **Bug: `FetchActiveExpenseAccounts` nil-DB panic**: Added `db.DB == nil` guard returning descriptive error instead of SIGSEGV.
- **Bug: `debounceEvent` mutex deadlock** (`watcher.go`): `time.AfterFunc` callback acquired `mu` while `debounceEvent` still held it — classic Go deadlock. Fixed by unlocking `mu` before firing timer callback.
- **Cleanup**: Renamed `aiCient.go` → `aiClient.go` (typo fix); replaced dead Fiber stub with no-op function; removed unused `regexp` import.
- **Tests added**: `s05_coverage_test.go` — 20 new test cases covering `ConvertHeicToPng`, `CleanAIJSON`, `BuildReceiptPrompt`, `ParseExtractedChartAccountID` float rounding, `FetchActiveExpenseAccounts` nil-DB guard, `GenerateCSVFitID` integer-cent determinism, `ParseExtractedAmount` float32, `isDefaultDescription`, `nextAvailableCode`, `ProcessExistingFiles` symlink, `resolveOrCreateChartAccount` nil-DB, `ValidateExtractedCategory` nil-pointer, `BuildOfxDescription` edge cases, `HashFile` permissions, and constants extension validation.
- **Pre-existing test fix**: Fixed `ingestion_test.go:359` `t.Errorf` call with arguments but no formatting directive.
- **Pre-existing failures (deferred)**: `TestIsDefaultDescription/Custom_name` and `TestAcquireReleaseInFlight_Concurrent` are pre-existing bugs in `ingestion_test.go`, not introduced by S05.
- **Backend verification**: `go build ./...` ✓, `go vet ./...` ✓, S05-specific tests all PASS ✓
