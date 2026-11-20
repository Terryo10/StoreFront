# Till: offline-first retail POS for Zimbabwe

The till app for a shop. Staff sell, take US$ and ZiG payments, open and close shifts, process
returns and do stock counts. Everything is saved on the device first and synced to a self-hosted
Laravel server when it can be reached. This repo is the frontend only. The back office, product
and user management, accounting and fiscalisation live elsewhere.

## Run it

```bash
npm install
npm run dev            # browser at http://127.0.0.1:5173
npm run electron:dev   # same app inside the Electron desktop shell
```

The first launch runs in **mock mode**. A local mock server, 1,000 demo products and some
demo stock counts are created on the device, so no backend is needed.

| Sign in as | Password | Role | Supervisor PIN |
|---|---|---|---|
| `cashier@demo.local` | `demo` | Cashier | none |
| `supervisor@demo.local` | `demo` | Supervisor | 1234 |
| `manager@demo.local` | `demo` | Manager | 4321 |
| `counter@demo.local` | `demo` | Stock counter | none |

To try a sale: sign in as the cashier, press Enter to open the shift, type `6009000000001`
and press Enter, then press **F10** to pay, type `20` and press Enter. Other barcodes follow
the pattern `6009` plus a 9-digit product number, for example `6009000000002` for product 2.
Prefix a barcode with a quantity to ring several at once, for example `3*6009000000002`.

## Pointing it at the Laravel server

Copy `.env.example` to `.env` to change the first-run defaults:

```bash
VITE_API_MODE=live                        # mock | live
VITE_API_BASE_URL=http://192.168.1.10:8000
VITE_DEFAULT_ZWG_RATE=26.80
```

After the first run, the server address and mode are saved on the device. Change them from
**Server connection** on the sign-in screen or from **Settings**. The till only ever talks to
that address; it does not depend on any public cloud service.

Every endpoint is an assumption until the server exists. See
[docs/API_ASSUMPTIONS.md](docs/API_ASSUMPTIONS.md) for the proposed payloads and
[BACKEND_GAPS.md](BACKEND_GAPS.md) for what the server still has to build. Settings lists each
integration as *mocked*, *live (assumed contract)* or *not available*.

## What is real and what is mocked

| Area | Status |
|---|---|
| Sale screen: scanning, search, quick grid, hold and resume, void, line discounts | Implemented |
| Atomic sale commit (sale, lines, payments and outbox event in one IndexedDB transaction) | Implemented |
| Split payments: cash, card reference, mobile money reference, in US$ and ZiG | Implemented. No payment gateway; references are typed in. |
| Receipt preview, ESC/POS printing, reprint, cash drawer | Implemented. Prints over network (port 9100) or a USB/serial device in Electron. In a plain browser, or with the mock printer selected, nothing reaches hardware. |
| Shift open with float and rate, blind shift close | Implemented |
| Returns with supervisor approval | Implemented for sales stored on this till |
| Stock counting: blind counts, add or replace, unknown-barcode exceptions, corrections | Implemented |
| Outbox and sync engine: batches, backoff, 401/403/409/422 handling, diagnostics export | Implemented |
| Sign-in, supervisor approval, catalogue, push, pull, stocktakes | Mock adapter by default. A live HTTP client exists, but its contract is assumed. |
| Token storage | Electron `safeStorage` (OS-encrypted). In a plain browser it is kept in memory only. |
| Device enrolment, server receipt numbers, cross-till returns | Not available: no server design yet |
| Fiscalisation | Extension point only (`src/services/fiscal.ts`) |

The mock server can fail on purpose. Go to **Sync**, then **Mock server faults**, to make
it unreachable, return 401, 403, 409 or 422, lose responses, duplicate results or respond
slowly. Use this to watch events stay pending, get rejected or become conflicts without being lost.

## Keyboard

Press **F1** anywhere for the full list. A sale needs nothing but the keyboard and a scanner.

