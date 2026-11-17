import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { CatalogClient } from './clients/catalog-client.js';
import { ApiError } from './errors.js';
import type { CartRepository } from './repositories/cart-repository.js';
import { cartRoutes } from './routes/carts.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  repository: CartRepository;
  catalogClient: CatalogClient;
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
    // request.id is the correlation ID (supplied by the client or generated).
    request.correlationId = request.id;
    reply.header('X-Correlation-Id', request.correlationId);
  });

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
  app.register(cartRoutes, {
    repository: options.repository,
    catalogClient: options.catalogClient,
  });

  return app;
}
