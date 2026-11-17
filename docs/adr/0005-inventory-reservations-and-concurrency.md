# ADR 0005: Inventory reservations, locking, and idempotency

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Inventory must prevent overselling when multiple checkouts compete for the same
stock, hold stock only for a short time, and make reserve/confirm/release safe to
retry. It owns its data and must not read another service's database. The core
flow is synchronous today; events and a broker come later.

The service uses Fastify, TypeScript, `pg` (node-postgres), and SQL migrations,
matching the Cart service's service-autonomy decision in ADR 0004. Prisma is not
used here to avoid a second generated client in the monorepo.

## Decision

### Data model

- `stock_items(product_id, on_hand, reserved, updated_at)` is the source of
  truth. `available = on_hand - reserved`, and a database check enforces
  `0 <= reserved <= on_hand`.
- `reservations(id, status, expires_at, created_at, updated_at)` uses the states
  `held`, `confirmed`, `released`, and `expired`.
- `reservation_items(reservation_id, product_id, quantity)` stores the held
  quantities and references `stock_items`, so a reservation cannot target a
  product with no stock record.
- `idempotency_keys(key, operation, request_hash, reservation_id, created_at)`
  has a composite primary key `(key, operation)`. Operations are `reserve`,
  `confirm`, and `release`; the same key may be reused for a different
  operation. `request_hash` detects key reuse with a different payload.

### Reserve

- A reservation transaction inserts the reservation and its idempotency row
  **before** touching stock. A concurrent request with the same key blocks on
  the unique index and then replays the winner. This avoids a race where the
  duplicate checks stock first and returns `INSUFFICIENT_STOCK` instead of the
  original reservation.
- Stock rows are locked with `SELECT ... FOR UPDATE` in deterministic
  `product_id` order, checked, and then updated. Deterministic ordering avoids
  deadlocks when reservations contain multiple products.
- If any line is short, the transaction rolls back and returns
  `409 INSUFFICIENT_STOCK` with per-product `requested` and `available` values.
- A missing stock record returns `404 STOCK_NOT_FOUND`. Inventory does not ask
  Catalog whether a product exists; stock records are provisioned deliberately
  (currently by seed).
- Replaying the same key and request returns `201` with the same reservation and
  the `Idempotency-Replayed: true` header. Reusing a key with a different
  request returns `409 IDEMPOTENCY_KEY_REUSE_CONFLICT`.

### Confirm and release

- Both operations lock the reservation row first, then stock rows in sorted
  order.
- Confirm decrements both `on_hand` and `reserved`, so available stock is
  unchanged (the held units become sold). Confirm is idempotent by reservation
  state; repeating it returns `200 confirmed` without decrementing again.
- Release decrements only `reserved`, returning the hold to available stock.
  Releasing an already released or expired reservation returns `200` with no
  additional stock effect. Releasing a confirmed reservation returns
  `409 RESERVATION_ALREADY_CONFIRMED`.
- Confirming a released reservation returns `409 RESERVATION_RELEASED`;
  confirming an expired one returns `409 RESERVATION_EXPIRED`.

### Expiry

- The TTL defaults to 900 seconds (allowed range 30–3600). `expires_at` is set
  when the hold is created.
- A background sweeper runs every `INVENTORY_EXPIRY_INTERVAL_MS` (default 5000
  ms). It locks expired held reservations with `FOR UPDATE SKIP LOCKED`, releases
  their stock, and marks them `expired`. Multiple service instances can sweep
  concurrently without double-releasing.
- Confirm, release, and idempotent reserve replays also expire a held
  reservation lazily before deciding the outcome, so a delayed request cannot
  confirm a hold that should already be dead.

## Consequences

- **Positive:** Row-level locking plus the `reserved <= on_hand` check prevents
  overselling under concurrency; retries are safe; holds cannot live forever;
  the data model stays inside one service and one database.
- **Trade-offs:** Lock contention is possible on very hot products; the sweeper
  interval means availability can lag an expiry by up to the interval; the
  idempotency table currently grows without a retention policy; seed data is the
  only way to create stock until an admin/provisioning API exists.
- **Follow-ups:** Emit reservation/stock events when the broker arrives; add an
  internal stock-adjustment API; define idempotency-key retention; add metrics
  for expiry count, conflict rate, and lock waits.

## Alternatives considered

- **Optimistic concurrency (version column + retry):** workable, but retries and
  conflict handling make multi-line reservations harder to reason about than
  explicit row locks.
- **Redis holds:** excellent for short TTLs and high throughput, but introduces
  a second source of truth and durability/recovery questions before the project
  needs them.
- **Database exclusion constraints / serializable transactions:** stronger
  isolation, but more retry machinery and less obvious failure behavior for a
  learning codebase.
