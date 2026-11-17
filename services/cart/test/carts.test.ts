import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type {
  CatalogClient,
  CatalogProduct,
} from '../src/clients/catalog-client.js';
import { InMemoryCartRepository } from '../src/repositories/in-memory-cart-repository.js';
import type { Cart } from '../src/types/cart.js';

const products: CatalogProduct[] = [
  {
    id: 'prod_001',
    name: 'Wireless Headphones',
    price: 129.99,
    currency: 'USD',
  },
  {
    id: 'prod_002',
    name: 'Mechanical Keyboard',
    price: 89.5,
    currency: 'USD',
  },
  {
    id: 'prod_eur',
    name: 'Euro-only Item',
    price: 10,
    currency: 'EUR',
  },
];

class FakeCatalogClient implements CatalogClient {
  private readonly products = new Map(
    products.map((product) => [product.id, product]),
  );

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    return this.products.get(productId) ?? null;
  }
}

describe('cart API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({
      repository: new InMemoryCartRepository(),
      catalogClient: new FakeCatalogClient(),
      logger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createCart(sessionId = 'session-123'): Promise<Cart> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/carts',
      payload: { sessionId },
    });

    expect(response.statusCode).toBe(201);
    return response.json() as Cart;
  }

  it('creates an empty cart for a guest session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/carts',
      payload: { sessionId: 'session-abc' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      sessionId: 'session-abc',
      items: [],
      subtotal: 0,
      currency: 'USD',
    });
    expect(response.json().cartId).toEqual(expect.any(String));
  });

  it('adds an item and computes the subtotal from the catalog price', async () => {
    const cart = await createCart();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 2 },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as Cart;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId: 'prod_001',
      quantity: 2,
      unitPrice: 129.99,
      currency: 'USD',
    });
    expect(body.subtotal).toBe(259.98);
  });

  it('increments the quantity when the same product is added again', async () => {
    const cart = await createCart();

    await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 2 },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 1 },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as Cart;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.quantity).toBe(3);
    expect(body.subtotal).toBe(389.97);
  });

  it('rejects an unknown product', async () => {
    const cart = await createCart();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_missing', quantity: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects adding an item to an unknown cart', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/carts/cart_missing/items',
      payload: { productId: 'prod_001', quantity: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CART_NOT_FOUND');
  });

  it('returns a cart by id', async () => {
    const cart = await createCart();
    await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_002', quantity: 1 },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/carts/${cart.cartId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Cart;
    expect(body.cartId).toBe(cart.cartId);
    expect(body.items[0]?.productId).toBe('prod_002');
    expect(body.subtotal).toBe(89.5);
  });

  it('returns 404 for an unknown cart', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/carts/cart_missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CART_NOT_FOUND');
  });

  it('updates a line item quantity', async () => {
    const cart = await createCart();
    const added = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 1 },
    });
    const itemId = (added.json() as Cart).items[0]?.itemId;

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/carts/${cart.cartId}/items/${itemId}`,
      payload: { quantity: 4 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Cart;
    expect(body.items[0]?.quantity).toBe(4);
    expect(body.subtotal).toBe(519.96);
  });

  it('returns 404 when updating an unknown line item', async () => {
    const cart = await createCart();

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/carts/${cart.cartId}/items/item_missing`,
      payload: { quantity: 2 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CART_ITEM_NOT_FOUND');
  });

  it('removes a line item', async () => {
    const cart = await createCart();
    const added = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_002', quantity: 1 },
    });
    const itemId = (added.json() as Cart).items[0]?.itemId;

    const removeResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/carts/${cart.cartId}/items/${itemId}`,
    });
    expect(removeResponse.statusCode).toBe(204);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/carts/${cart.cartId}`,
    });
    const body = getResponse.json() as Cart;
    expect(body.items).toEqual([]);
    expect(body.subtotal).toBe(0);
  });

  it('returns 404 when removing an unknown line item', async () => {
    const cart = await createCart();

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/carts/${cart.cartId}/items/item_missing`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CART_ITEM_NOT_FOUND');
  });

  it('rejects mixed currencies in one cart', async () => {
    const cart = await createCart();

    await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 1 },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_eur', quantity: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CURRENCY_MISMATCH');
  });

  it('rejects quantities that exceed the per-item limit', async () => {
    const cart = await createCart();

    await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 90 },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 20 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CART_ITEM_LIMIT_EXCEEDED');
  });

  it('validates request bodies', async () => {
    const cart = await createCart();

    const zeroQuantity = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 0 },
    });
    expect(zeroQuantity.statusCode).toBe(400);
    expect(zeroQuantity.json().error.code).toBe('VALIDATION_ERROR');

    const tooMany = await app.inject({
      method: 'POST',
      url: `/v1/carts/${cart.cartId}/items`,
      payload: { productId: 'prod_001', quantity: 100 },
    });
    expect(tooMany.statusCode).toBe(400);

    const unknownField = await app.inject({
      method: 'POST',
      url: '/v1/carts',
      payload: { sessionId: 'session-abc', unexpected: true },
    });
    expect(unknownField.statusCode).toBe(400);
  });

  it('propagates the correlation ID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/carts/cart_missing',
      headers: { 'x-correlation-id': 'corr-cart-123' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['x-correlation-id']).toBe('corr-cart-123');
    expect(response.json().error.correlationId).toBe('corr-cart-123');
  });

  it('returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'cart' });
  });

  it('returns a standard 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/unknown' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
