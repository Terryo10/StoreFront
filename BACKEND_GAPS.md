# What the Laravel server still needs

The till was built without a running backend. Every endpoint it calls is **assumed**, and the
payloads are proposed in [docs/API_ASSUMPTIONS.md](docs/API_ASSUMPTIONS.md). In mock mode, a local
adapter (`src/api/mock.ts`) stands in for the server. In live mode the till calls the URLs below. If
an endpoint is missing, the till shows the error; it never pretends the call worked.

## Endpoints to build

| Endpoint | Used for | What the till does if it is missing |
|---|---|---|
| `GET /up` | Connection check and sync loop | Shows the server as unreachable. Sales still save locally. Laravel 11 includes this route by default. |
| `POST /api/v1/auth/login` | Sanctum sign-in that returns `{ token, user: { role } }` | Sign-in fails with the server's error. Nobody can sign in in live mode. |
| `POST /api/v1/auth/logout` | Revoke the token | Ignored. The local token is discarded anyway. |
| `POST /api/v1/auth/approve` | Supervisor email and PIN approval for refunds and discounts | The approval fails, so refunds and discounts can't be approved by someone else. A supervisor who is signed in can still act. |
| `GET /api/v1/products` (paginated) | Full catalogue download | Keeps the last catalogue and shows when it was last updated. |
| `GET /api/v1/products/lookup?barcode=` | Fallback for barcodes not in the local catalogue | Treated as not found. |
| `GET /api/v1/sync/pull?checkpoint=` | Incremental price and catalogue updates | Shows a "Prices may be out of date" notice and offers a full download. 404, 405 and 501 count as "not built yet". |
| `POST /api/v1/sync/push` | All till events | Events wait in the outbox, with retry and backoff. Nothing is marked synced. |
| `GET /api/v1/stocktakes` | Counts assigned to the signed-in user | Keeps the counts already on the device. |
| `POST /api/v1/stocktakes/{id}/start` | Mark a count as started | Ignored. Counting continues offline. |

## Rules the push endpoint must follow

1. **Idempotent by `event_id`.** The till resends events whenever a response is lost. The server must acknowledge a duplicate again and never apply it twice. A unique index on `event_id` is the simplest way to guarantee this.
2. **Return one result for every event sent.** An event missing from the results stays pending and is sent again.
3. **Reject with a reason.** Use `{ status: "rejected", error: { code, message } }`. Use `code: "conflict"` when a supervisor has to decide, for example a refund against a sale another till already refunded, or a sale on a shift the server has closed. Rejected and conflicting events are kept on the till and shown on the Sync screen. They are never deleted.
4. **Accept all event types:** `sale.completed`, `sale.voided`, `sale.refunded`, `shift.opened`, `shift.closed`, `stocktake.count.recorded`, `stocktake.exception.recorded` and `stocktake.submitted`.
5. **Order within a device by `device_sequence`.** Sequences are gapless and increase steadily per device. A gap means an event is still on its way, not that it was lost.
6. **Reply 401 or 403 only for real authentication problems.** The till pauses automatic sync on those responses until someone signs in again.

## Rules the server must enforce, not the till

- **Authorisation.** The till hides screens and buttons by role (cashier, supervisor, manager, counter), but anyone with a token could call the API directly. Check the role on every endpoint and every event: who may refund, discount, close a shift or see expected quantities.
- **Approvals.** `approved_by` and `discount_approved_by` in event payloads are claims made by the till. Check that the approver exists, holds the right role, and actually approved the action (for example, by recording approvals from `/auth/approve`).
- **Prices and totals.** Recalculate line totals and payments from the event. Reject or flag anything that does not add up.
- **Blind counts.** Do not send `expected` quantities to the `counter` role at all.

## Features with no server design yet

- **Device enrolment.** The till creates its own device UUID and till code (shown in Settings). There is no enrolment or registration step, so the server can't tell a known till from an unknown one.
- **Final receipt numbers.** Receipt numbers are provisional: the till prefix, the shift number and a sequence, for example `T01-0003-0012`. If the business needs a single numbering sequence across all tills, the server must assign the final numbers and the till needs a way to receive them.
- **Returns from another till.** Returns search only the sales stored on this device. Refunding a receipt from another till needs a server receipt lookup endpoint.
- **Offline supervisor approval.** Approval needs the server. While offline, only a supervisor or manager who is signed in can approve. A signed offline approval (for example, a PIN hash pushed to the device) has not been designed.
- **Resolving conflicts.** The till can re-send a conflicting event with the same ID, or keep it for review. The real resolution (override, cancel, merge) belongs in the back office.
- **Exchange rates.** The ZiG rate is entered by hand for each shift. A server endpoint for the daily rate would let the till suggest it.
- **Fiscalisation.** Out of scope. `src/services/fiscal.ts` is the extension point, and `payload.fiscal` carries its output.
