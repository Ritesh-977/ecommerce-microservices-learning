import type { AddCartItemInput, Cart } from '../types/cart.js';

export interface CartRepository {
  create(sessionId: string): Promise<Cart>;
  findById(cartId: string): Promise<Cart | null>;
  addItem(cartId: string, input: AddCartItemInput): Promise<Cart>;
  updateItem(cartId: string, itemId: string, quantity: number): Promise<Cart>;
  removeItem(cartId: string, itemId: string): Promise<Cart>;
}
