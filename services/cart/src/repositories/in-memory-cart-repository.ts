import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';
import type {
  AddCartItemInput,
  Cart,
  CartItem,
} from '../types/cart.js';
import type { CartRepository } from './cart-repository.js';

interface StoredCart {
  cartId: string;
  sessionId: string;
  items: CartItem[];
}

export class InMemoryCartRepository implements CartRepository {
  private readonly carts = new Map<string, StoredCart>();

  async create(sessionId: string): Promise<Cart> {
    const cart: StoredCart = {
      cartId: randomUUID(),
      sessionId,
      items: [],
    };
    this.carts.set(cart.cartId, cart);
    return this.toCart(cart);
  }

  async findById(cartId: string): Promise<Cart | null> {
    const cart = this.carts.get(cartId);
    return cart === undefined ? null : this.toCart(cart);
  }

  async addItem(cartId: string, input: AddCartItemInput): Promise<Cart> {
    const cart = this.requireCart(cartId);

    const cartCurrency = cart.items[0]?.currency;
    if (cartCurrency !== undefined && cartCurrency !== input.currency) {
      throw new ApiError(
        409,
        'CURRENCY_MISMATCH',
        `Cart already contains items priced in ${cartCurrency}`,
      );
    }

    const existing = cart.items.find(
      (item) => item.productId === input.productId,
    );

    if (existing === undefined) {
      cart.items.push({
        itemId: randomUUID(),
        productId: input.productId,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        currency: input.currency,
      });
    } else {
      const nextQuantity = existing.quantity + input.quantity;
      if (nextQuantity > 99) {
        throw new ApiError(
          409,
          'CART_ITEM_LIMIT_EXCEEDED',
          'Cart item quantity cannot exceed 99',
        );
      }
      existing.quantity = nextQuantity;
    }

    return this.toCart(cart);
  }

  async updateItem(
    cartId: string,
    itemId: string,
    quantity: number,
  ): Promise<Cart> {
    const cart = this.requireCart(cartId);
    const item = cart.items.find((candidate) => candidate.itemId === itemId);
    if (item === undefined) {
      throw new ApiError(
        404,
        'CART_ITEM_NOT_FOUND',
        `Item ${itemId} not found in cart ${cartId}`,
      );
    }
    item.quantity = quantity;
    return this.toCart(cart);
  }

  async removeItem(cartId: string, itemId: string): Promise<Cart> {
    const cart = this.requireCart(cartId);
    const itemIndex = cart.items.findIndex(
      (candidate) => candidate.itemId === itemId,
    );
    if (itemIndex === -1) {
      throw new ApiError(
        404,
        'CART_ITEM_NOT_FOUND',
        `Item ${itemId} not found in cart ${cartId}`,
      );
    }
    cart.items.splice(itemIndex, 1);
    return this.toCart(cart);
  }

  private requireCart(cartId: string): StoredCart {
    const cart = this.carts.get(cartId);
    if (cart === undefined) {
      throw new ApiError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);
    }
    return cart;
  }

  private toCart(cart: StoredCart): Cart {
    const items = cart.items.map((item) => ({ ...item }));
    const subtotal = roundMoney(
      items.reduce(
        (total, item) => total + item.quantity * item.unitPrice,
        0,
      ),
    );
    return {
      cartId: cart.cartId,
      sessionId: cart.sessionId,
      items,
      subtotal,
      currency: items[0]?.currency ?? 'USD',
    };
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
