import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import type { Clock } from '../src/clock.js';
import { PgInventoryRepository } from '../src/repositories/pg-inventory-repository.js';

const { Pool } = pg;
const connectionString = process.env.INVENTORY_DATABASE_URL ?? '';
const describePg = connectionString === '' ? describe.skip : describe;

class FakeClock implements Clock {
  private current = new Date('2026-11-17T00:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

describePg('inventory persistence and concurrency', () => {
  const pool = new Pool({ connectionString });
  let repository: PgInventoryRepository;
  let clock: FakeClock;

  beforeEach(async () => {
    clock = new FakeClock();
    repository = new PgInventoryRepository(pool, clock);
    await pool.query(
      'TRUNCATE idempotency_keys, reservation_items, reservations, stock_items CASCADE',
    );
    await pool.query(
      `INSERT INTO stock_items (product_id, on_hand)
       VALUES ('prod_001', 10), ('prod_002', 5), ('prod_003', 1)`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('holds and confirms stock through SQL transactions', async () => {
    const held = await repository.createReservation(
      { items: [{ productId: 'prod_001', quantity: 3 }], ttlSeconds: 60 },
      'pg-confirm-key',
    );
    expect(held.reservation.status).toBe('held');
    expect(await repository.getStock('prod_001')).toMatchObject({
      onHand: 10,
      reserved: 3,
      available: 7,
    });

    const confirmed = await repository.confirmReservation(
      held.reservation.reservationId,
      'pg-confirm-key',
    );
    expect(confirmed.reservation.status).toBe('confirmed');
    expect(await repository.getStock('prod_001')).toMatchObject({
      onHand: 7,
      reserved: 0,
      available: 7,
    });
  });

  it('allows only one of ten concurrent reservations for the last unit', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        repository.createReservation(
          { items: [{ productId: 'prod_003', quantity: 1 }], ttlSeconds: 60 },
          `last-unit-${index}`,
        ),
      ),
    );

    const fulfilled = results.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const result of rejected) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(ApiError);
        expect((result.reason as ApiError).code).toBe('INSUFFICIENT_STOCK');
      }
    }

    expect(await repository.getStock('prod_003')).toMatchObject({
      onHand: 1,
      reserved: 1,
      available: 0,
    });
  });

  it('deduplicates concurrent requests that share an idempotency key', async () => {
    const [first, second] = await Promise.all([
      repository.createReservation(
        { items: [{ productId: 'prod_003', quantity: 1 }], ttlSeconds: 60 },
        'same-concurrent-key',
      ),
      repository.createReservation(
        { items: [{ productId: 'prod_003', quantity: 1 }], ttlSeconds: 60 },
        'same-concurrent-key',
      ),
    ]);

    expect(first.reservation.reservationId).toBe(
      second.reservation.reservationId,
    );
    expect([first.replayed, second.replayed].filter(Boolean)).toHaveLength(1);
    expect(await repository.getStock('prod_003')).toMatchObject({
      onHand: 1,
      reserved: 1,
      available: 0,
    });
  });

  it('releases expired holds', async () => {
    await repository.createReservation(
      { items: [{ productId: 'prod_003', quantity: 1 }], ttlSeconds: 30 },
      'expiring-key',
    );
    clock.advance(31_000);

    await expect(repository.expireReservations()).resolves.toBe(1);
    expect(await repository.getStock('prod_003')).toMatchObject({
      onHand: 1,
      reserved: 0,
      available: 1,
    });
  });
});
