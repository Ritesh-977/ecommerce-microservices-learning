# ADR 0002: Synchronous-first Core Flow, Async Evolution, and Broker Placeholder

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The project must implement a core e-commerce journey (browse → cart → checkout → payment → order placed → shipping updates) while teaching both synchronous service coordination and event-driven microservice patterns. The design requires correctness around order placement, idempotency, and inventory race conditions, and defers some infrastructure choices until they are needed.

## Decision

1. **Start with synchronous orchestration for the core checkout path:** coordinate cart validation, inventory reservation, payment, and order placement in a clear request/response flow so consistency and failure/compensation behavior are easy to reason about and test.
2. **Place the order only after payment succeeds**, using idempotency keys and explicit compensation/release on failures (per ADR 0001 and the approved design).
3. **Introduce asynchronous, event-driven communication incrementally** where it adds learning and decoupling value—starting with publishing order-related events and consuming them for fulfillment/shipping status updates.
4. **Defer broker selection (Kafka vs RabbitMQ) until the async milestone** (Phase 7), but standardize event envelope/naming and idempotent-consumer expectations now (`docs/standards/event-conventions.md`).
5. **Acknowledge delivery realities:** when messaging is added, assume at-least-once delivery unless proven otherwise and design consumers/publishers (and consider patterns like the outbox) accordingly.

## Consequences

- **Positive:** Early milestones focus on correctness, contracts, and race-condition handling with simpler debugging; later milestones introduce messaging concepts (events, consumers, idempotency, eventual workflows) on a working spine.
- **Trade-offs:** The initial synchronous flow may create tighter runtime coupling between checkout participants; this is intentional for learning and will be revisited as async patterns are introduced.
- **Follow-ups:** Add an ADR at broker-selection time documenting the chosen broker, topic/queue naming, event schema registry/format decisions, and publishing guarantees/patterns.
