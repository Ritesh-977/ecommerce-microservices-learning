# ADR 0001: Record Architecture Decisions and Baseline Project Practices

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

This is a learning project to build an event-driven e-commerce platform with microservices (Node.js + TypeScript). We need a consistent way to capture key decisions and to start with company-style practices (API-first, documentation, and correctness-focused flows).

## Decision

1. **Use ADRs** in `docs/adr/` to record important architectural and technical decisions over time.
2. **Adopt API-first development:** define and maintain OpenAPI contracts for service APIs before or alongside implementation slices.
3. **Document foundations early:** maintain a README and architecture/overview notes as the system evolves; record trade-offs in ADRs.
4. **Follow confirmed core-flow rules from the design:**
   - An order is **placed only after payment succeeds** in a coordinated checkout flow, using **idempotency keys**; emit events after placement and handle failures with explicit release/compensation.
   - Inventory is **reserved at checkout/order-creation** with a short **hold/TTL**, **confirmed/decremented on successful placement**, and **released on failure or expiry**.
5. **Start simple, evolve incrementally:** begin with synchronous orchestration for the core path and introduce async/event-driven patterns (broker, events) as the system grows; start with simulated payment, guest/session identity, and internal simulated fulfillment transitions.

## Consequences

- **Positive:** Decisions and rationale are traceable; contracts guide implementation and testing; core consistency/race-condition concerns are explicit from the start.
- **Trade-offs:** Maintaining docs/contracts/ADRs adds upfront effort, but supports learning and reduces ambiguity as services multiply.
- **Follow-ups:** Add ADRs for service boundaries, framework/library choices, broker selection/event schemas, and auth/security depth as they are decided.
