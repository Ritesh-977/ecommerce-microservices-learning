import type {
  CreateReservationInput,
  ReservationResult,
  Stock,
} from '../types/inventory.js';

export interface InventoryRepository {
  getStock(productId: string): Promise<Stock | null>;
  createReservation(
    input: CreateReservationInput,
    idempotencyKey: string,
  ): Promise<ReservationResult>;
  confirmReservation(
    reservationId: string,
    idempotencyKey: string,
  ): Promise<ReservationResult>;
  releaseReservation(
    reservationId: string,
    idempotencyKey: string,
  ): Promise<ReservationResult>;
  expireReservations(): Promise<number>;
}
