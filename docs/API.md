# API contract (frontend assumptions)

This frontend targets a self-hosted Laravel + PostgreSQL API. The Laravel source is **not** verified in this repository; treat the following as the working contract derived from the product brief and scaffold expectations.

Base path: `/api/v1`

## Products

| Method | Path | Status |
|--------|------|--------|
| GET | `/products` | Expected on scaffold |
| GET | `/products/lookup?barcode=` | Expected on scaffold |
| POST | `/products/import` | **Not implemented** — UI uses local CSV mock |

## Stocktakes

| Method | Path | Status |
|--------|------|--------|
| GET | `/stocktakes` | Expected |
| POST | `/stocktakes` | Expected |
| GET | `/stocktakes/:id` | Expected |
| POST | `/stocktakes/:id/start` | Expected |
| GET/POST | `/stocktakes/:id/counts` | Expected |
| POST | `/stocktakes/:id/submit` | Expected |
| GET | `/stocktakes/:id/variances` | Expected |
| POST | `/stocktakes/:id/approve` | Expected |
| POST | `/stocktakes/:id/post` | Expected |

## Sync

### POST `/sync/push`

```json
{
  "events": [
    {
      "event_id": "UUID",
      "device_id": "UUID",
      "device_sequence": 1,
      "event_type": "stocktake.count.recorded",
      "payload": {
        "stocktake_id": "UUID",
        "product_id": "UUID",
        "quantity": "5.000000",
        "mode": "replace",
        "observed_at": "ISO-8601"
      }
    }
  ]
}
```

Response:

```json
{
  "results": [
    {
      "event_id": "UUID",
      "status": "acknowledged",
      "error": { "code": "string", "message": "string" },
      "result": { "duplicate": false }
    }
  ]
}
```

### GET `/sync/pull`

**Placeholder / not working.** The UI must show “server pull not available” and must not present a stale catalogue as authoritative.

## Auth

Sanctum token auth is planned. Until implemented, the frontend uses mock login (`VITE_API_MODE=mock`) and a production adapter stub for token injection.

## Quantity encoding

All quantities are **decimal strings** (scale 6) to avoid floating-point drift.
