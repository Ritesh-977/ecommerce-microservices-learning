# API Contracts (OpenAPI)

This folder contains **API-first** contracts for the project’s services. Contracts are defined/updated before or alongside implementation slices and treated as primary artifacts.

## Structure

- `contracts/<service-name>/openapi.yaml` — OpenAPI 3.x specification for a service
  - Planned services: `catalog`, `cart`, `inventory`, `payment`, `order`, `shipping` (and others as needed)
- `contracts/events/` — event/message schemas and conventions (added when async messaging is introduced)

## Conventions (initial)

- **Format:** YAML, OpenAPI 3.x
- **Versioning:** include API version in paths (e.g. `/v1/...`) and reflect in spec `info.version` as appropriate
- **Consistency:** follow shared standards for naming, pagination, error responses, and idempotency (to be defined in `docs/standards/`)
- **Health:** each service should expose a health endpoint (e.g. `GET /health`) as documented in its spec

## Workflow

1. Draft or update the relevant `openapi.yaml` for the capability/slice.
2. Validate the spec (e.g. with `@redocly/cli lint` or another OpenAPI validator).
3. Implement the service to satisfy the contract and add tests (unit/integration/contract as appropriate).
4. Keep contracts in sync with behavior and record significant contract decisions in ADRs when needed.

## Validation (example)

Once tooling is installed (Task 2), validate all specs with a command like:

```bash
npx @redocly/cli lint "contracts/**/*.yaml"
```

(Exact tooling/command will be standardized in the project’s engineering practices.)
