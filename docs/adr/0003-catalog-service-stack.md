# ADR 0003: Catalog Service Stack and Structure

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The Catalog service is the first implemented service. We need a stack and internal structure that are common in industry, support API-first development, are testable without external dependencies, and are simple enough to learn from.

## Decision

1. **HTTP framework: Fastify** — fast, TypeScript-friendly, built-in schema-based validation (Ajv) and structured logging (Pino). Useful for learning request validation, error handling, and observability.
2. **ORM/database access: Prisma + PostgreSQL** — typed data access and committed SQL migrations. The service owns its own database (`catalog_db`); no shared database with other services.
3. **Repository pattern** — routes depend on a `ProductRepository` interface. Production uses `PrismaProductRepository`; tests use `InMemoryProductRepository`, so unit tests run quickly without a database.
4. **Testing: Vitest** — unit/API tests via `app.inject()` (no network port needed). Integration verification is done manually against the Compose database for now; dedicated integration tests will be added as the system grows.
5. **Linting: ESLint (flat config) + typescript-eslint.**
6. **Local database port: 5433** — the Compose Postgres host port is 5433 by default to avoid clashing with a locally installed PostgreSQL on 5432. Containers still connect internally on 5432.
7. **API/error/correlation conventions** — implemented per `docs/standards/`: `/v1` paths, standard error envelope, `X-Correlation-Id` propagation (also used as the request ID for logs), `/health`.

## Consequences

- **Positive:** Fast, schema-validated APIs; clear separation between HTTP, business/repository, and data access; fast unit tests; committed migrations; good foundation for later services to follow.
- **Trade-offs:** Prisma adds a generation step and a CLI dependency in the runtime image (needed to apply migrations at startup). The repository abstraction adds a small amount of code but keeps tests simple.
- **Follow-ups:** Add dedicated integration tests (real DB) in CI, consider OpenAPI-generated types/contract tests, and extract shared conventions (error envelope/correlation) into a reusable package when a second service needs them.
