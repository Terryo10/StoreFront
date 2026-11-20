# API assumptions

**Everything in this document is assumed.** None of it has been checked against the real Laravel
server. The till reads these shapes in `src/api/types.ts` and validates every live response with Zod.
If the server returns something different, the till shows a contract error and does not write the
data locally.

Conventions:

- The base URL is configurable (Settings, or `VITE_API_BASE_URL`), for example `http://192.168.1.10:8000`. All paths below are relative to it.
- JSON in both directions. The till sends `Accept: application/json` and, once signed in, `Authorization: Bearer <sanctum token>`.
- Money and quantities are **decimal strings** such as `"7.50"` or `"0.250"`, never floats.
- Currency codes are `USD` and `ZWG` (ZiG). `USD` is the base currency. Exchange rates are "ZiG per 1 US$" and are fixed for each shift.
- Timestamps are ISO 8601 UTC strings.
- IDs created by the till are UUID v4 strings, and the server should store them as given. Server IDs may be numbers or strings; the till converts them to strings.

## Health

`GET /up` is the health route that ships with Laravel 11. The till treats **any** HTTP response as "server reachable" and uses it for the connection chip and the sync loop. Network errors or a 4-second timeout mean "unreachable". `navigator.onLine` is never trusted.

## Authentication (Sanctum personal access tokens)

### `POST /api/v1/auth/login`

```json
{ "email": "cashier@shop.local", "password": "…", "device_name": "zw-pos-till" }
```

200:

```json
{ "token": "1|abc…", "user": { "id": 12, "name": "Tendai Moyo", "email": "cashier@shop.local", "role": "cashier" } }
```

`role` is one of `cashier`, `supervisor`, `manager`, `counter`. A 422 with Laravel's usual `{ "message", "errors" }` body is shown on the sign-in form.

The desktop app stores the token with Electron `safeStorage`, encrypted by the operating system. In a plain browser it is kept in memory only.

### `POST /api/v1/auth/logout`

Revokes the current token. The till signs out locally whatever the response.

### `POST /api/v1/auth/approve`

A supervisor approves an action at the till without signing the cashier out. This covers refunds, discounts and anything else that needs a higher role.

```json
{ "email": "supervisor@shop.local", "pin": "1234", "action": "Refund of US$ 7.00 on receipt T01-0003-0012" }
```

200:

```json
{ "approved": true, "approver": { "id": 3, "name": "Rudo Chikore", "email": "supervisor@shop.local", "role": "supervisor" } }
```

or `{ "approved": false, "message": "Wrong PIN" }`. The approver's id is copied into the event payload (`approved_by`), and **the server must check it again** when the event arrives.

## Catalogue

### `GET /api/v1/products?per_page=500&page=N`

The full download used when sync pull is not available. The response is a Laravel paginator:

```json
{
  "data": [
    {
      "id": 101,
      "sku": "PRL-10",
      "name": "Pearlenta Mealie Meal 10kg",
      "category": "Groceries",
      "unit": "bag",
      "active": true,
      "updated_at": "2026-11-16T07:00:00Z",
      "barcodes": [{ "code": "6009000000001", "is_primary": true }],
      "prices": [{ "price_list_id": "retail", "currency": "USD", "price": "7.50" }]
    }
  ],
  "meta": { "current_page": 1, "last_page": 3 }
}
```

### `GET /api/v1/products/lookup?barcode=…`

This is only called when a barcode is not in the local catalogue and the server is reachable. It returns `{ "data": <product> }`, or `{ "data": null }` when nothing matches. A found product is cached locally.

### `GET /api/v1/sync/pull?checkpoint=…`

The incremental catalogue pull. If this returns 404, 405 or 501, the till shows "Prices may be out of date" and falls back to the full download.

```json
{ "checkpoint": "opaque-string", "products": [ /* product objects as above */ ], "has_more": false }
```

## Event push

### `POST /api/v1/sync/push`

The till sends at most 100 events per request, oldest first, ordered by `device_sequence`.

```json
{
  "events": [
    {
      "event_id": "5b0c…uuid",
      "device_id": "355a…uuid",
      "device_sequence": 42,
      "event_type": "sale.completed",
      "observed_at": "2026-11-16T09:14:03.120Z",
      "payload": { }
    }
  ]
}
```

200, with one result per event:

```json
{
  "results": [
    { "event_id": "5b0c…", "status": "acknowledged", "duplicate": false },
    { "event_id": "77aa…", "status": "rejected", "error": { "code": "validation", "message": "Unknown product 991" } },
    { "event_id": "88bb…", "status": "rejected", "error": { "code": "conflict", "message": "Shift already closed on server" } }
  ]
}
```

What the till requires from the server:

- **Idempotency by `event_id`.** A replayed event must be acknowledged again (optionally with `duplicate: true`) and must never be applied twice. The till retries whenever a response is lost.
- **A result for every event.** An event missing from the results stays pending and is retried. The till never treats a missing result as success.
- `error.code === "conflict"` puts the event in the conflict list for a supervisor. Any other rejection goes to the rejected list. Neither is ever deleted.
- Request-level statuses:
  - **401 or 403:** events stay pending and automatic sync pauses until someone signs in again and presses retry. The till does not retry these in a loop.
  - **409:** every event in the batch becomes a conflict.
  - **422 or 400:** every event in the batch is rejected.
  - **429, 5xx or a network error:** events stay pending and are retried with exponential backoff and jitter, capped at 5 minutes.

