import { randomUUID } from 'node:crypto';
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
  Stock,
  StoredReservation,
} from '../types/inventory.js';
import type { InventoryRepository } from './inventory-repository.js';

interface StockState {
  onHand: number;
  reserved: number;
}

interface IdempotencyRecord {
  requestHash: string;
  reservationId: string;
}

export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly stock = new Map<string, StockState>();
  private readonly reservations = new Map<string, StoredReservation>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  constructor(
    initialStock: Array<{ productId: string; onHand: number }>,
    private readonly clock: Clock = systemClock,
  ) {
    for (const item of initialStock) {
      if (!Number.isInteger(item.onHand) || item.onHand < 0) {
        throw new Error(`Invalid onHand for ${item.productId}`);
      }
      if (this.stock.has(item.productId)) {
        throw new Error(`Duplicate stock record for ${item.productId}`);
      }
      this.stock.set(item.productId, { onHand: item.onHand, reserved: 0 });
    }
  }

  async getStock(productId: string): Promise<Stock | null> {
    const stock = this.stock.get(productId);
    if (stock === undefined) {
      return null;
    }
    return {
      productId,
      onHand: stock.onHand,
      reserved: stock.reserved,
      available: stock.onHand - stock.reserved,
    };
  }

  async createReservation(
    input: CreateReservationInput,
    idempotencyKey: string,
  ): Promise<ReservationResult> {
    validateReservationInput(input);
    const now = this.clock.now();
    const requestHash = hashReservationRequest(input.items, input.ttlSeconds);
    const operationKey = this.operationKey('reserve', idempotencyKey);

    const existing = this.idempotency.get(operationKey);
    if (existing !== undefined) {
      this.requireMatchingHash(existing, requestHash, idempotencyKey);
      const reservation = this.requireReservation(existing.reservationId);
      this.expireIfNeeded(reservation, now);
      return {
        reservation: toReservation(reservation),
        replayed: true,
      };
    }

    const items = sortItems(input.items);
    const insufficient: Array<{
      productId: string;
      requested: number;
      available: number;
    }> = [];

    for (const item of items) {
      const stock = this.stock.get(item.productId);
      if (stock === undefined) {
        throw new ApiError(
          404,
          'STOCK_NOT_FOUND',
          `No stock record for product ${item.productId}`,
          { productId: item.productId },
        );
      }
      const available = stock.onHand - stock.reserved;
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
      const stock = this.requireStock(item.productId);
      stock.reserved += item.quantity;
    }

    const reservation: StoredReservation = {
      reservationId: randomUUID(),
      status: 'held',
      items,
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000),
      createdAt: now,
    };
    this.reservations.set(reservation.reservationId, reservation);
    this.idempotency.set(operationKey, {
      requestHash,
      reservationId: reservation.reservationId,
    });

    return {
      reservation: toReservation(reservation),
      replayed: false,
    };
  }

  async confirmReservation(
    reservationId: string,
    idempotencyKey: string,
  ): Promise<ReservationResult> {
    const now = this.clock.now();
    const requestHash = hashReservationId(reservationId);
    const operationKey = this.operationKey('confirm', idempotencyKey);

    const existing = this.idempotency.get(operationKey);
    if (existing !== undefined) {
      this.requireMatchingHash(existing, requestHash, idempotencyKey);
      const reservation = this.requireReservation(existing.reservationId);
      this.expireIfNeeded(reservation, now);
      return {
        reservation: toReservation(reservation),
        replayed: true,
      };
    }

    const reservation = this.requireReservation(reservationId);
    if (this.expireIfNeeded(reservation, now)) {
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
      this.idempotency.set(operationKey, { requestHash, reservationId });
      return {
        reservation: toReservation(reservation),
        replayed: true,
      };
    }

    for (const item of sortItems(reservation.items)) {
      const stock = this.requireStock(item.productId);
      if (
        stock.onHand < item.quantity ||
        stock.reserved < item.quantity
      ) {
        throw new Error(
          `Stock invariant violated while confirming ${reservationId}`,
        );
      }
      stock.onHand -= item.quantity;
      stock.reserved -= item.quantity;
    }
    reservation.status = 'confirmed';
    this.idempotency.set(operationKey, { requestHash, reservationId });

    return {
      reservation: toReservation(reservation),
      replayed: false,
    };
  }

  async releaseReservation(
    reservationId: string,
    idempotencyKey: string,
  ): Promise<ReservationResult> {
    const now = this.clock.now();
    const requestHash = hashReservationId(reservationId);
    const operationKey = this.operationKey('release', idempotencyKey);

    const existing = this.idempotency.get(operationKey);
    if (existing !== undefined) {
      this.requireMatchingHash(existing, requestHash, idempotencyKey);
      const reservation = this.requireReservation(existing.reservationId);
      this.expireIfNeeded(reservation, now);
      return {
        reservation: toReservation(reservation),
        replayed: true,
      };
    }

    const reservation = this.requireReservation(reservationId);
    if (reservation.status === 'confirmed') {
      throw new ApiError(
        409,
        'RESERVATION_ALREADY_CONFIRMED',
        `Reservation ${reservationId} is confirmed and cannot be released`,
      );
    }

    if (reservation.status === 'held') {
      this.releaseStock(reservation.items);
      reservation.status = isExpired(reservation, now) ? 'expired' : 'released';
      this.idempotency.set(operationKey, { requestHash, reservationId });
      return {
        reservation: toReservation(reservation),
        replayed: false,
      };
    }

    this.idempotency.set(operationKey, { requestHash, reservationId });
    return {
      reservation: toReservation(reservation),
      replayed: true,
    };
  }

  async expireReservations(): Promise<number> {
    const now = this.clock.now();
    let expiredCount = 0;

    for (const reservation of this.reservations.values()) {
      if (reservation.status !== 'held' || !isExpired(reservation, now)) {
        continue;
      }
      this.releaseStock(reservation.items);
      reservation.status = 'expired';
      expiredCount += 1;
    }

    return expiredCount;
  }

  private expireIfNeeded(
    reservation: StoredReservation,
    now: Date,
  ): boolean {
    if (reservation.status !== 'held' || !isExpired(reservation, now)) {
      return false;
    }
    this.releaseStock(reservation.items);
    reservation.status = 'expired';
    return true;
  }

  private releaseStock(items: ReservationLine[]): void {
    for (const item of sortItems(items)) {
      const stock = this.requireStock(item.productId);
      if (stock.reserved < item.quantity) {
        throw new Error(
          `Stock invariant violated while releasing ${item.productId}`,
        );
      }
      stock.reserved -= item.quantity;
    }
  }

  private requireStock(productId: string): StockState {
    const stock = this.stock.get(productId);
    if (stock === undefined) {
      throw new Error(`Missing stock state for ${productId}`);
    }
    return stock;
  }

  private requireReservation(reservationId: string): StoredReservation {
    const reservation = this.reservations.get(reservationId);
    if (reservation === undefined) {
      throw new ApiError(
        404,
        'RESERVATION_NOT_FOUND',
        `Reservation ${reservationId} not found`,
      );
    }
    return reservation;
  }

  private requireMatchingHash(
    record: IdempotencyRecord,
    requestHash: string,
    idempotencyKey: string,
  ): void {
    if (record.requestHash !== requestHash) {
      throw new ApiError(
        409,
        'IDEMPOTENCY_KEY_REUSE_CONFLICT',
        'Idempotency-Key was already used with a different request',
        { idempotencyKey },
      );
    }
  }

  private operationKey(
    operation: IdempotencyOperation,
    idempotencyKey: string,
  ): string {
    return `${operation}:${idempotencyKey}`;
  }
}
