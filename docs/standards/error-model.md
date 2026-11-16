# Error Model

All services should return errors in a consistent JSON shape to make client handling, debugging, and observability easier.

## Standard error response envelope

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable summary",
    "details": {},
    "correlationId": "request-or-trace-id"
  }
}
```

### Fields

- **`error.code`** (string, required): stable, machine-readable code (e.g. `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `INSUFFICIENT_STOCK`, `PAYMENT_FAILED`, `IDEMPOTENCY_KEY_REUSE_CONFLICT`).
- **`error.message`** (string, required): clear human-readable message safe to expose to clients/logs as appropriate.
- **`error.details`** (object/array, optional): structured context (field errors, conflicting IDs, retry hints metadata) without leaking secrets or sensitive internals.
- **`error.correlationId`** (string, optional but recommended): identifier to correlate the error with logs/traces across services.

## HTTP status mapping (guidance)

- `400 Bad Request` — malformed request or validation failures (`VALIDATION_ERROR`)
- `401 Unauthorized` / `403 Forbidden` — authentication/authorization failures (when applicable)
- `404 Not Found` — resource not found (`NOT_FOUND`)
- `409 Conflict` — state conflicts, duplicate/idempotency conflicts, or concurrency conflicts (`CONFLICT`, `INSUFFICIENT_STOCK`, etc.)
- `422 Unprocessable Entity` — semantically invalid request (optional alternative to 400 if used consistently)
- `429 Too Many Requests` — rate limiting (if introduced)
- `500 Internal Server Error` — unexpected server-side failure (`INTERNAL_ERROR`)
- `502/503/504` — upstream/dependency or availability issues when relevant

Services should document specific `code` values and status codes in their OpenAPI contracts.

## Validation errors

For field-level validation issues, prefer structured details, e.g.:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "fields": [
        { "field": "quantity", "issue": "must be >= 1" }
      ]
    },
    "correlationId": "..."
  }
}
```

## Security and privacy notes

- Do not include secrets, tokens, passwords, or full internal stack traces in client-facing error responses.
- Log detailed diagnostics server-side with the same `correlationId`.
