import { ApiError } from './errors.js';
import type { CreateReservationInput } from './types/inventory.js';

export function validateReservationInput(input: CreateReservationInput): void {
  if (
    !Number.isInteger(input.ttlSeconds) ||
    input.ttlSeconds < 30 ||
    input.ttlSeconds > 3600
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'ttlSeconds must be an integer between 30 and 3600',
    );
  }

  if (
    !Array.isArray(input.items) ||
    input.items.length === 0 ||
    input.items.length > 100
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'items must contain between 1 and 100 lines',
    );
  }

  const seen = new Set<string>();
  for (const item of input.items) {
    if (
      typeof item.productId !== 'string' ||
      item.productId.trim() === '' ||
      item.productId.length > 128
    ) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'productId must be a non-empty string',
      );
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 1000
    ) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'quantity must be an integer between 1 and 1000',
      );
    }
    if (seen.has(item.productId)) {
      throw new ApiError(
        400,
        'DUPLICATE_RESERVATION_LINE',
        `Product ${item.productId} appears more than once in the reservation`,
      );
    }
    seen.add(item.productId);
  }
}
