import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { ApiError } from './errors.js';
import type { InventoryRepository } from './repositories/inventory-repository.js';
import { healthRoutes } from './routes/health.js';
import { inventoryRoutes } from './routes/inventory.js';

export interface BuildAppOptions {
  repository: InventoryRepository;
  logger?: FastifyServerOptions['logger'];
}

interface ValidationErrorLike {
  validation?: Array<{
    instancePath?: string;
    params?: Record<string, unknown>;
    message?: string;
  }>;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
    genReqId: (request) => {
      const header = request.headers['x-correlation-id'];
      const headerValue = Array.isArray(header) ? header[0] : header;
      return headerValue !== undefined && headerValue.trim() !== ''
        ? headerValue
        : randomUUID();
    },
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    request.correlationId = request.id;
    reply.header('X-Correlation-Id', request.correlationId);
  });

  // Only JSON bodies are supported. Confirm/release have no request body;
  // clients that send `Content-Type: application/json` with an empty body
  // should not get a parsing error, so treat an empty JSON body as "no body".
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      if (raw === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch {
        const parseError = Object.assign(
          new Error('Request body is not valid JSON'),
          { statusCode: 400, code: 'INVALID_JSON_BODY' },
        );
        done(parseError, undefined);
      }
    },
  );

  app.setErrorHandler((error, request, reply) => {
    const correlationId = request.correlationId;

    if (error instanceof ApiError) {
      request.log.warn(
        { code: error.code, statusCode: error.statusCode, correlationId },
        error.message,
      );
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          correlationId,
        },
      });
    }

    const validation = (error as ValidationErrorLike).validation;
    if (validation !== undefined) {
      const fields = validation.map((item) => ({
        field: item.instancePath === '' ? '(root)' : item.instancePath,
        issue: item.message ?? 'invalid value',
        params: item.params ?? {},
      }));

      request.log.warn({ correlationId, fields }, 'request validation failed');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { fields },
          correlationId,
        },
      });
    }

    // Preserve Fastify's client-error status codes (for example an unsupported
    // media type) instead of turning them into misleading 500 responses.
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode >= 400 && statusCode < 500) {
      const code =
        statusCode === 415
          ? 'UNSUPPORTED_MEDIA_TYPE'
          : typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'REQUEST_ERROR';
      const message =
        error instanceof Error ? error.message : 'Request failed';
      request.log.warn({ code, statusCode, correlationId }, message);
      return reply.status(statusCode).send({
        error: {
          code,
          message,
          correlationId,
        },
      });
    }

    request.log.error({ err: error, correlationId }, 'unhandled error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        correlationId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
        correlationId: request.correlationId ?? request.id,
      },
    });
  });

  app.register(healthRoutes);
  app.register(inventoryRoutes, {
    repository: options.repository,
  });

  return app;
}
