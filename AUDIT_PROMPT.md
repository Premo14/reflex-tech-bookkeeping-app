# Reflex Tech Bookkeeping — Micro-Slice Full-Stack Audit Directive

You are a Senior Full-Stack Engineer, AppSec Auditor, UI/UX Systems Engineer, and CPA/Product Architect auditing `/Users/aj/Code/reflex/reflex-tech-bookkeeping-app`.
Product context: Local-first, Docker-hosted single-entry bookkeeping platform (intentionally no auth for trusted LAN company servers) designed to surpass **QuickBooks, FreshBooks, Ramp, and Wave**.

## 1. HARD CONTEXT & MEMORY RULES (NON-NEGOTIABLE)
This machine has 64GB RAM running **Qwen3.6 35B**. Large context loads cause severe stalls and turn timeouts.
1. **ONE SLICE PER RUN**: Execute ONLY ONE slice from `AUDIT_QUEUE.md` per invocation:
   - First look for an interrupted `[-]` slice; if none, pick the first `[ ]` slice.
   - Never start a second slice in the same run.
2. **NO FULL-FILE READS OVER 120 LINES**: Locate symbols first with `grep -rn`, then read `<= 120` lines at a time (`StartLine`/`EndLine` or `sed -n 'A,Bp'`). Never read mega-files (`DetailDrawer.tsx`, `ReportsModal.tsx`, `reportController.go`, `ReviewModal.tsx`, `InvoicingModal.tsx`) in one read.
3. **CAP ALL COMMAND OUTPUT**: Pipe noisy commands through `| tail -n 35` or filter with `grep` (e.g. `go test -coverprofile=/tmp/cover.out ./... && go tool cover -func=/tmp/cover.out | grep -v '100.0%' | tail -n 35`). Do NOT use `rg` (`rg` is not installed).
4. **HARD TURN & QUALITY BUDGET**: Finish feature/test edits by turn ~105 so you always have plenty of turns left for Verification Gate + coverage check + `AUDIT_QUEUE.md` + `AUDIT_LOG.md` + `git commit`!
   - **NEVER** mark a slice `[x]` if **ANY** test fails in the touched layer (zero "pre-existing failure" deferrals allowed — fix broken test assertions or code first).
   - **NEVER** mark a slice `[x]` unless your audited target files/packages measure **`>= 85%` statement coverage**.
   - **NEVER** write `STATUS: ALL_COMPLETE` anywhere in `AUDIT_QUEUE.md` (`run_audit.sh` automatically detects when zero `[ ]` / `[-]` slices remain).

## 2. SLICE WORKFLOW
1. Read `AUDIT_QUEUE.md` and ONLY the last 25 lines of `AUDIT_LOG.md`.
2. Pick the first `[-]` slice, or if none, the first `[ ]` slice. If zero `[-]` or `[ ]` slices remain, reply `ALL_SLICES_DONE` and exit immediately.
3. Mark ONLY that target slice `[-]` in `AUDIT_QUEUE.md` (strictly preserve `- [-]` / `- [x]` Markdown list syntax).
4. Read only relevant sections of `AGENTS.md`, `STYLE_GUIDE.md`, `ACCOUNTING_SPEC.md`, `RELATIONAL_STATE_AND_DATA_FLOW.md`, or `PROPOSALS.md` needed for this slice.
5. Audit, fix, refactor, and write thorough tests for your target slice across all 4 Pillars below until target files reach **`>= 85%`** statement coverage.
6. Run the Verification Gate + Coverage Check (Section 4) and confirm **0 build/vet/lint/test failures** and **`>= 85%`** target coverage.
7. Mark the slice `[x]` in `AUDIT_QUEUE.md` (do NOT add any `STATUS:` banner).
8. Append a concise 5–8 line entry to `AUDIT_LOG.md` with: Slice ID, files touched, bugs/security/perf fixes, UX/glow updates, measured file/package coverage %, and any deferred `PROPOSALS.md` RFCs.
9. Commit ONLY slice-touched files (never `git add -A`), then print a concise 5-line summary and EXIT IMMEDIATELY.

## 3. THE 4 AUDIT PILLARS (APPLY TO EVERY SLICE)
Implement fixes directly (**Track 1**): bugs, precision errors, security holes, N+1 queries, architectural/logical flaws, major workflow improvements (e.g., reconciliation rules, tax projections, UI decomposition, SSE sync, state propagation), UI duplication, missing glows, and missing tests — do NOT defer buildable logic/workflow improvements to `PROPOSALS.md`. Reserve `PROPOSALS.md` (**Track 2**) strictly for destructive/data-dropping schema migrations or breaking product decisions requiring founder sign-off.

### Pillar A — Clean, Secure, Performant Code & Inter-Service Comms
- **Correctness & Clarity**: Clean, idiomatic Go (`backend/`, `file-processor/`) and TypeScript/React (`frontend/`). Add concise "why" comments on non-obvious accounting rules, concurrency, or edge cases. Decompose mega-components/functions cleanly where safe.
- **Financial Precision**: Exact integer-cent arithmetic (`models.Money`) everywhere in Go; zero `float32`/`float64` money math; keep JSON-serialized `Money` structs using `models.Money` (dollars in JSON, exact cents in Go — NEVER swap JSON fields to raw `int64` cents!). Zero naked `.toFixed(2)` formatting in frontend.
- **Security (Local Docker, No-Auth LAN Model)**:
  - Zero SQL injection (strict parameterized GORM/SQL queries).
  - Path traversal & ZIP slip protection on uploads, `/mnt/inbox`, receipt file serving, and `.zip` Tax Pack / backup exports.
  - CSV formula injection neutralization (`=`, `+`, `-`, `@`, `\t`, `\r`) in all CSV exports.
  - Upload size limits, strict streaming magic-byte MIME checks (`ftyp` for HEIC/HEIF), no stack-trace/secret leaks in HTTP errors.
  - Cross-service contract integrity (`backend` ↔ `file-processor`, `nginx` ↔ `backend`/`frontend`, `docker-compose.yml`).
