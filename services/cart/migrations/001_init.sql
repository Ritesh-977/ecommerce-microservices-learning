CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS carts_session_id_idx ON carts (session_id);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id)
);

CREATE INDEX IF NOT EXISTS cart_items_cart_id_idx ON cart_items (cart_id);
