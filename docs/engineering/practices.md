# Engineering Practices

This document defines baseline engineering practices for the project. Practices are introduced progressively and should evolve with the system (record significant changes in ADRs).

## Workspace & tooling strategy

- **Repository style:** Monorepo-style layout with `services/<service-name>/` packages.
- **Package management:** **npm workspaces** at the root (`package.json` with `"workspaces": ["services/*"]`). Each service owns its dependencies and scripts; root scripts provide convenience/CI entry points as the project grows.
- **Language/runtime:** Node.js (LTS) + TypeScript for services.

## Standard scripts (per service, as applicable)

Each service should aim to provide:

- `lint` — static analysis (e.g. ESLint)
- `format` — formatting (e.g. Prettier) and/or format check
- `test` — unit tests
- `test:integration` — integration tests (when service has external dependencies/flows)
- `build` — compile TypeScript / produce runnable output
- `openapi:validate` (or equivalent) — validate the service’s OpenAPI contract

Root-level scripts may aggregate or orchestrate these as tooling is added.

## API-first workflow

1. Define/update `contracts/<service-name>/openapi.yaml` for the slice.
2. Validate the spec (e.g. `npx @redocly/cli lint "contracts/**/*.yaml"` once tooling is installed).
3. Implement to satisfy the contract and add tests.
4. Keep contract and behavior in sync; document significant decisions in ADRs.

## Git & collaboration conventions

- Use clear, focused commits (conventional-style messages encouraged, e.g. `chore:`, `docs:`, `feat(<service>):`, `fix(<service>):`).
- Prefer branch + PR-style changes (even when working solo, for history/review discipline).
- Do not commit secrets (`.env`, credentials, tokens). Keep `.env.example` updated.

## Testing approach (grow over time)

- **Unit tests:** fast, isolated logic/validation.
- **Integration tests:** service behavior with real dependencies (DB/broker) where valuable.
- **Contract/API tests:** ensure implementation matches OpenAPI and consumer expectations.
- Focus extra effort on critical paths: checkout/order placement, idempotency, inventory reservations/race conditions, and failure/compensation behavior.

## Reliability & operability expectations

- Use **idempotency keys** for checkout/payment/order creation and safe replay behavior.
- Propagate **correlation/request IDs** across service calls and logs.
- Emit **structured logs** for key state transitions (reserve, pay, place, ship) and actionable errors.
- Expose health/readiness endpoints per service.

## CI baseline

- CI should run on pushes/PRs: install dependencies, lint, test, build (as applicable), and validate OpenAPI contracts.
- Start minimal and expand as services and test environments are added.
