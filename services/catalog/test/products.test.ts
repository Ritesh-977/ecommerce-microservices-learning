import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { InMemoryProductRepository } from '../src/repositories/in-memory-product-repository.js';
import type { Product } from '../src/types/product.js';

const products: Product[] = [
  {
    id: 'prod_001',
    name: 'Wireless Headphones',
    description: 'Over-ear noise-cancelling headphones',
    price: 129.99,
    currency: 'USD',
  },
  {
    id: 'prod_002',
    name: 'Mechanical Keyboard',
    description: 'Compact 75% mechanical keyboard',
    price: 89.5,
    currency: 'USD',
  },
  {
    id: 'prod_003',
    name: 'USB-C Hub',
    description: null,
    price: 39.99,
    currency: 'USD',
  },
];

describe('catalog API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({
      repository: new InMemoryProductRepository(products),
      logger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists products with pagination metadata', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products?limit=2&offset=0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.items[0]).toMatchObject({
      id: 'prod_001',
      name: 'Wireless Headphones',
      price: 129.99,
    });
  });

  it('applies default pagination values', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/products' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('returns product details by id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/prod_002',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'prod_002',
      name: 'Mechanical Keyboard',
      price: 89.5,
    });
  });

  it('returns a standard error envelope for an unknown product', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/prod_missing',
      headers: { 'x-correlation-id': 'corr-123' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        correlationId: 'corr-123',
      },
    });
  });

  it('rejects an out-of-range limit with a validation error', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products?limit=500',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.fields.length).toBeGreaterThan(0);
  });

  it('rejects unknown query parameters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products?limit=10&unexpected=true',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'catalog' });
  });

  it('returns a standard 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/unknown' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
