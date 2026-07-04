CREATE TABLE IF NOT EXISTS customer_channel_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  provider_user_id varchar(160) NOT NULL,
  provider_username varchar(160),
  provider_display_name varchar(220),
  is_active boolean NOT NULL DEFAULT true,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_channel_links_provider_uidx
ON customer_channel_links(shop_id, provider, provider_user_id);

CREATE INDEX IF NOT EXISTS customer_channel_links_customer_idx
ON customer_channel_links(shop_id, customer_id);

CREATE TABLE IF NOT EXISTS customer_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  purpose varchar(80) NOT NULL,
  token varchar(180) NOT NULL UNIQUE,
  status varchar(40) NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_link_tokens_lookup_idx
ON customer_link_tokens(provider, purpose, token, status, expires_at);

CREATE INDEX IF NOT EXISTS customer_link_tokens_customer_idx
ON customer_link_tokens(shop_id, customer_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'viberimenya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON customer_channel_links TO viberimenya_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON customer_link_tokens TO viberimenya_app;
  END IF;
END $$;
