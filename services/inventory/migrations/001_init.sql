CREATE TABLE IF NOT EXISTS stock_items (
  product_id TEXT PRIMARY KEY,
  on_hand INTEGER NOT NULL CHECK (on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reserved <= on_hand)
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('held', 'confirmed', 'released', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS reservations_expiry_idx
  ON reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS reservation_items (
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES stock_items(product_id),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000),
  PRIMARY KEY (reservation_id, product_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('reserve', 'confirm', 'release')),
  request_hash TEXT NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, operation)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_reservation_idx
  ON idempotency_keys (reservation_id);
