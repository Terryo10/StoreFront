# Stocktake — offline-first frontend (Zimbabwe V1)

React + TypeScript back-office and mobile counting UI for a self-hosted Laravel stocktake API. **Counts are always persisted to IndexedDB before success UI.** Sync is foreground/manual; Background Sync is not assumed.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL. Sign in with a demo user (password `demo`):

| Email | Role |
|-------|------|
| `counter@demo.local` | counter |
| `supervisor@demo.local` | supervisor |
| `manager@demo.local` | manager |
| `owner@demo.local` | owner |
| `auditor@demo.local` | auditor |

## Environment

Copy `.env.example`:

```bash
VITE_API_MODE=mock          # mock | live
VITE_API_BASE_URL=http://127.0.0.1:8000
```

- **mock** (default): fault-injectable local adapter + 1,000 seeded products. No Laravel required.
- **live**: typed HTTP client calls the LAN API. Missing endpoints surface as errors/notices — local changes are **never** silently marked server-synced.

See `docs/API.md` and `BACKEND_GAPS.md`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build (PWA app shell) |
| `npm run test` | Vitest unit/component tests |
| `npm run test:e2e` | Playwright scenarios |
| `npm run preview` | Preview production build |

## Architecture

```
src/app          routing + providers + layouts
src/features     auth, products, stocktakes, counting, variances, sync, settings, dashboard
src/components   UI primitives + status badges
src/db           Dexie schema, seed (1k products)
src/api          typed HTTP client + mock push/pull
src/services     count persistence, sync engine
src/lib          decimal qty, ids, permissions, storage, connectivity
src/domain       shared DTO types
```

### Offline event model

Saving a count (one IndexedDB transaction):

1. Increment device sequence
2. Append `countEvents` + `outbox` with the same UUID
3. Update `countViews` / `stocktakeLines` display quantity (`add` or `replace`)

Outbox statuses: `pending` → `syncing` → `acknowledged` | `rejected` | `conflict`. Rejected events are never dropped.

### Blind counting

Counters do not see expected quantities when the session is blind (UI + accessible copy). Supervisors/managers can review variances after submission.

## Acceptance coverage (local)

- Seeded catalogue of 1,000 products; barcode lookup is IndexedDB-backed
- Counts survive refresh (Dexie); success UI only after local write
- Mock sync can inject network / 409 / 422 / auth faults from **Sync → Mock fault injection**
- Offline/local submit never claims server approval
- Manual sync + diagnostics export when Background Sync is unsupported

## Out of scope

Sales POS, payments, fiscalisation, accounting, and cloud licensing are not part of this frontend.
