# Idempotency and Correlation

This standard defines how services handle safe retries (idempotency) and request tracing (correlation) for critical flows.

## Correlation IDs

- Each incoming request should have a **correlation/request ID**:
  - Accept from header (recommended): `X-Correlation-Id` (or generate one if missing).
  - Propagate the same ID on downstream service calls and include it in structured logs.
  - Include it in error responses (`error.correlationId`) when available.
- Use correlation IDs to trace end-to-end flows across services (checkout, payment, order placement, fulfillment).

## Idempotency keys

### Where required

Idempotency is required for operations that must be safe to retry due to timeouts/network failures, especially:

- **Checkout / order placement** operations
- **Payment** initiation/confirmation/charge simulation operations
- **Order creation/placement** APIs
- Inventory **reserve/confirm/release** operations (as defined by contracts) to prevent duplicate side effects on retries

### How clients provide keys

- Clients send an idempotency key via header: `Idempotency-Key: <unique-key>` (or an equivalent contract-defined field).
- The key should be unique per logical operation attempt (client-generated). Reusing the same key means “retry of the same operation”.

### Server behavior

- On first successful processing of a request with a new key (for the same operation scope), store the key with the operation scope/identity and the resulting outcome (or a reference to it).
- On **replay with the same key and same logical request/operation**: return the **same logical outcome** (same result/status/body as appropriate) without creating duplicate side effects (no duplicate orders, no double charge, no double stock decrement).
- On **reuse with the same key but a different request payload/operation scope**: return a **conflict error** (e.g. `409` with a clear `error.code` such as `IDEMPOTENCY_KEY_REUSE_CONFLICT`).
- Define key scope and retention/expiry policy per service/operation in contracts or ADRs (must be long enough to cover realistic retry windows).

## Application to core project rules

- **Order placement:** placed only after payment succeeds; retries must not create duplicate orders or duplicate downstream effects.
- **Inventory:** reserve/confirm/release must be idempotent and safe under retries and concurrency; holds/TTL and release-on-failure/expiry must prevent stuck reservations.
- **Payment (simulated):** retries with the same idempotency key must not create duplicate payment records/charges.

## Logging and observability

- Log idempotency decisions (new, replayed, conflict) and key state transitions with correlation IDs to support debugging of partial failures and retries.
