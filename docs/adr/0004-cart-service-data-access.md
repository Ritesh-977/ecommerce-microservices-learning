# ADR 0004: Cart Service Data Access and Service Isolation

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The Cart service is the second implemented service. It needs its own persistent storage, transactional updates to cart line items, and a way to read product price/currency from the Catalog service. The monorepo uses npm workspaces, and the Catalog service already generates a Prisma client into the shared root `node_modules`.

Generating a second Prisma client for a different schema would overwrite the first one in the workspace. Prisma supports custom output paths, but the generated client is CommonJS and would need extra packaging/copying steps to work inside this project's ESM services.

## Decision

1. **Data access: `pg` (node-postgres) with hand-written SQL and committed SQL migrations.** The Cart service owns `cart_db`; it never reads or writes another service's tables.
2. **Migration runner:** a small `scripts/migrate.mjs` applies sorted `migrations/*.sql` files inside a transaction and records them in `schema_migrations`. This keeps migrations explicit and easy to learn from.
3. **Repository pattern:** routes depend on a `CartRepository` interface. Production uses `PgCartRepository`; tests use `InMemoryCartRepository`.
4. **Catalog integration:** Cart calls Catalog over HTTP (`GET /v1/products/:productId`) through a `CatalogClient` interface. Tests use a fake client.
5. **Price snapshot:** product price and currency are copied into the cart line item when the item is added. Totals are computed from the snapshot, so later catalog price changes do not silently rewrite existing carts.
6. **Service isolation over shared code:** error handling, correlation IDs, and app bootstrap are intentionally duplicated for now. Each service can be built and deployed independently without a shared runtime package.

## Consequences

- **Positive:** No shared code-generation state between services; explicit SQL makes transactions and locking visible; cart service images stay small; services remain independently deployable.
- **Trade-offs:** Two data-access styles exist in the repo (Prisma in Catalog, SQL in Cart). Shared HTTP conventions are duplicated and can drift.
- **Follow-ups:** Standardize future services on one data-access approach; consider extracting a shared service kit/template once the conventions stabilize; add real-database integration tests for `PgCartRepository`; add authentication/ownership checks so a session can only access its own cart.
