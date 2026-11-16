# API Conventions

These conventions apply to all HTTP APIs in this project unless a service-specific ADR states otherwise.

## Versioning and paths

- Use **URI versioning**: prefix routes with `/v1` (e.g. `/v1/products`, `/v1/carts`).
- Use **plural, noun-based resource names** (e.g. `/products`, `/orders`).
- Use **kebab-case** for multi-word path segments if needed (e.g. `/shipping-updates`), and **camelCase** for JSON field names unless otherwise agreed.

## HTTP methods and semantics

- `GET` — read/list resources (safe, idempotent)
- `POST` — create resources or trigger operations (e.g. checkout) where appropriate; use idempotency keys for critical operations
- `PUT` / `PATCH` — update resources (prefer `PATCH` for partial updates unless full replacement is intended)
- `DELETE` — remove resources when applicable

## JSON and content types

- Requests and responses use `Content-Type: application/json; charset=utf-8`.
- Use consistent field naming and explicit schemas in OpenAPI contracts.

## Pagination, filtering, and sorting (lists)

For list endpoints (e.g. products, orders):

- Support **offset/limit** pagination initially unless a service needs cursor-based pagination (document in contract/ADR):
  - `limit`: max items to return (service-defined default/max)
  - `offset`: number of items to skip
- Responses should include pagination metadata, e.g.:
  - `items`: array of resources
  - `total`: total matching items (when feasible)
  - `limit`, `offset`
- Filtering/sorting parameters must be explicitly defined in the OpenAPI spec for each endpoint.

## Health endpoints

- Each service exposes `GET /health` for basic liveness/health checks.
- Response: `200 OK` with a simple JSON body (e.g. `{ "status": "ok", "service": "<name>" }`) when healthy.
- Readiness checks (dependencies like DB/broker) may be added later (e.g. `GET /ready`) and documented per service.

## Request/response expectations

- Validate inputs and return errors using the standard error model (`docs/standards/error-model.md`).
- For operations that must be safe to retry (checkout/payment/order creation), accept and honor idempotency keys (`docs/standards/idempotency-and-correlation.md`).
- Include/propagate correlation identifiers in logs and, where applicable, responses.
