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
- **Cart service (Phase 3):** implemented with Fastify + TypeScript + node-postgres/SQL migrations, unit/API tests (Vitest), linting, health endpoint, correlation IDs, price snapshots, and transactional line-item updates.
- **Inventory service (Phase 4):** implemented with Fastify + TypeScript + node-postgres/SQL migrations, unit/API and PostgreSQL concurrency tests, stock levels, TTL reservations, idempotent reserve/confirm/release, row-level locking, and a background expiry sweeper.

Next services: Payment → Order/Checkout → Shipping/Fulfillment.

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
npm test                                    # all workspace tests (Catalog + Cart + Inventory)
npm run lint                                # all workspace lint
npm run build                               # all workspace builds
npm run openapi:validate                    # validate contracts with Redocly
npm run catalog:test                        # Catalog tests only
npm run cart:test                           # Cart tests only
npm run inventory:test                      # Inventory unit/API tests only
```

## How to run the Cart service locally

Cart calls the Catalog service for product price/currency, so start Catalog first (or use Docker Compose).

```bash
# 1) If your Postgres volume was created before cart_db was added, create it once:
docker compose exec postgres psql -U ecommerce -d postgres -c "CREATE DATABASE cart_db;"

# 2) Apply SQL migrations
cd services/cart
cp .env.example .env        # or create .env with CART_DATABASE_URL and CATALOG_BASE_URL
npm run db:migrate

# 3) Run the service (dev mode)
npm run dev
```

Then check:

- Health: `http://127.0.0.1:3002/health`
- Create a cart: `POST http://127.0.0.1:3002/v1/carts` with `{ "sessionId": "demo-session" }`
- Add an item: `POST http://127.0.0.1:3002/v1/carts/{cartId}/items` with `{ "productId": "prod_001", "quantity": 2 }`
- Get a cart: `GET http://127.0.0.1:3002/v1/carts/{cartId}`

## How to run the Inventory service locally

Inventory owns stock keyed by Catalog product IDs. It does not call Catalog at runtime, so start it independently.

```bash
# 1) If your Postgres volume was created before inventory_db was added, create it once:
docker compose exec postgres psql -U ecommerce -d postgres -c "CREATE DATABASE inventory_db;"

# 2) Apply SQL migrations and seed stock for the sample catalog products
cd services/inventory
cp .env.example .env        # or create .env with INVENTORY_DATABASE_URL
npm run db:migrate
npm run db:seed

# 3) Run the service (dev mode)
npm run dev
```

Then check:

- Health: `http://127.0.0.1:3003/health`
- Stock: `GET http://127.0.0.1:3003/v1/inventory/prod_001`
- Reserve: `POST http://127.0.0.1:3003/v1/inventory/reservations` with an `Idempotency-Key` header and `{ "items": [{ "productId": "prod_001", "quantity": 2 }], "ttlSeconds": 300 }`
- Confirm: `POST http://127.0.0.1:3003/v1/inventory/reservations/{reservationId}/confirm` with a new `Idempotency-Key`
- Release: `POST http://127.0.0.1:3003/v1/inventory/reservations/{reservationId}/release` with a new `Idempotency-Key`

Holds expire after the TTL (default 900 seconds). A background sweeper releases expired stock every 5 seconds by default; confirm/release also expire lazily. To run the PostgreSQL concurrency tests, point them at a migrated database:

```bash
INVENTORY_DATABASE_URL=postgresql://ecommerce:change_me_local_only@127.0.0.1:5433/inventory_db npm run inventory:test:pg
```

On PowerShell: `$env:INVENTORY_DATABASE_URL='...'; npm run inventory:test:pg`.

> The PostgreSQL test suite truncates the inventory tables before each test. Point it at a dedicated test database, not one containing data you want to keep.

To run all services in containers:

```bash
docker compose up -d --build
```

After the first container start, seed inventory stock once:

```bash
docker compose exec inventory npm run db:seed
```

> If your machine does not already run PostgreSQL on 5432, you can use 5432 by setting `POSTGRES_PORT=5432` in a root `.env` file (and updating `CATALOG_DATABASE_URL`/`CART_DATABASE_URL`/`INVENTORY_DATABASE_URL` accordingly).
