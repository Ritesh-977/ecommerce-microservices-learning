import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Clock } from '../src/clock.js';
import { InMemoryInventoryRepository } from '../src/repositories/in-memory-inventory-repository.js';
import type { Reservation } from '../src/types/inventory.js';

class FakeClock implements Clock {
  private current = new Date('2026-11-17T00:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

const initialStock = [
  { productId: 'prod_001', onHand: 10 },
  { productId: 'prod_002', onHand: 5 },
  { productId: 'prod_003', onHand: 1 },
];

describe('inventory API', () => {
  let app: FastifyInstance;
  let clock: FakeClock;
  let repository: InMemoryInventoryRepository;

  beforeEach(async () => {
    clock = new FakeClock();
    repository = new InMemoryInventoryRepository(initialStock, clock);
    app = buildApp({ repository, logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function reserve(
    key: string,
    body: unknown,
  ): Promise<ReturnType<typeof app.inject>> {
    return app.inject({
      method: 'POST',
      url: '/v1/inventory/reservations',
      headers: { 'idempotency-key': key },
      payload: body,
    });
  }

  async function confirm(
    reservationId: string,
    key: string,
  ): Promise<ReturnType<typeof app.inject>> {
    return app.inject({
      method: 'POST',
      url: `/v1/inventory/reservations/${reservationId}/confirm`,
      headers: { 'idempotency-key': key },
    });
  }

  async function release(
    reservationId: string,
    key: string,
  ): Promise<ReturnType<typeof app.inject>> {
    return app.inject({
      method: 'POST',
      url: `/v1/inventory/reservations/${reservationId}/release`,
      headers: { 'idempotency-key': key },
    });
  }

  it('returns stock as onHand, reserved, and available', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      productId: 'prod_001',
      onHand: 10,
      reserved: 0,
      available: 10,
    });
  });

  it('returns 404 for unknown stock', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('STOCK_NOT_FOUND');
  });

  it('holds stock for a reservation', async () => {
    const response = await reserve('reserve-1', {
      items: [{ productId: 'prod_001', quantity: 3 }],
      ttlSeconds: 60,
    });

    expect(response.statusCode).toBe(201);
    const reservation = response.json() as Reservation;
    expect(reservation.status).toBe('held');
    expect(reservation.items).toEqual([
      { productId: 'prod_001', quantity: 3 },
    ]);
    expect(reservation.createdAt).toBe('2026-11-17T00:00:00.000Z');
    expect(reservation.expiresAt).toBe('2026-11-17T00:01:00.000Z');
    expect(response.headers['idempotency-replayed']).toBeUndefined();

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 10,
      reserved: 3,
      available: 7,
    });
  });

  it('uses a 900 second default TTL', async () => {
    const response = await reserve('reserve-default-ttl', {
      items: [{ productId: 'prod_002', quantity: 1 }],
    });

    expect(response.statusCode).toBe(201);
    expect((response.json() as Reservation).expiresAt).toBe(
      '2026-11-17T00:15:00.000Z',
    );
  });

  it('rejects reservations with insufficient stock and leaves stock unchanged', async () => {
    const response = await reserve('reserve-too-much', {
      items: [{ productId: 'prod_001', quantity: 11 }],
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(body.error.details.items).toEqual([
      { productId: 'prod_001', requested: 11, available: 10 },
    ]);

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });
  });

  it('rejects reservations for products without a stock record', async () => {
    const response = await reserve('reserve-missing', {
      items: [{ productId: 'prod_missing', quantity: 1 }],
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('STOCK_NOT_FOUND');
  });

  it('rejects duplicate product lines in one reservation', async () => {
    const response = await reserve('reserve-duplicate-lines', {
      items: [
        { productId: 'prod_001', quantity: 1 },
        { productId: 'prod_001', quantity: 2 },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('DUPLICATE_RESERVATION_LINE');
  });

  it('replays a reservation with the same key and payload without double-holding stock', async () => {
    const first = await reserve('reserve-replay', {
      items: [{ productId: 'prod_001', quantity: 3 }],
    });
    const second = await reserve('reserve-replay', {
      items: [{ productId: 'prod_001', quantity: 3 }],
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect((second.json() as Reservation).reservationId).toBe(
      (first.json() as Reservation).reservationId,
    );
    expect(second.headers['idempotency-replayed']).toBe('true');

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({ reserved: 3, available: 7 });
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    await reserve('reserve-conflict', {
      items: [{ productId: 'prod_001', quantity: 3 }],
    });
    const response = await reserve('reserve-conflict', {
      items: [{ productId: 'prod_001', quantity: 2 }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('IDEMPOTENCY_KEY_REUSE_CONFLICT');
  });

  it('confirms a reservation by decrementing onHand and reserved', async () => {
    const reserved = await reserve('reserve-confirm', {
      items: [{ productId: 'prod_001', quantity: 3 }],
    });
    const reservationId = (reserved.json() as Reservation).reservationId;

    const confirmed = await confirm(reservationId, 'confirm-1');
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as Reservation).status).toBe('confirmed');

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 7,
      reserved: 0,
      available: 7,
    });
  });

  it('replays confirm idempotently without double-decrementing stock', async () => {
    const reserved = await reserve('reserve-confirm-replay', {
      items: [{ productId: 'prod_001', quantity: 2 }],
    });
    const reservationId = (reserved.json() as Reservation).reservationId;

    await confirm(reservationId, 'confirm-replay');
    const replay = await confirm(reservationId, 'confirm-replay');

    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect((replay.json() as Reservation).status).toBe('confirmed');

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 8,
      reserved: 0,
      available: 8,
    });
  });

  it('releases a reservation and returns stock to available', async () => {
    const reserved = await reserve('reserve-release', {
      items: [{ productId: 'prod_001', quantity: 4 }],
    });
    const reservationId = (reserved.json() as Reservation).reservationId;

    const released = await release(reservationId, 'release-1');
    expect(released.statusCode).toBe(200);
    expect((released.json() as Reservation).status).toBe('released');

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });
  });

  it('replays release idempotently without double-releasing stock', async () => {
    const reserved = await reserve('reserve-release-replay', {
      items: [{ productId: 'prod_001', quantity: 4 }],
    });
    const reservationId = (reserved.json() as Reservation).reservationId;

    await release(reservationId, 'release-replay');
    const replay = await release(reservationId, 'release-replay');

    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });
  });

  it('refuses to release a confirmed reservation', async () => {
    const reserved = await reserve('reserve-release-confirmed', {
      items: [{ productId: 'prod_001', quantity: 1 }],
    });
    const reservationId = (reserved.json() as Reservation).reservationId;
    await confirm(reservationId, 'confirm-before-release');

    const response = await release(reservationId, 'release-after-confirm');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('RESERVATION_ALREADY_CONFIRMED');
  });

  it('refuses to confirm a released reservation', async () => {
    const reserved = await reserve('reserve-confirm-released', {
      items: [{ productId: 'prod_001', quantity: 1 }],
    });
    const reservationId = (reserved.json() as Reservation).reservationId;
    await release(reservationId, 'release-before-confirm');

    const response = await confirm(reservationId, 'confirm-after-release');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('RESERVATION_RELEASED');
  });

  it('expires held reservations and releases their stock', async () => {
    await reserve('reserve-expire', {
      items: [{ productId: 'prod_001', quantity: 4 }],
      ttlSeconds: 30,
    });
    clock.advance(31_000);

    const expiredCount = await repository.expireReservations();
    expect(expiredCount).toBe(1);

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });
  });

  it('lazily expires a reservation when confirm runs after its TTL', async () => {
    const reserved = await reserve('reserve-lazy-expire', {
      items: [{ productId: 'prod_001', quantity: 4 }],
      ttlSeconds: 30,
    });
    const reservationId = (reserved.json() as Reservation).reservationId;
    clock.advance(31_000);

    const response = await confirm(reservationId, 'confirm-after-expiry');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('RESERVATION_EXPIRED');

    const stock = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_001',
    });
    expect(stock.json()).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });
  });

  it('returns 404 for an unknown reservation', async () => {
    const confirmed = await confirm('reservation_missing', 'confirm-missing');
    expect(confirmed.statusCode).toBe(404);
    expect(confirmed.json().error.code).toBe('RESERVATION_NOT_FOUND');

    const released = await release('reservation_missing', 'release-missing');
    expect(released.statusCode).toBe(404);
    expect(released.json().error.code).toBe('RESERVATION_NOT_FOUND');
  });

  it('requires an Idempotency-Key and validates input', async () => {
    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/inventory/reservations',
      payload: { items: [{ productId: 'prod_001', quantity: 1 }] },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe('VALIDATION_ERROR');

    const shortTtl = await reserve('reserve-short-ttl', {
      items: [{ productId: 'prod_001', quantity: 1 }],
      ttlSeconds: 5,
    });
    expect(shortTtl.statusCode).toBe(400);
  });

  it('accepts an empty JSON body for confirm and release', async () => {
    const reserved = await reserve('reserve-empty-json', {
      items: [{ productId: 'prod_001', quantity: 1 }],
    });
    const reservationId = (reserved.json() as Reservation).reservationId;

    const confirmed = await app.inject({
      method: 'POST',
      url: `/v1/inventory/reservations/${reservationId}/confirm`,
      headers: {
        'idempotency-key': 'confirm-empty-json',
        'content-type': 'application/json',
      },
      payload: '',
    });

    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as Reservation).status).toBe('confirmed');
  });

  it('returns a standard 415 error for unsupported content types', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/inventory/reservations',
      headers: {
        'idempotency-key': 'reserve-unsupported-media',
        'content-type': 'text/plain',
      },
      payload: 'not json',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/inventory/reservations',
      headers: {
        'idempotency-key': 'reserve-malformed-json',
        'content-type': 'application/json',
      },
      payload: '{bad',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_JSON_BODY');
  });

  it('propagates the correlation ID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/inventory/prod_missing',
      headers: { 'x-correlation-id': 'corr-inventory-123' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['x-correlation-id']).toBe('corr-inventory-123');
    expect(response.json().error.correlationId).toBe('corr-inventory-123');
  });

  it('returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'inventory' });
  });

  it('returns a standard 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/unknown' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
