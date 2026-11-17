export interface CartItem {
  itemId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  currency: string;
}

export interface Cart {
  cartId: string;
  sessionId: string;
  items: CartItem[];
  subtotal: number;
  currency: string;
}

export interface AddCartItemInput {
  productId: string;
  unitPrice: number;
  currency: string;
  quantity: number;
}
