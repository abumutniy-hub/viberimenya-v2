CREATE OR REPLACE FUNCTION create_customer_telegram_notification_from_staff_event()
RETURNS trigger AS $$
DECLARE
  customer_telegram_id varchar(80);
BEGIN
  IF NEW.channel <> 'telegram' THEN
    RETURN NEW;
  END IF;

  IF NEW.recipient_type <> 'staff' THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('order_confirmed', 'payment_link_added', 'order_paid') THEN
    RETURN NEW;
  END IF;

  SELECT ta.telegram_id
  INTO customer_telegram_id
  FROM orders o
  JOIN telegram_accounts ta
    ON ta.shop_id = o.shop_id
   AND ta.customer_id = o.customer_id
   AND ta.is_active = true
  WHERE o.id = NEW.order_id
    AND o.shop_id = NEW.shop_id
  ORDER BY ta.linked_at DESC
  LIMIT 1;

  IF customer_telegram_id IS NULL OR customer_telegram_id = '' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM notification_events ne
    WHERE ne.shop_id = NEW.shop_id
      AND ne.order_id = NEW.order_id
      AND ne.type = NEW.type
      AND ne.channel = 'telegram'
      AND ne.recipient_type = 'customer'
      AND ne.recipient_telegram_id = customer_telegram_id
      AND ne.created_at > NOW() - INTERVAL '10 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO notification_events (
    shop_id,
    order_id,
    type,
    channel,
    recipient_type,
    recipient_telegram_id,
    status,
    payload,
    created_at,
    updated_at
  )
  VALUES (
    NEW.shop_id,
    NEW.order_id,
    NEW.type,
    'telegram',
    'customer',
    customer_telegram_id,
    'pending',
    COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('audience', 'customer'),
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_events_customer_copy_trg ON notification_events;

CREATE TRIGGER notification_events_customer_copy_trg
AFTER INSERT ON notification_events
FOR EACH ROW
EXECUTE FUNCTION create_customer_telegram_notification_from_staff_event();
