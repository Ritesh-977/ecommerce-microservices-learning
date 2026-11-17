import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import type { ProductRepository } from '../repositories/product-repository.js';
import type { Product } from '../types/product.js';

export interface ProductRoutesOptions {
  repository: ProductRepository;
}

const productSchema = {
  type: 'object',
  required: ['id', 'name', 'description', 'price', 'currency'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    price: { type: 'number' },
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

const productListSchema = {
  type: 'object',
  required: ['items', 'total', 'limit', 'offset'],
  properties: {
    items: { type: 'array', items: productSchema },
    total: { type: 'integer' },
    limit: { type: 'integer' },
    offset: { type: 'integer' },
  },
} as const;

const listProductsQuerySchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    offset: { type: 'integer', minimum: 0, default: 0 },
  },
  additionalProperties: false,
} as const;

const productParamsSchema = {
  type: 'object',
  required: ['productId'],
  properties: {
    productId: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

export async function productRoutes(
  app: FastifyInstance,
  options: ProductRoutesOptions,
): Promise<void> {
  const { repository } = options;

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/v1/products',
    {
      schema: {
        querystring: listProductsQuerySchema,
        response: {
          200: productListSchema,
          400: errorSchema,
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;
      const page = await repository.list({ limit, offset });

      return {
        items: page.items,
        total: page.total,
        limit,
        offset,
      };
    },
  );

  app.get<{ Params: { productId: string } }>(
    '/v1/products/:productId',
    {
      schema: {
        params: productParamsSchema,
        response: {
          200: productSchema,
          404: errorSchema,
        },
      },
    },
    async (request): Promise<Product> => {
      const product = await repository.findById(request.params.productId);
      if (product === null) {
        throw new ApiError(
          404,
          'NOT_FOUND',
          `Product ${request.params.productId} not found`,
        );
      }
      return product;
    },
  );
}
