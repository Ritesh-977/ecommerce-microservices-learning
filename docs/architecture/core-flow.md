# Core Flow: Browse → Cart → Checkout → Payment → Order → Shipping

This document walks through the end-to-end spine of the platform and marks where idempotency, reservations, compensation, and events apply. It aligns with:

- `docs/superpowers/specs/2026-11-16-event-driven-ecommerce-microservices-design.md` (baseline design)
- `docs/standards/idempotency-and-correlation.md`
- `docs/adr/0001-record-architecture-decisions.md`, `docs/adr/0002-sync-vs-async-evolution-and-broker-placeholder.md`

> Note: Service/API names here are provisional; contracts under `contracts/` are the source of truth for request/response shapes.

## Actors and services (provisional)

- **Shopper** (guest session initially) — client calling the APIs.
- **Catalog** — product browse/details (read-only).
- **Cart** — session cart and line items (owned by Cart).
- **Inventory** — stock levels, reservations with TTL, confirm/release.
- **Payment** — simulated payment processing with controllable outcomes.
- **Order** — order lifecycle and (initially) checkout orchestration.
- **Shipping/Fulfillment** — consumes order events, simulates fulfillment status transitions.

## End-to-end flow (happy path)

1. **Browse products**
   - Client calls `GET /v1/products` and `GET /v1/products/{id}` on Catalog.
   - No writes; Catalog only reads its own data.

2. **Add items to cart**
   - Client creates/retrieves a cart (`POST /v1/carts`, `GET /v1/carts/{cartId}`).
   - Client adds/updates/removes items (`POST/PATCH/DELETE` under `/v1/carts/{cartId}/items`).
   - Cart validates product existence/price snapshot according to the chosen integration approach (recorded in an ADR) and owns cart data.
   - **Product price/stock shown here is informational**; stock is not reserved at this stage.

3. **Checkout start (reserve inventory)**
   - Client calls checkout with a cart/session identifier **and an `Idempotency-Key`** (e.g. `POST /v1/checkout` — provisional contract).
   - Orchestrator validates the cart and asks Inventory to **reserve** stock for each line:
     - Request: `POST /v1/inventory/reservations` with line items and an idempotency key.
     - Response: reservation id(s), status, **hold/TTL**.
   - **Why here:** reserving at checkout prevents oversell during the payment window while keeping browse/cart fast.
   - **Race conditions:** Inventory must atomically check-and-reserve so concurrent checkouts for the last unit cannot both succeed. If insufficient stock, return a conflict (e.g. `409 INSUFFICIENT_STOCK`).
   - **Idempotency:** replaying the same checkout request with the same key must not create duplicate reservations.

4. **Payment (simulated)**
   - Orchestrator calls Payment to process the amount for the cart/order context:
     - Request: `POST /v1/payments` with amount/currency, context, **`Idempotency-Key`**.
     - Response: payment id and status (`succeeded` / `failed` / simulated `pending`-like states), or an error.
   - **Failure handling:** if payment fails, orchestrator **releases** reservations and ends the checkout with a failure result. No order is placed.
   - **Idempotency:** replay with the same key returns the same logical outcome and does not double-charge/duplicate payment records.

5. **Order placement (only after payment succeeds)**
   - Orchestrator creates/places the order with Order service:
     - Request: `POST /v1/orders` (or an internal placement call) with line items, amounts, payment reference, **`Idempotency-Key`**.
     - Response: order id and `placed` status.
   - **Consistency rule:** order is considered **placed only after successful payment**. Replays must not create duplicate orders.
   - After persistence, Order emits an **`order.placed`** event (async introduced in Phase 7/8 of the plan; contract exists in `docs/standards/event-conventions.md`).

6. **Confirm inventory**
   - Orchestrator asks Inventory to **confirm** the reservation (decrement/commit stock):
     - `POST /v1/inventory/reservations/{reservationId}/confirm`.
   - **Partial-failure compensation:** if confirmation fails after payment+order placement, the system must follow the defined recovery/compensation path (document and test; e.g. retry/repair job or explicit event) so stock and order state are consistent and reservations are not stuck.
   - Reservations that are never confirmed **expire via TTL and are released**.

7. **Shipping/fulfillment updates (event-driven)**
   - Shipping consumes `order.placed` and creates a fulfillment record.
   - Simulated state transitions progress (e.g. `placed → packed → shipped → delivered`), persisted by Shipping and exposed via API (provisional `GET /v1/fulfillments/{orderId}`).
   - Consumers handle duplicate/replayed events idempotently (at-least-once delivery assumption).

## Failure and edge-case matrix (initial)

| Scenario | Expected behavior |
|---|---|
| Insufficient stock at checkout | Reserve fails (`409 INSUFFICIENT_STOCK`); no payment attempted; checkout ends with failure. |
| Two concurrent checkouts for last unit | Exactly one reservation succeeds under atomic check-and-reserve; other fails conflict. |
| Payment fails | Release reservation(s); checkout fails; no order placed. |
| Payment succeeds, order placement fails | Do not leave “paid with no order” silently; follow defined compensation/recovery (retry/reverse) and log with correlation id. |
| Payment succeeds + order placed, inventory confirm fails | Follow recovery/compensation policy; ensure stock/order consistency and no stuck reservation. |
| Client retries checkout/payment/order with same idempotency key | Return same logical outcome; no duplicate side effects (orders/payments/reservations/stock). |
| Same idempotency key, different payload | `409` conflict (`IDEMPOTENCY_KEY_REUSE_CONFLICT`). |
| Reservation never confirmed | Expires per TTL; stock released. |
| Duplicate `order.placed` event | Shipping consumer dedupes via `eventId`; no duplicate fulfillment record/transitions. |

## State sketches (initial)

- **Reservation:** `held` → (`confirmed` | `released` | `expired`)
- **Payment (simulated):** `succeeded` | `failed` (plus processing states if modeled)
- **Order:** `placed` → (later: `fulfilled`/`cancelled` as scope grows)
- **Fulfillment:** `placed` → `packed` → `shipped` → `delivered`

## Observability and tracing

- Propagate `X-Correlation-Id` from the client through checkout, payment, inventory, order, and shipping calls; include it in structured logs and error responses.
- Log key transitions: reservation held/confirmed/released/expired, payment succeeded/failed, order placed, fulfillment transitions, plus idempotency decisions (new/replay/conflict).
