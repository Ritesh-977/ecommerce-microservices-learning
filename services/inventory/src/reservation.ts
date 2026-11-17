import type {
  Reservation,
  ReservationLine,
  StoredReservation,
} from './types/inventory.js';

export function isExpired(
  reservation: StoredReservation,
  now: Date,
): boolean {
  return reservation.expiresAt.getTime() <= now.getTime();
}

export function toReservation(
  reservation: StoredReservation,
): Reservation {
  return {
    reservationId: reservation.reservationId,
    status: reservation.status,
    items: reservation.items.map((item) => ({ ...item })),
    expiresAt: reservation.expiresAt.toISOString(),
    createdAt: reservation.createdAt.toISOString(),
  };
}

export function sortItems(items: ReservationLine[]): ReservationLine[] {
  return [...items]
    .sort((left, right) => left.productId.localeCompare(right.productId))
    .map((item) => ({ ...item }));
}
