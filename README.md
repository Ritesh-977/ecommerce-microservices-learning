# Event-Driven E-Commerce Platform with Microservices

A senior-level, hands-on learning project to build a production-style online shopping system as microservices using **Node.js + TypeScript**.

## Learning goal

- Learn how real e-commerce systems work by building from scratch (browse → cart → checkout → payment → order placed → shipping/fulfillment updates).
- Practice **API-first** design (OpenAPI), service boundaries and data ownership, consistency/idempotency, race-condition handling (inventory), and event-driven workflows.

## Core journey (spine)

1. Browse products
2. Add items to cart
3. Checkout
4. Payment
5. Order placed
6. Shipping/fulfillment updates

## Stack (planned)

- **Runtime:** Node.js (LTS) + TypeScript
- **Contracts:** OpenAPI 3.x
- **Data:** PostgreSQL (per-service ownership, no shared DBs)
- **Local infra:** Docker & Docker Compose
- **Messaging (later):** Kafka or RabbitMQ for async/event-driven flows

## Key design decisions (baseline)

- Order is **placed only after payment succeeds** in a coordinated checkout flow, with **idempotency keys** and explicit failure/compensation handling; events emitted after placement for downstream steps.
- Inventory is **reserved at checkout/order-creation** with a short **hold/TTL**, **confirmed/decremented on successful placement**, and **released on failure or expiry**.
- Start with **simulated payment**, **guest/session-based identity**, and **internal simulated fulfillment state transitions** (events). Evolve toward async/event-driven patterns incrementally.

## Documentation

- Design spec: `docs/superpowers/specs/2026-11-16-event-driven-ecommerce-microservices-design.md` (reference copy to be added) or see the original design in your learning workspace.
- Implementation/learning plan: `docs/superpowers/plans/2026-11-16-event-driven-ecommerce-microservices-plan.md` (reference copy to be added).
- Architecture decisions: `docs/adr/`

## Getting started (to be expanded)

This repository was initialized as **Task 0 (workspace and version control)**. Next steps from the plan:
- Define repo structure and engineering standards (Task 1)
- Add tooling, CI baseline, and API-first workflow (Task 2)
- Define API/event conventions and contract outlines (Tasks 3–4)

### Prerequisites (planned)

- Node.js (LTS) and npm/pnpm
- Docker Desktop
- Git

## How to run

_TODO: will be documented as services and Docker Compose configuration are added._
