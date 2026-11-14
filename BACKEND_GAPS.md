# Backend gaps (frontend assumptions)

The Laravel + PostgreSQL API was **not present / not verified** in this workspace. The frontend runs fully in **mock mode** against IndexedDB, and can point at a LAN host in **live mode** without pretending missing features work.

## Missing or incomplete on server (do not silently fake success)

| Capability | Frontend behaviour |
|------------|--------------------|
| `GET /api/v1/sync/pull` | Prominent “server pull not available” banner; catalogue marked potentially stale |
| Authentication (Sanctum) | Mock login only; live login throws until endpoint verified |
| Device enrollment | Sync monitor shows “pending devices: not available” |
| Role enforcement | UI hides privileged screens; always notes backend auth is mandatory |
| Zone / counter assignments | Create wizard disables assignment controls with explanation |
| CSV product import | Local CSV import into IndexedDB (`source: csv-local`); server import button disabled |
| Safe multi-counter conflict policy | Mock fault injection can simulate 409; events kept as `conflict` for manager review |
| Authoritative approve/post | Local status transitions only; `serverState` stays `local-only` / `mock-accepted` until real responses |

## Partially expected routes

These are called by the typed live client when `VITE_API_MODE=live`:

- `GET /api/v1/products`, `GET /api/v1/products/lookup?barcode=`
- `GET/POST /api/v1/stocktakes`, `GET /api/v1/stocktakes/:id`
- `POST .../start`, `.../counts`, `.../submit`, `.../variances`, `.../approve`, `.../post`
- `POST /api/v1/sync/push` (provisional event envelope documented in `docs/API.md`)

## Sync contract notes

Push accepts count events with `event_id`, `device_id`, `device_sequence`, and payload quantity as a **decimal string**. The frontend:

- Never marks an event synced unless that exact `event_id` returns `acknowledged`
- Never drops `rejected` / conflict events
- Does not retry 401/403 indefinitely
- Requires manual/foreground sync (Background Sync not assumed)

## Quantity & ID rules

- Quantities: decimal strings, scale 6, arithmetic via `decimal.js`
- IDs: UUIDs; device UUID in `localStorage`; monotonic `deviceSequence` updated in the same IndexedDB transaction as the outbox append
