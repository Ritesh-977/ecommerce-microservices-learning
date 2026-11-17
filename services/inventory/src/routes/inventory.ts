import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import type { InventoryRepository } from '../repositories/inventory-repository.js';
import type {
  CreateReservationInput,
  ReservationLine,
} from '../types/inventory.js';

export interface InventoryRoutesOptions {
  repository: InventoryRepository;
}

const reservationLineSchema = {
  type: 'object',
  required: ['productId', 'quantity'],
  properties: {
    productId: { type: 'string', minLength: 1, maxLength: 128 },
    quantity: { type: 'integer', minimum: 1, maximum: 1000 },
  },
  additionalProperties: false,
} as const;

const reservationSchema = {
  type: 'object',
  required: ['reservationId', 'status', 'items', 'expiresAt', 'createdAt'],
  properties: {
    reservationId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['held', 'confirmed', 'released', 'expired'],
    },
    items: { type: 'array', items: reservationLineSchema },
    expiresAt: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

const stockSchema = {
  type: 'object',
  required: ['productId', 'onHand', 'reserved', 'available'],
  properties: {
    productId: { type: 'string' },
    onHand: { type: 'integer', minimum: 0 },
    reserved: { type: 'integer', minimum: 0 },
    available: { type: 'integer', minimum: 0 },
  },
} as const;

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
        correlationId: { type: 'string' },
      },
    },
  },
} as const;

const createReservationBodySchema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: reservationLineSchema,
    },
    ttlSeconds: { type: 'integer', minimum: 30, maximum: 3600 },
  },
  additionalProperties: false,
} as const;

const idempotencyHeadersSchema = {
  type: 'object',
  required: ['idempotency-key'],
  properties: {
    'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

const reservationParamsSchema = {
  type: 'object',
  required: ['reservationId'],
  properties: {
    reservationId: { type: 'string', minLength: 1, maxLength: 128 },
  },
  additionalProperties: false,
} as const;

const productParamsSchema = {
  type: 'object',
  required: ['productId'],
  properties: {
    productId: { type: 'string', minLength: 1, maxLength: 128 },
  },
  additionalProperties: false,
} as const;

const standardResponses = {
  400: errorSchema,
  404: errorSchema,
  409: errorSchema,
  500: errorSchema,
} as const;

const mutationResponses = {
  ...standardResponses,
  415: errorSchema,
} as const;

interface CreateReservationBody {
  items: ReservationLine[];
  ttlSeconds?: number;
}

interface ReservationParams {
  reservationId: string;
}

interface ProductParams {
  productId: string;
}

interface IdempotencyHeaders {
  'idempotency-key': string;
}

export async function inventoryRoutes(
  app: FastifyInstance,
  options: InventoryRoutesOptions,
): Promise<void> {
  const { repository } = options;

  app.get<{ Params: ProductParams }>(
    '/v1/inventory/:productId',
    {
      schema: {
        params: productParamsSchema,
        response: {
          200: stockSchema,
          ...standardResponses,
        },
      },
    },
    async (request) => {
      const { productId } = request.params;
      const stock = await repository.getStock(productId);
      if (stock === null) {
        throw new ApiError(
          404,
          'STOCK_NOT_FOUND',
          `No stock record for product ${productId}`,
          { productId },
        );
      }
      return stock;
    },
  );

  app.post<{ Body: CreateReservationBody; Headers: IdempotencyHeaders }>(
    '/v1/inventory/reservations',
    {
      schema: {
        headers: idempotencyHeadersSchema,
        body: createReservationBodySchema,
        response: {
          201: reservationSchema,
          ...mutationResponses,
        },
      },
    },
    async (request, reply) => {
      const input: CreateReservationInput = {
        items: request.body.items,
        ttlSeconds: request.body.ttlSeconds ?? 900,
      };
      const result = await repository.createReservation(
        input,
        getIdempotencyKey(request),
      );
      if (result.replayed) {
        reply.header('Idempotency-Replayed', 'true');
      }
      request.log.info(
        {
          reservationId: result.reservation.reservationId,
          status: result.reservation.status,
          replayed: result.replayed,
        },
        'reservation held',
      );
      return reply.status(201).send(result.reservation);
    },
  );

  app.post<{ Params: ReservationParams; Headers: IdempotencyHeaders }>(
    '/v1/inventory/reservations/:reservationId/confirm',
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: reservationParamsSchema,
        response: {
          200: reservationSchema,
          ...mutationResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await repository.confirmReservation(
        request.params.reservationId,
        getIdempotencyKey(request),
      );
      if (result.replayed) {
        reply.header('Idempotency-Replayed', 'true');
      }
      request.log.info(
        {
          reservationId: result.reservation.reservationId,
          status: result.reservation.status,
          replayed: result.replayed,
        },
        'reservation confirmed',
      );
      return reply.status(200).send(result.reservation);
    },
  );

  app.post<{ Params: ReservationParams; Headers: IdempotencyHeaders }>(
    '/v1/inventory/reservations/:reservationId/release',
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: reservationParamsSchema,
        response: {
          200: reservationSchema,
          ...mutationResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await repository.releaseReservation(
        request.params.reservationId,
        getIdempotencyKey(request),
      );
      if (result.replayed) {
        reply.header('Idempotency-Replayed', 'true');
      }
      request.log.info(
        {
          reservationId: result.reservation.reservationId,
          status: result.reservation.status,
          replayed: result.replayed,
        },
        'reservation released',
      );
      return reply.status(200).send(result.reservation);
    },
  );
}

function getIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  throw new ApiError(
    400,
    'VALIDATION_ERROR',
    'Idempotency-Key header is required',
  );
}
