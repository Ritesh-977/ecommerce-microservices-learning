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

## Current status

- **Foundations:** repo/standards, engineering practices, CI baseline, API/error/idempotency/event conventions, core-flow documentation, and OpenAPI contracts for all planned services.
- **Catalog service (Phase 2):** implemented with Fastify + TypeScript + Prisma/PostgreSQL, unit/API tests (Vitest), linting, health endpoint, structured logs with correlation IDs, migrations, and seed data.

Next services: Cart → Inventory → Payment → Order/Checkout → Shipping/Fulfillment.

## Prerequisites

- Node.js 20+ (LTS) and npm
- Docker Desktop (for local PostgreSQL; a message broker comes later)
- Git

## How to run the Catalog service locally

```bash
# 1) Install workspace dependencies (also generates the Prisma client)
npm install

# 2) Start local PostgreSQL (host port 5433, avoids clashing with a local Postgres on 5432)
docker compose up -d postgres

# 3) Apply the Catalog database migration and seed sample products
cd services/catalog
cp .env.example .env        # or create .env with CATALOG_DATABASE_URL
npx prisma migrate deploy
npm run prisma:seed

# 4) Run the service (dev mode)
npm run dev
```

Then check:

- Health: `http://127.0.0.1:3001/health`
- Products: `http://127.0.0.1:3001/v1/products?limit=5`
- Product details: `http://127.0.0.1:3001/v1/products/prod_001`

### Useful commands

```bash
npm test                                    # all workspace tests (currently Catalog)
npm run lint                                # all workspace lint
npm run build                               # all workspace builds
npm run openapi:validate                    # validate contracts with Redocly
npm run catalog:test                        # Catalog tests only
```

> If your machine does not already run PostgreSQL on 5432, you can use 5432 by setting `POSTGRES_PORT=5432` in a root `.env` file (and updating `CATALOG_DATABASE_URL` accordingly).
