CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  type varchar(80) NOT NULL,
  channel varchar(40) NOT NULL DEFAULT 'telegram',
  recipient_type varchar(40) NOT NULL DEFAULT 'staff',
  recipient_telegram_id varchar(80),
  status varchar(40) NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_events_shop_status_idx
  ON notification_events (shop_id, status, created_at);

CREATE INDEX IF NOT EXISTS notification_events_order_idx
  ON notification_events (order_id);

CREATE INDEX IF NOT EXISTS notification_events_type_idx
  ON notification_events (type);

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_events TO viberimenya_app;