| Key | Sale screen | Payment dialog |
|---|---|---|
| F2 | Jump to the scan field | Cash |
| F3 | New sale (asks first) | Card |
| F4 | Hold sale | Mobile money |
| F5 | | Switch US$ and ZiG |
| F6 | Resume a held sale | |
| F7 | Change quantity of the selected line | |
| F8 | Void the selected line | Fill in the exact amount |
| F9 | Discount the selected line | |
| F10 | Pay | |
| ↑ ↓, + − | Select a line, change its quantity (when the scan field is empty) | |
| Enter | Add the scanned item | Add tender, or complete once paid |
| Esc | Close a dialog | Close a dialog |

Alt+1 to Alt+6 switch between Sale, Returns, History, Stock count, Sync and Settings (each role sees only its own screens).

## How offline works

- **One transaction per sale.** Completing a sale writes the sale, its lines, its payments and
  a `sale.completed` outbox event in a single IndexedDB transaction, and clears the saved cart.
  Either all of it is saved or none of it is.
- **The cart survives a crash.** Every change to the cart is written to IndexedDB, so a reload
  or power cut brings back the sale in progress.
- **Printing happens after saving.** A jammed or missing printer can't lose or duplicate a sale.
  The receipt can be reprinted from History.
- **Outbox events** carry an event UUID, the device UUID, a gapless device sequence (incremented
  in the same transaction), the event type, the payload, the time it happened, a status, an
  attempt count and the last error.
- **Sync** runs in the foreground: every 20 seconds while the app is open, when the window
  regains focus, when the connection returns, and when someone presses **Sync now**. It sends at
  most 100 events per request, oldest first.
  - Only events the server acknowledges by ID are marked synced.
  - Rejected and conflicting events stay visible until someone deals with them.
  - 401 and 403 responses pause automatic sync instead of retrying in a loop.
  - Network errors back off exponentially with jitter, up to 5 minutes.
- **Connectivity** is decided by contacting the server (`GET /up`), not by the browser's
  online flag.
- **Status chips** on sales, shifts and counts read *Saved locally*, *Pending sync*, *Synced*,
  *Rejected* or *Conflict*.
- **Storage.** The app asks the browser for persistent storage and watches the quota. If
  either is at risk it shows a notice.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run electron:dev` | Vite plus Electron, with live reload |
| `npm run electron:start` | Production build loaded in Electron |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Vitest unit and component tests (fake IndexedDB) |
| `npm run test:e2e` | Playwright browser tests (run `npx playwright install chromium` once) |

Tests that map to the acceptance criteria:

- `src/services/catalogue.test.ts`: 1,000 products and instant barcode lookup.
- `src/services/sync-engine.test.ts`: 100 offline sales delivered once, lost responses, duplicate results, 401, 403, 409, 422, backoff, and recovery after a crash.
- `src/features/sale/sale-service.test.ts`: atomic commit, rollback, receipt numbering, crash-safe cart, hold and resume.
- `src/services/printer.test.ts`: a printer failure neither loses nor duplicates the sale.
- `src/features/counting/*.test.*`: blind counts hidden from counters, including in aria attributes; exceptions; corrections; honest offline submit.
- `e2e/till.spec.ts`: a full sale with only the keyboard, recovery after a reload, a held sale, and a blind count in a real browser.

## Desktop shell

`electron/main.cjs` and `electron/preload.cjs` run with `contextIsolation`, `sandbox` and no
`nodeIntegration`. The page reaches the operating system only through a small bridge
(`window.posBridge`) with three jobs:

- encrypted token storage;
- raw ESC/POS output, limited to printer devices and ports 9100 to 9109;
- app info.

Every IPC call checks that it came from the app's own page.

## Layout

```
electron/        main process and preload bridge
src/app          boot, routing, till layout, shortcuts, global notices
src/features     sale, payments, shift, returns, history, counting, sync, settings, auth
src/services     outbox, sync engine, catalogue, printer and ESC/POS, scanner, fiscal hook
src/api          typed HTTP client, Zod contracts, mock server
src/db           Dexie schema, types, demo seed
src/lib          decimal money, currency, ids, permissions, validation
docs/            API assumptions
```