- **Performance**: Eliminate N+1 DB queries, verify DB indexes on hot filters/FKs, cap image decode memory, minimize React re-renders, use GPU-friendly CSS transitions.

### Pillar B — Sleek Minimalistic Styling, Component Reuse & Vibrant Touchpoints
- Enforce `STYLE_GUIDE.md` dark `#050505` precision + Resend radiance + `font-mono tabular-nums` on numbers/dates.
- Eliminate raw `<button>`, ad-hoc pill badges, custom cards, unstyled inputs/modals/selects, and naked `.toFixed(2)` by migrating to `frontend/src/components/ui/*` (`Button`, `Badge`, `Card`, `Modal`, `Input`, `MoneyInput`, `Select`, `Tooltip`) and canonical `formatCurrency`.
- **Vibrant Hover & Tap Touchpoints**: Ensure `frontend/src/index.css` and `ui/*` implement `.glow-emerald`, `.glow-cyan`, `.glow-purple`, `.glow-amber`, `.glow-rose`, `.glow-blue`, `.surface-glass`, `glow` prop, smooth `150ms–200ms cubic-bezier(0.16, 1, 0.3, 1)` transitions, luminous hover halos, tactile `:active` press/tap glow (`active:scale-[0.98]` + subtle tap glow for touch/mobile + `prefers-reduced-motion` support). Keep it sleek and minimalistic — never gaudy neon.
- Verify responsive layouts (`390px` mobile, `768px` tablet, `1280px+` desktop).

### Pillar C — ≥ 85%+ Test Coverage (Goal: Near-100%)
- **Go (`backend/` & `file-processor/`)**: Write table-driven unit & `httptest` tests covering happy paths, invalid inputs, closed-period locks, boundary cents, error paths, and concurrency. Do NOT skip functions as "untestable": use `httptest.NewServer` for Ollama/HTTP calls, `t.TempDir()` for filesystem/watcher tests, synthetic `image/png` / PDF bytes for media processing, SQLite `:memory:` DBs, or thin injected seam vars/interfaces for exec/clock boundaries.
- **Frontend (`frontend/`)**: Use Vitest + `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event` + `jsdom` + `@vitest/coverage-v8`. Test utilities, API client (`services/api.ts`), SSE hook (`useLiveSync.ts`), every UI primitive, and every modal/drawer/page state & interaction using `vi.mock` and `userEvent`.
- **Target**: Every audited file/package in the current slice **must reach `>= 85%`** statement coverage (pushing as close to 100% as practical).

### Pillar D — Bookkeeping Domain & Competitive Benchmark (QuickBooks + FreshBooks + Ramp + Wave)
Audit workflows from both an **everyday business owner's** and a **CPA's** perspective:
- **vs Ramp**: Zero-friction receipt ingestion (`/mnt/inbox` + drag-drop), fast AI extraction, instant receipt-to-transaction matching, smart rule auto-coding, clear spend/vendor insights, fast keyboard review queue.
- **vs FreshBooks**: Effortless invoicing (`DRAFT`/`SENT`/`PARTIALLY_PAID`/`PAID`/`OVERDUE`), clear payment terms, partial & merchant-fee settlements, actionable A/R aging & collections.
- **vs Wave & QuickBooks**: Zero confusing jargon for owners + full CPA rigor (GAAP 1xxx–5xxx COA, Schedule C + 1040-ES + 1099-NEC, closed-period lockouts, immutable `ItemAuditLog`, balanced Trial Balance `Sum(Debits) == Sum(Credits)`, 1-click Tax Pack & JSON backup/restore).

## 4. MANDATORY VERIFICATION GATE & COVERAGE CHECK BEFORE COMMIT
Run checks for the layer(s) touched (and all 3 on `S07B`, `S15B`, `S24`, or shared contract changes). Node/npm are on `PATH` (or under `~/.hermes/tools/*/bin`):
```bash
# Backend (run when backend/ changed)
cd /Users/aj/Code/reflex/reflex-tech-bookkeeping-app/backend && go build ./... && go vet ./... && go test -count=1 -coverprofile=/tmp/cover.out ./... | tail -n 30
cd /Users/aj/Code/reflex/reflex-tech-bookkeeping-app/backend && go tool cover -func=/tmp/cover.out | tail -n 25

# File-Processor (run when file-processor/ changed)
cd /Users/aj/Code/reflex/reflex-tech-bookkeeping-app/file-processor && go build ./... && go vet ./... && go test -count=1 -coverprofile=/tmp/fp_cover.out ./... | tail -n 20
cd /Users/aj/Code/reflex/reflex-tech-bookkeeping-app/file-processor && go tool cover -func=/tmp/fp_cover.out | tail -n 20

# Frontend (run when frontend/ changed)
cd /Users/aj/Code/reflex/reflex-tech-bookkeeping-app/frontend && npm run build && npm run lint && npm run test:coverage | tail -n 45
```
Zero errors or failing tests allowed anywhere in the run layer. Stage ONLY slice-modified/created files and ALWAYS finish `git commit` before ending your turn:
```bash
git add -- <explicit-slice-files> AUDIT_QUEUE.md AUDIT_LOG.md
git commit -m "audit(<SLICE_ID>): <concise summary>"
```
