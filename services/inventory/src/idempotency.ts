import { createHash } from 'node:crypto';
import { sortItems } from './reservation.js';
import type { ReservationLine } from './types/inventory.js';

export type IdempotencyOperation = 'reserve' | 'confirm' | 'release';

export function hashReservationRequest(
  items: ReservationLine[],
  ttlSeconds: number,
): string {
  const normalized = {
    items: sortItems(items).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
    ttlSeconds,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function hashReservationId(reservationId: string): string {
  return createHash('sha256').update(reservationId).digest('hex');
}
