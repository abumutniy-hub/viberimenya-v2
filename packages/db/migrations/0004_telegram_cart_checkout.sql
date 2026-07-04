CREATE TABLE IF NOT EXISTS telegram_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  telegram_chat_id bigint NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, telegram_chat_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_cart_items_chat
  ON telegram_cart_items (shop_id, telegram_chat_id);

CREATE TABLE IF NOT EXISTS telegram_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  telegram_chat_id bigint NOT NULL,
  step varchar(80) NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, telegram_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_checkout_sessions_chat
  ON telegram_checkout_sessions (shop_id, telegram_chat_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'viberimenya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_cart_items TO viberimenya_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_checkout_sessions TO viberimenya_app;
  END IF;
END $$;
