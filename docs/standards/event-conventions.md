# Event Conventions

These conventions define how domain events are named, structured, versioned, and consumed. Messaging infrastructure (Kafka or RabbitMQ) is introduced later; contracts and expectations are defined now for consistency.

## Event envelope

Events should use a consistent envelope (fields may be extended as needed):

```json
{
  "eventId": "uuid",
  "type": "order.placed",
  "version": 1,
  "occurredAt": "2026-11-16T12:00:00Z",
  "producer": "order-service",
  "correlationId": "request-or-trace-id",
  "payload": {}
}
```

### Field guidance

- **`eventId`**: unique identifier for the event instance (used for deduplication/tracing).
- **`type`**: stable event name (recommended format: `<domain>.<fact>` in past tense or clear fact form, e.g. `order.placed`, `fulfillment.shipped`).
- **`version`**: schema/version of the event type/payload contract.
- **`occurredAt`**: timestamp when the event occurred (ISO 8601).
- **`producer`**: emitting service/component.
- **`correlationId`**: propagated correlation/request ID from the originating flow when available.
- **`payload`**: event-specific data required by consumers (avoid leaking internal DB-only details).

## Naming and ownership

- Events represent **facts** emitted by the owning service (e.g. Order service owns `order.placed`).
- Use clear, explicit names; avoid ambiguous or command-like event types.
- Document event schemas in `contracts/events/` (and/or AsyncAPI/JSON Schema) when introduced.

## Delivery and consumer expectations

- Assume **at-least-once** delivery semantics unless a specific broker/configuration guarantees otherwise; design accordingly.
- Consumers must be **idempotent**: processing the same event more than once (same `eventId` or dedupe key) must not produce duplicate side effects.
- Prefer processing based on event facts and owned state; handle out-of-order or delayed events defensively where relevant.
- Record retry/DLQ/error-handling strategies in ADRs or service docs as they are implemented.

## Initial planned events (examples)

- `order.placed` — emitted after an order is successfully placed (post-payment) to trigger downstream fulfillment/shipping workflows.
- Fulfillment/shipping status events (e.g. `fulfillment.packed`, `fulfillment.shipped`, `fulfillment.delivered`) — emitted by the shipping/fulfillment service as internal simulated state transitions progress.

Exact schemas, broker choice, and publishing patterns (e.g. outbox) will be finalized in later tasks/ADRs.
