import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { systemClock, type Clock } from '../clock.js';
import { ApiError } from '../errors.js';
import {
  hashReservationId,
  hashReservationRequest,
  type IdempotencyOperation,
} from '../idempotency.js';
import {
  isExpired,
  sortItems,
  toReservation,
} from '../reservation.js';
import { validateReservationInput } from '../validation.js';
import type {
  CreateReservationInput,
  ReservationLine,
  ReservationResult,
  ReservationStatus,
  Stock,
  StoredReservation,
} from '../types/inventory.js';
import type { InventoryRepository } from './inventory-repository.js';

interface StockRow {
  product_id: string;
  on_hand: number;
  reserved: number;
}

interface ReservationRow {
  id: string;
  status: ReservationStatus;
  expires_at: Date;
  created_at: Date;
}

interface ReservationItemRow {
  product_id: string;
  quantity: number;
}

interface IdempotencyRow {
  request_hash: string;
  reservation_id: string;
}

export class PgInventoryRepository implements InventoryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = systemClock,
  ) {}

  async getStock(productId: string): Promise<Stock | null> {
    const result = await this.pool.query<StockRow>(
      'SELECT product_id, on_hand, reserved FROM stock_items WHERE product_id = $1',
      [productId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      productId: row.product_id,
      onHand: row.on_hand,
      reserved: row.reserved,
      available: row.on_hand - row.reserved,
    };
  }

  async createReservation(
    input: CreateReservationInput,
    idempotencyKey: string,
  ): Promise<ReservationResult> {
    validateReservationInput(input);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const requestHash = hashReservationRequest(input.items, input.ttlSeconds);
    const items = sortItems(input.items);
    const client = await this.pool.connect();
    let committed = false;

    try {
      await client.query('BEGIN');

      const existing = await this.findIdempotency(
        client,
        'reserve',
        idempotencyKey,
      );
      if (existing !== null) {
        this.requireMatchingHash(existing, requestHash, idempotencyKey);
        const reservation = await this.loadReservation(
          client,
          existing.reservation_id,
          true,
        );
        if (reservation === null) {
          throw new Error('Idempotency record points to a missing reservation');
        }
        const current = await this.expireIfNeeded(client, reservation, now);
        await client.query('COMMIT');
        committed = true;
        return {
          reservation: toReservation(current),
          replayed: true,
        };
      }

      const reservationId = randomUUID();

      // Insert the reservation and its idempotency key before touching stock.
      // A concurrent duplicate request blocks on the (key, operation) unique
      // index, then replays the winner instead of racing for stock.
      await client.query(
        `INSERT INTO reservations (id, status, expires_at, created_at, updated_at)
         VALUES ($1, 'held', $2, $3, $3)`,
        [reservationId, expiresAt, now],
      );
      await client.query(
        `INSERT INTO idempotency_keys
           (key, operation, request_hash, reservation_id, created_at)
         VALUES ($1, 'reserve', $2, $3, $4)`,
        [idempotencyKey, requestHash, reservationId, now],
      );

      const stockByProduct = new Map<string, StockRow>();
      for (const item of items) {
        const result = await client.query<StockRow>(
          `SELECT product_id, on_hand, reserved
             FROM stock_items
            WHERE product_id = $1
              FOR UPDATE`,
          [item.productId],
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new ApiError(
            404,
            'STOCK_NOT_FOUND',
            `No stock record for product ${item.productId}`,
            { productId: item.productId },
          );
        }
        stockByProduct.set(item.productId, row);
      }

      const insufficient: Array<{
        productId: string;
        requested: number;
        available: number;
      }> = [];
      for (const item of items) {
        const stock = stockByProduct.get(item.productId);
        if (stock === undefined) {
          throw new Error(`Missing locked stock row for ${item.productId}`);
        }
        const available = stock.on_hand - stock.reserved;
        if (available < item.quantity) {
          insufficient.push({
            productId: item.productId,
            requested: item.quantity,
            available,
          });
        }
      }
      if (insufficient.length > 0) {
        throw new ApiError(
          409,
          'INSUFFICIENT_STOCK',
          'Not enough stock to hold the requested quantities',
          { items: insufficient },
        );
      }

      for (const item of items) {
        await client.query(
          `UPDATE stock_items
              SET reserved = reserved + $1, updated_at = $2
            WHERE product_id = $3`,
          [item.quantity, now, item.productId],
        );
        await client.query(
          `INSERT INTO reservation_items (reservation_id, product_id, quantity)
           VALUES ($1, $2, $3)`,
          [reservationId, item.productId, item.quantity],
        );
      }

      const created = await this.loadReservation(client, reservationId, false);
      if (created === null) {
        throw new Error('Created reservation could not be read back');
      }

      await client.query('COMMIT');
      committed = true;
      return {
        reservation: toReservation(created),
        replayed: false,
      };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      if (isUniqueViolation(error)) {
        const existing = await this.findIdempotency(
          this.pool,
          'reserve',
          idempotencyKey,
        );
        if (existing !== null) {
          this.requireMatchingHash(existing, requestHash, idempotencyKey);
          const reservation = await this.loadReservation(
            this.pool,
            existing.reservation_id,
            false,
          );
          if (reservation !== null) {
            return {
              reservation: toReservation(reservation),
              replayed: true,
            };
          }
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmReservation(
    reservationId: string,
    idempotencyKey: string,
  ): Promise<ReservationResult> {
    const now = this.clock.now();
    const requestHash = hashReservationId(reservationId);
    const client = await this.pool.connect();
    let committed = false;

    try {
      await client.query('BEGIN');

      const existing = await this.findIdempotency(
        client,
        'confirm',
        idempotencyKey,
      );
      if (existing !== null) {
        this.requireMatchingHash(existing, requestHash, idempotencyKey);
        const reservation = await this.loadReservation(
          client,
          existing.reservation_id,
          true,
        );
        if (reservation === null) {
          throw new Error('Idempotency record points to a missing reservation');
        }
        const current = await this.expireIfNeeded(client, reservation, now);
        await client.query('COMMIT');
        committed = true;
        return {
          reservation: toReservation(current),
          replayed: true,
        };
      }

      const reservation = await this.loadReservation(
        client,
        reservationId,
        true,
      );
      if (reservation === null) {
        throw new ApiError(
          404,
          'RESERVATION_NOT_FOUND',
          `Reservation ${reservationId} not found`,
        );
      }

      if (reservation.status === 'held' && isExpired(reservation, now)) {
        await this.expireReservation(client, reservation, now);
        await client.query('COMMIT');
        committed = true;
        throw new ApiError(
          409,
          'RESERVATION_EXPIRED',
          `Reservation ${reservationId} has expired`,
        );
      }
      if (reservation.status === 'released') {
        throw new ApiError(
          409,
          'RESERVATION_RELEASED',
          `Reservation ${reservationId} was already released`,
        );
      }
      if (reservation.status === 'expired') {
        throw new ApiError(
          409,
          'RESERVATION_EXPIRED',
          `Reservation ${reservationId} has expired`,
        );
      }
      if (reservation.status === 'confirmed') {
        await this.insertIdempotency(
          client,
          idempotencyKey,
          'confirm',
          requestHash,
          reservationId,
          now,
        );
        await client.query('COMMIT');
        committed = true;
        return {
          reservation: toReservation(reservation),
          replayed: true,
        };
      }

      await this.lockStockRows(client, reservation.items);
      for (const item of itemsSorted(reservation.items)) {
        const result = await client.query(
          `UPDATE stock_items
              SET on_hand = on_hand - $1,
                  reserved = reserved - $1,
                  updated_at = $2
            WHERE product_id = $3
              AND on_hand >= $1
              AND reserved >= $1`,
          [item.quantity, now, item.productId],
        );
        if ((result.rowCount ?? 0) === 0) {
          throw new Error(
            `Stock invariant violated while confirming ${reservationId}`,
          );
        }
      }
      await client.query(
        `UPDATE reservations
            SET status = 'confirmed', updated_at = $1
          WHERE id = $2`,
        [now, reservationId],
      );
      await this.insertIdempotency(
        client,
        idempotencyKey,
        'confirm',
        requestHash,
        reservationId,
        now,
      );

      const updated = await this.loadReservation(client, reservationId, false);
      if (updated === null) {
        throw new Error('Confirmed reservation could not be read back');
      }

      await client.query('COMMIT');
      committed = true;
      return {
        reservation: toReservation(updated),
        replayed: false,
      };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      if (isUniqueViolation(error)) {
        const existing = await this.findIdempotency(
          this.pool,
          'confirm',
          idempotencyKey,
        );
        if (existing !== null) {
          this.requireMatchingHash(existing, requestHash, idempotencyKey);
          const reservation = await this.loadReservation(
            this.pool,
            existing.reservation_id,
            false,
          );
          if (reservation !== null) {
            return {
              reservation: toReservation(reservation),
              replayed: true,
            };
          }
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseReservation(
    reservationId: string,
    idempotencyKey: string,
  ): Promise<ReservationResult> {
    const now = this.clock.now();
    const requestHash = hashReservationId(reservationId);
    const client = await this.pool.connect();
    let committed = false;

    try {
      await client.query('BEGIN');

      const existing = await this.findIdempotency(
        client,
        'release',
        idempotencyKey,
      );
      if (existing !== null) {
        this.requireMatchingHash(existing, requestHash, idempotencyKey);
        const reservation = await this.loadReservation(
          client,
          existing.reservation_id,
          true,
        );
        if (reservation === null) {
          throw new Error('Idempotency record points to a missing reservation');
        }
        const current = await this.expireIfNeeded(client, reservation, now);
        await client.query('COMMIT');
        committed = true;
        return {
          reservation: toReservation(current),
          replayed: true,
        };
      }

      const reservation = await this.loadReservation(
        client,
        reservationId,
        true,
      );
      if (reservation === null) {
        throw new ApiError(
          404,
          'RESERVATION_NOT_FOUND',
          `Reservation ${reservationId} not found`,
        );
      }
      if (reservation.status === 'confirmed') {
        throw new ApiError(
          409,
          'RESERVATION_ALREADY_CONFIRMED',
          `Reservation ${reservationId} is confirmed and cannot be released`,
        );
      }

      if (reservation.status === 'held') {
        await this.releaseStock(client, reservation.items, now);
        const nextStatus = isExpired(reservation, now) ? 'expired' : 'released';
        await client.query(
          `UPDATE reservations
              SET status = $1, updated_at = $2
            WHERE id = $3`,
          [nextStatus, now, reservationId],
        );
        await this.insertIdempotency(
          client,
          idempotencyKey,
          'release',
          requestHash,
          reservationId,
          now,
        );

        const updated = await this.loadReservation(
          client,
          reservationId,
          false,
        );
        if (updated === null) {
          throw new Error('Released reservation could not be read back');
        }

        await client.query('COMMIT');
        committed = true;
        return {
          reservation: toReservation(updated),
          replayed: false,
        };
      }

      await this.insertIdempotency(
        client,
        idempotencyKey,
        'release',
        requestHash,
        reservationId,
        now,
      );
      await client.query('COMMIT');
      committed = true;
      return {
        reservation: toReservation(reservation),
        replayed: true,
      };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      if (isUniqueViolation(error)) {
        const existing = await this.findIdempotency(
          this.pool,
          'release',
          idempotencyKey,
        );
        if (existing !== null) {
          this.requireMatchingHash(existing, requestHash, idempotencyKey);
          const reservation = await this.loadReservation(
            this.pool,
            existing.reservation_id,
            false,
          );
          if (reservation !== null) {
            return {
              reservation: toReservation(reservation),
              replayed: true,
            };
          }
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async expireReservations(): Promise<number> {
    const now = this.clock.now();
    const client = await this.pool.connect();
    let committed = false;

    try {
      await client.query('BEGIN');
      const candidates = await client.query<{ id: string }>(
        `SELECT id
           FROM reservations
          WHERE status = 'held'
            AND expires_at <= $1
          ORDER BY expires_at ASC
            FOR UPDATE SKIP LOCKED`,
        [now],
      );

      let expiredCount = 0;
      for (const candidate of candidates.rows) {
        const reservation = await this.loadReservation(
          client,
          candidate.id,
          true,
        );
        if (
          reservation === null ||
          reservation.status !== 'held' ||
          !isExpired(reservation, now)
        ) {
          continue;
        }
        await this.expireReservation(client, reservation, now);
        expiredCount += 1;
      }

      await client.query('COMMIT');
      committed = true;
      return expiredCount;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async expireIfNeeded(
    client: PoolClient,
    reservation: StoredReservation,
    now: Date,
  ): Promise<StoredReservation> {
    if (reservation.status !== 'held' || !isExpired(reservation, now)) {
      return reservation;
    }
    return this.expireReservation(client, reservation, now);
  }

  private async expireReservation(
    client: PoolClient,
    reservation: StoredReservation,
    now: Date,
  ): Promise<StoredReservation> {
    await this.releaseStock(client, reservation.items, now);
    await client.query(
      `UPDATE reservations
          SET status = 'expired', updated_at = $1
        WHERE id = $2`,
      [now, reservation.reservationId],
    );
    return {
      ...reservation,
      status: 'expired',
    };
  }

  private async lockStockRows(
    client: PoolClient,
    items: ReservationLine[],
  ): Promise<void> {
    for (const item of itemsSorted(items)) {
      const result = await client.query(
        'SELECT product_id FROM stock_items WHERE product_id = $1 FOR UPDATE',
        [item.productId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new Error(`Missing stock record for ${item.productId}`);
      }
    }
  }

  private async releaseStock(
    client: PoolClient,
    items: ReservationLine[],
    now: Date,
  ): Promise<void> {
    for (const item of itemsSorted(items)) {
      const result = await client.query(
        `UPDATE stock_items
            SET reserved = reserved - $1, updated_at = $2
          WHERE product_id = $3
            AND reserved >= $1`,
        [item.quantity, now, item.productId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new Error(
          `Stock invariant violated while releasing ${item.productId}`,
        );
      }
    }
  }

  private async loadReservation(
    db: Pool | PoolClient,
    reservationId: string,
    forUpdate: boolean,
  ): Promise<StoredReservation | null> {
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const reservationResult = await db.query<ReservationRow>(
      `SELECT id, status, expires_at, created_at
         FROM reservations
        WHERE id = $1${suffix}`,
      [reservationId],
    );
    const row = reservationResult.rows[0];
    if (row === undefined) {
      return null;
    }

    const itemsResult = await db.query<ReservationItemRow>(
      `SELECT product_id, quantity
         FROM reservation_items
        WHERE reservation_id = $1
        ORDER BY product_id ASC`,
      [reservationId],
    );

    return {
      reservationId: row.id,
      status: row.status,
      items: itemsResult.rows.map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
      })),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private async findIdempotency(
    db: Pool | PoolClient,
    operation: IdempotencyOperation,
    key: string,
  ): Promise<IdempotencyRow | null> {
    const result = await db.query<IdempotencyRow>(
      `SELECT request_hash, reservation_id
         FROM idempotency_keys
        WHERE key = $1 AND operation = $2`,
      [key, operation],
    );
    return result.rows[0] ?? null;
  }

  private async insertIdempotency(
    client: PoolClient,
    key: string,
    operation: IdempotencyOperation,
    requestHash: string,
    reservationId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO idempotency_keys
         (key, operation, request_hash, reservation_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [key, operation, requestHash, reservationId, now],
    );
  }

  private requireMatchingHash(
    record: IdempotencyRow,
    requestHash: string,
    idempotencyKey: string,
  ): void {
    if (record.request_hash !== requestHash) {
      throw new ApiError(
        409,
        'IDEMPOTENCY_KEY_REUSE_CONFLICT',
        'Idempotency-Key was already used with a different request',
        { idempotencyKey },
      );
    }
  }
}

function itemsSorted(items: ReservationLine[]): ReservationLine[] {
  return sortItems(items);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
