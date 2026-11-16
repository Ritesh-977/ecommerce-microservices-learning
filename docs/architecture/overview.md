# Architecture Overview

## Purpose

This document describes the high-level structure and working conventions for the **Event-Driven E-Commerce Platform with Microservices** learning project. It will evolve as services and decisions are added (see `docs/adr/`).

## Repository layout (monorepo-style, learning-friendly)

Planned layout:

- `services/<service-name>/` — individual microservices (Node.js + TypeScript), each with its own `src/`, `test/`, config, `Dockerfile`, and dependencies
  - Examples: `catalog`, `cart`, `inventory`, `payment`, `order` (and/or `checkout` orchestration), `shipping`
- `contracts/<service-name>/openapi.yaml` — OpenAPI 3.x contracts per service (API-first)
- `contracts/events/` — event schemas/contracts (added when async messaging is introduced)
- `docs/` — documentation
  - `docs/adr/` — Architecture Decision Records
  - `docs/architecture/` — architecture and flow docs
  - `docs/standards/` — API/error/idempotency/event conventions (to be added)
  - `docs/engineering/` — practices, CI/testing notes (to be added)
- `docker-compose.yml` — local infrastructure and service orchestration (grows over time)
- `.env.example` — documented environment variables (no real secrets)

## Service boundaries & data ownership

- Each service owns its **own data and schema**.
- **No shared databases** across service boundaries.
- Services communicate via documented **APIs** (synchronous) and **events** (asynchronous, introduced later), not by reaching into other services’ storage.

## Core journey (spine)

Browse products → cart → checkout → payment → order placed → shipping/fulfillment updates.

- **Checkout/order placement:** order placed only after payment succeeds (coordinated flow) with idempotency keys; emit events after placement; explicit failure/compensation handling.
- **Inventory:** reserve at checkout/order-creation with short hold/TTL; confirm/decrement on successful placement; release on failure/expiry.
- **Initial defaults:** simulated payment, guest/session-based identity, internal simulated fulfillment state transitions via events.

## Local development (initial direction)

- Use **Docker Compose** to run shared dependencies (e.g., PostgreSQL, later a message broker) and, over time, the services themselves.
- Each service will expose health/readiness endpoints and follow shared API/error/idempotency conventions (to be defined in Task 3).
- Configuration via environment variables; keep real secrets out of git (use `.env` locally based on `.env.example`).

## Evolution notes

- Start with a clear synchronous orchestration for the core checkout path; evolve toward async/event-driven patterns where they add decoupling/reliability learning value.
- Exact frameworks/libraries, broker choice (Kafka vs RabbitMQ), and deeper security/auth are decided incrementally and recorded in ADRs.