### Event payloads

`sale.completed`

```json
{
  "sale_id": "uuid", "receipt_number": "T01-0003-0012", "receipt_number_provisional": true,
  "shift_id": "uuid", "cashier_id": "12", "currency": "USD",
  "subtotal": "13.30", "discount_total": "0.00", "total": "13.30",
  "base_total_usd": "13.30", "receipt_currency": "USD", "rate_snapshot": "26.8000",
  "zig_total": "356.45", "zig_rounding_step": "0.05", "tendered": { "USD": "20.00" },
  "change_due": "6.70", "change_currency": "USD",
  "exchange_rates": { "ZWG": "26.80" }, "completed_at": "…", "fiscal": null,
  "lines": [{ "line_id": "uuid", "line_no": 1, "product_id": "101", "sku": "PRL-10", "qty": "1", "unit_price": "7.50", "discount": "0.00", "line_total": "7.50", "discount_approved_by": null }],
  "payments": [{ "payment_id": "uuid", "method": "cash", "currency": "USD", "amount": "20.00", "rate": "1", "base_amount": "20.00", "reference": null }],
  "voided_lines": [{ "product_id": "102", "qty": "1", "unit_price": "2.90", "voided_at": "…", "voided_by": "Tendai Moyo" }]
}
```

`method` is `cash`, `card` or `mobile_money`. Card and mobile money carry the reference the cashier typed from the terminal slip or SMS; no payment gateway is involved. `receipt_number` is provisional: the till prefix, the shift number and a per-shift sequence. The server may assign its own final number.

`sale.voided` is sent when a cart with items is cleared without a sale, for loss-prevention review.

```json
{ "shift_id": "uuid", "voided_by": "12", "reason": "Cleared by cashier with New sale", "total": "4.20", "lines": [{ "product_id": "109", "qty": "1", "unit_price": "4.20" }] }
```

`sale.refunded`

```json
{
  "refund_id": "uuid", "receipt_number": "T01-0003-0013", "receipt_number_provisional": true,
  "original_sale_id": "uuid", "original_receipt_number": "T01-0003-0012",
  "shift_id": "uuid", "cashier_id": "12", "approved_by": "3", "reason": "Damaged or faulty",
  "total": "7.00", "currency": "USD",
  "lines": [{ "line_id": "uuid", "original_line_id": "uuid", "product_id": "101", "qty": "1", "amount": "7.00" }],
  "payment": { "method": "cash", "currency": "USD", "amount": "-7.00", "rate": "1", "base_amount": "-7.00", "reference": null },
  "fiscal": null
}
```

`shift.opened`

```json
{ "shift_id": "uuid", "shift_number": 3, "till_code": "T01", "cashier_id": "12", "opened_at": "…", "opening_float": { "USD": "50.00", "ZWG": "0.00" }, "exchange_rates": { "ZWG": "26.80" } }
```

`shift.closed` (the count is blind: the cashier enters `counted_cash` before seeing `expected_cash`)

```json
{ "shift_id": "uuid", "closed_at": "…", "closed_by": "12", "receipt_count": 41, "counted_cash": { "USD": "312.00", "ZWG": "150.00" }, "expected_cash": { "USD": "313.50", "ZWG": "150.00" }, "variance": { "USD": "-1.50", "ZWG": "0.00" } }
```

`stocktake.count.recorded` (every scan; corrections are new events that point at the one they correct)

```json
{ "stocktake_id": "42", "product_id": "101", "barcode": "6009000000001", "quantity": "12", "mode": "add", "corrects_event_id": null, "observed_at": "…", "counter_id": "15" }
```

`mode` is `add` (add to my count) or `replace` (my count is now this). The server should rebuild each counter's total by replaying these events in `device_sequence` order.

`stocktake.exception.recorded` (a barcode the till could not match; the till never invents a product)

```json
{ "stocktake_id": "42", "barcode": "6001234999999", "product_id": null, "quantity": "3", "observed_at": "…", "counter_id": "15" }
```

`stocktake.submitted`

```json
{ "stocktake_id": "42", "submitted_by": "15", "submitted_at": "…", "count_event_total": 118, "exception_total": 2 }
```

The till shows the count as "submitted on this device" until the server acknowledges this event.

## Stocktakes

### `GET /api/v1/stocktakes`

Returns the counts assigned to, or open to, the signed-in user.

```json
{ "data": [{ "id": 42, "name": "Aisle 3 groceries", "location_name": "Shop floor", "blind": true, "status": "assigned", "assigned_to": 15 }] }
```

**Expected quantities must not be included for counters.** The till hides them for blind counts, but data that is never sent cannot leak.

### `POST /api/v1/stocktakes/{id}/start`

Marks the count as started on the server. If this fails the till continues offline.

## Fiscalisation

Out of scope. `src/services/fiscal.ts` provides `registerFiscalHook({ prepare, afterCommit })`. `prepare` runs before the sale transaction and may add fiscal data, which is sent as `payload.fiscal`. `afterCommit` runs once the sale is saved. Nothing is registered by default, so `fiscal` is `null`.
