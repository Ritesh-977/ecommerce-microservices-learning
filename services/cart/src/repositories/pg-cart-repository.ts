import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../errors.js';
import type {
  AddCartItemInput,
  Cart,
  CartItem,
} from '../types/cart.js';
import type { CartRepository } from './cart-repository.js';

interface CartRow {
  id: string;
  session_id: string;
}

interface ItemRow {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: string;
  currency: string;
}

const CART_COLUMNS = 'id, session_id';
const ITEM_COLUMNS = 'id, product_id, quantity, unit_price, currency';

export class PgCartRepository implements CartRepository {
  constructor(private readonly pool: Pool) {}

  async create(sessionId: string): Promise<Cart> {
    const cartId = randomUUID();
    await this.pool.query(
      'INSERT INTO carts (id, session_id) VALUES ($1, $2)',
      [cartId, sessionId],
    );
    return {
      cartId,
      sessionId,
      items: [],
      subtotal: 0,
      currency: 'USD',
    };
  }

  async findById(cartId: string): Promise<Cart | null> {
    return this.loadCart(this.pool, cartId);
  }

  async addItem(cartId: string, input: AddCartItemInput): Promise<Cart> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Lock the cart row so concurrent adds cannot interleave line-item decisions.
      const cartResult = await client.query<CartRow>(
        `SELECT ${CART_COLUMNS} FROM carts WHERE id = $1 FOR UPDATE`,
        [cartId],
      );
      if ((cartResult.rowCount ?? 0) === 0) {
        throw new ApiError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);
      }

      const currencyResult = await client.query<{ currency: string }>(
        'SELECT currency FROM cart_items WHERE cart_id = $1 LIMIT 1',
        [cartId],
      );
      const cartCurrency = currencyResult.rows[0]?.currency;
      if (cartCurrency !== undefined && cartCurrency !== input.currency) {
        throw new ApiError(
          409,
          'CURRENCY_MISMATCH',
          `Cart already contains items priced in ${cartCurrency}`,
        );
      }

      const existingResult = await client.query<{
        id: string;
        quantity: number;
      }>(
        'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
        [cartId, input.productId],
      );
      const existing = existingResult.rows[0];

      if (existing === undefined) {
        await client.query(
          `INSERT INTO cart_items
             (id, cart_id, product_id, quantity, unit_price, currency)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            cartId,
            input.productId,
            input.quantity,
            input.unitPrice,
            input.currency,
          ],
        );
      } else {
        const nextQuantity = existing.quantity + input.quantity;
        if (nextQuantity > 99) {
          throw new ApiError(
            409,
            'CART_ITEM_LIMIT_EXCEEDED',
            'Cart item quantity cannot exceed 99',
          );
        }
        await client.query(
          'UPDATE cart_items SET quantity = $1, updated_at = now() WHERE id = $2',
          [nextQuantity, existing.id],
        );
      }

      await client.query('UPDATE carts SET updated_at = now() WHERE id = $1', [
        cartId,
      ]);

      const cart = await this.loadCart(client, cartId);
      if (cart === null) {
        throw new ApiError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);
      }

      await client.query('COMMIT');
      return cart;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateItem(
    cartId: string,
    itemId: string,
    quantity: number,
  ): Promise<Cart> {
    const result = await this.pool.query(
      `UPDATE cart_items
          SET quantity = $1, updated_at = now()
        WHERE id = $2 AND cart_id = $3`,
      [quantity, itemId, cartId],
    );

    if ((result.rowCount ?? 0) === 0) {
      await this.requireCart(cartId);
      throw new ApiError(
        404,
        'CART_ITEM_NOT_FOUND',
        `Item ${itemId} not found in cart ${cartId}`,
      );
    }

    await this.touchCart(cartId);
    return this.requireCart(cartId);
  }

  async removeItem(cartId: string, itemId: string): Promise<Cart> {
    const result = await this.pool.query(
      'DELETE FROM cart_items WHERE id = $1 AND cart_id = $2',
      [itemId, cartId],
    );

    if ((result.rowCount ?? 0) === 0) {
      await this.requireCart(cartId);
      throw new ApiError(
        404,
        'CART_ITEM_NOT_FOUND',
        `Item ${itemId} not found in cart ${cartId}`,
      );
    }

    await this.touchCart(cartId);
    return this.requireCart(cartId);
  }

  private async requireCart(cartId: string): Promise<Cart> {
    const cart = await this.loadCart(this.pool, cartId);
    if (cart === null) {
      throw new ApiError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);
    }
    return cart;
  }

  private async touchCart(cartId: string): Promise<void> {
    await this.pool.query('UPDATE carts SET updated_at = now() WHERE id = $1', [
      cartId,
    ]);
  }

  private async loadCart(
    db: Pool | PoolClient,
    cartId: string,
  ): Promise<Cart | null> {
    const cartResult = await db.query<CartRow>(
      `SELECT ${CART_COLUMNS} FROM carts WHERE id = $1`,
      [cartId],
    );
    const cartRow = cartResult.rows[0];
    if (cartRow === undefined) {
      return null;
    }

    const itemsResult = await db.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS}
         FROM cart_items
        WHERE cart_id = $1
        ORDER BY created_at ASC, id ASC`,
      [cartId],
    );

    return toCart(cartRow, itemsResult.rows);
  }
}

function toCart(cartRow: CartRow, itemRows: ItemRow[]): Cart {
  const items: CartItem[] = itemRows.map((row) => ({
    itemId: row.id,
    productId: row.product_id,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    currency: row.currency,
  }));

  const subtotal = roundMoney(
    items.reduce((total, item) => total + item.quantity * item.unitPrice, 0),
  );

  return {
    cartId: cartRow.id,
    sessionId: cartRow.session_id,
    items,
    subtotal,
    currency: items[0]?.currency ?? 'USD',
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
