import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import type { CatalogClient } from '../clients/catalog-client.js';
import type { CartRepository } from '../repositories/cart-repository.js';
import type { Cart } from '../types/cart.js';

export interface CartRoutesOptions {
  repository: CartRepository;
  catalogClient: CatalogClient;
}

const cartItemSchema = {
  type: 'object',
  required: ['itemId', 'productId', 'quantity', 'unitPrice', 'currency'],
  properties: {
    itemId: { type: 'string' },
    productId: { type: 'string' },
    quantity: { type: 'integer' },
    unitPrice: { type: 'number' },
    currency: { type: 'string' },
  },
} as const;

const cartSchema = {
  type: 'object',
  required: ['cartId', 'sessionId', 'items', 'subtotal', 'currency'],
  properties: {
    cartId: { type: 'string' },
    sessionId: { type: 'string' },
    items: { type: 'array', items: cartItemSchema },
    subtotal: { type: 'number' },
    currency: { type: 'string' },
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

const createCartBodySchema = {
  type: 'object',
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
} as const;

const cartParamsSchema = {
  type: 'object',
  required: ['cartId'],
  properties: {
    cartId: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

const cartItemParamsSchema = {
  type: 'object',
  required: ['cartId', 'itemId'],
  properties: {
    cartId: { type: 'string', minLength: 1 },
    itemId: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

const addCartItemBodySchema = {
  type: 'object',
  required: ['productId', 'quantity'],
  properties: {
    productId: { type: 'string', minLength: 1, maxLength: 128 },
    quantity: { type: 'integer', minimum: 1, maximum: 99 },
  },
  additionalProperties: false,
} as const;

const updateCartItemBodySchema = {
  type: 'object',
  required: ['quantity'],
  properties: {
    quantity: { type: 'integer', minimum: 1, maximum: 99 },
  },
  additionalProperties: false,
} as const;

const standardResponses = {
  400: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;

export async function cartRoutes(
  app: FastifyInstance,
  options: CartRoutesOptions,
): Promise<void> {
  const { repository, catalogClient } = options;

  app.post<{ Body: { sessionId: string } }>(
    '/v1/carts',
    {
      schema: {
        body: createCartBodySchema,
        response: {
          201: cartSchema,
          400: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const cart = await repository.create(request.body.sessionId);
      return reply.status(201).send(cart);
    },
  );

  app.get<{ Params: { cartId: string } }>(
    '/v1/carts/:cartId',
    {
      schema: {
        params: cartParamsSchema,
        response: {
          200: cartSchema,
          404: errorSchema,
        },
      },
    },
    async (request): Promise<Cart> => {
      const cart = await repository.findById(request.params.cartId);
      if (cart === null) {
        throw new ApiError(
          404,
          'CART_NOT_FOUND',
          `Cart ${request.params.cartId} not found`,
        );
      }
      return cart;
    },
  );

  app.post<{
    Params: { cartId: string };
    Body: { productId: string; quantity: number };
  }>(
    '/v1/carts/:cartId/items',
    {
      schema: {
        params: cartParamsSchema,
        body: addCartItemBodySchema,
        response: {
          201: cartSchema,
          ...standardResponses,
        },
      },
    },
    async (request, reply) => {
      const { cartId } = request.params;
      const { productId, quantity } = request.body;

      const cart = await repository.findById(cartId);
      if (cart === null) {
        throw new ApiError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);
      }

      const product = await catalogClient.getProduct(productId);
      if (product === null) {
        throw new ApiError(
          404,
          'PRODUCT_NOT_FOUND',
          `Product ${productId} not found`,
        );
      }

      const updated = await repository.addItem(cartId, {
        productId: product.id,
        unitPrice: product.price,
        currency: product.currency,
        quantity,
      });

      return reply.status(201).send(updated);
    },
  );

  app.patch<{
    Params: { cartId: string; itemId: string };
    Body: { quantity: number };
  }>(
    '/v1/carts/:cartId/items/:itemId',
    {
      schema: {
        params: cartItemParamsSchema,
        body: updateCartItemBodySchema,
        response: {
          200: cartSchema,
          ...standardResponses,
        },
      },
    },
    async (request): Promise<Cart> => {
      return repository.updateItem(
        request.params.cartId,
        request.params.itemId,
        request.body.quantity,
      );
    },
  );

  app.delete<{ Params: { cartId: string; itemId: string } }>(
    '/v1/carts/:cartId/items/:itemId',
    {
      schema: {
        params: cartItemParamsSchema,
        response: {
          204: { type: 'null' },
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      await repository.removeItem(request.params.cartId, request.params.itemId);
      return reply.status(204).send();
    },
  );
}
