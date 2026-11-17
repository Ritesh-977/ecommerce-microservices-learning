export type ReservationStatus = 'held' | 'confirmed' | 'released' | 'expired';

export interface Stock {
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface ReservationLine {
  productId: string;
  quantity: number;
}

export interface Reservation {
  reservationId: string;
  status: ReservationStatus;
  items: ReservationLine[];
  expiresAt: string;
  createdAt: string;
}

export interface CreateReservationInput {
  items: ReservationLine[];
  ttlSeconds: number;
}

export interface ReservationResult {
  reservation: Reservation;
  replayed: boolean;
}

/**
 * Internal representation used by repositories. API-facing reservations use
 * ISO timestamps; repositories keep Date objects so expiry checks are explicit.
 */
export interface StoredReservation {
  reservationId: string;
  status: ReservationStatus;
  items: ReservationLine[];
  expiresAt: Date;
  createdAt: Date;
}
