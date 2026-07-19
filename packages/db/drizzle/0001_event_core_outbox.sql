SET search_path TO public;
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid,
	"event_type" varchar(120) NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"actor_type" varchar(40) DEFAULT 'system' NOT NULL,
	"actor_user_id" uuid,
	"actor_customer_id" uuid,
	"correlation_id" uuid,
	"causation_id" uuid,
	"idempotency_key" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_events_version_check" CHECK ("domain_events"."event_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"outbox_id" uuid NOT NULL,
	"channel" varchar(40) NOT NULL,
	"recipient_type" varchar(40) NOT NULL,
	"recipient_user_id" uuid,
	"recipient_customer_id" uuid,
	"recipient_role" varchar(40),
	"recipient_address" varchar(180) NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(160),
	"provider_message_id" varchar(180),
	"last_error" text,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" in ('pending', 'processing', 'sent', 'skipped', 'failed')),
	CONSTRAINT "notification_deliveries_attempts_check" CHECK ("notification_deliveries"."attempts" >= 0 and "notification_deliveries"."max_attempts" > 0 and "notification_deliveries"."attempts" <= "notification_deliveries"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"domain_event_id" uuid,
	"source_notification_event_id" uuid,
	"order_id" uuid,
	"channel" varchar(40) DEFAULT 'telegram' NOT NULL,
	"template_key" varchar(120) NOT NULL,
	"recipient_type" varchar(40) NOT NULL,
	"recipient_user_id" uuid,
	"recipient_customer_id" uuid,
	"recipient_role" varchar(40),
	"recipient_address" varchar(180),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(160),
	"last_error" text,
	"sent_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_status_check" CHECK ("notification_outbox"."status" in ('pending', 'processing', 'sent', 'partial', 'skipped', 'dead')),
	CONSTRAINT "notification_outbox_attempts_check" CHECK ("notification_outbox"."attempts" >= 0 and "notification_outbox"."max_attempts" > 0 and "notification_outbox"."attempts" <= "notification_outbox"."max_attempts"),
	CONSTRAINT "notification_outbox_priority_check" CHECK ("notification_outbox"."priority" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_customer_id_customers_id_fk" FOREIGN KEY ("actor_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_customer_id_customers_id_fk" FOREIGN KEY ("recipient_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_domain_event_id_domain_events_id_fk" FOREIGN KEY ("domain_event_id") REFERENCES "public"."domain_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_source_notification_event_id_notification_events_id_fk" FOREIGN KEY ("source_notification_event_id") REFERENCES "public"."notification_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipient_customer_id_customers_id_fk" FOREIGN KEY ("recipient_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_shop_idem_uidx" ON "domain_events" USING btree ("shop_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "domain_events_shop_type_idx" ON "domain_events" USING btree ("shop_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_idx" ON "domain_events" USING btree ("shop_id","aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_correlation_idx" ON "domain_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_target_uidx" ON "notification_deliveries" USING btree ("outbox_id","channel","recipient_address");--> statement-breakpoint
CREATE INDEX "notification_deliveries_ready_idx" ON "notification_deliveries" USING btree ("channel","status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_outbox_idx" ON "notification_deliveries" USING btree ("outbox_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_idx" ON "notification_deliveries" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_customer_idx" ON "notification_deliveries" USING btree ("recipient_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_source_uidx" ON "notification_outbox" USING btree ("source_notification_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_shop_idem_uidx" ON "notification_outbox" USING btree ("shop_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_outbox_ready_idx" ON "notification_outbox" USING btree ("channel","status","next_attempt_at","priority","created_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_order_idx" ON "notification_outbox" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_user_idx" ON "notification_outbox" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_customer_idx" ON "notification_outbox" USING btree ("recipient_customer_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enqueue_notification_event_outbox"("p_event_id" uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_event "public"."notification_events"%ROWTYPE;
  v_order "public"."orders"%ROWTYPE;
  v_domain_event_id uuid;
  v_outbox_id uuid;
  v_recipient_user_id uuid;
  v_recipient_customer_id uuid;
  v_recipient_role varchar(40);
  v_outbox_status varchar(40);
  v_dead_at timestamp with time zone;
BEGIN
  SELECT *
  INTO v_event
  FROM "public"."notification_events"
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_event.order_id IS NOT NULL THEN
    SELECT *
    INTO v_order
    FROM "public"."orders"
    WHERE id = v_event.order_id
      AND shop_id = v_event.shop_id;
  END IF;

  IF NULLIF(BTRIM(COALESCE(v_event.recipient_telegram_id, '')), '') IS NOT NULL THEN
    SELECT ta.user_id, ta.customer_id
    INTO v_recipient_user_id, v_recipient_customer_id
    FROM "public"."telegram_accounts" ta
    WHERE ta.shop_id = v_event.shop_id
      AND ta.telegram_id = v_event.recipient_telegram_id
    ORDER BY ta.is_active DESC, ta.linked_at DESC
    LIMIT 1;
  END IF;

  IF v_event.recipient_type = 'customer' THEN
    v_recipient_customer_id = COALESCE(
      v_recipient_customer_id,
      v_order.customer_id
    );
  ELSIF v_event.recipient_type = 'staff' THEN
    IF v_recipient_user_id IS NULL THEN
      CASE
        WHEN v_event.type IN (
          'florist_order_assigned',
          'bouquet_approved',
          'bouquet_revision_requested'
        ) THEN
          v_recipient_user_id = v_order.florist_id;
          v_recipient_role = 'florist';
        WHEN v_event.type IN (
          'courier_order_assigned'
        ) THEN
          v_recipient_user_id = v_order.courier_id;
          v_recipient_role = 'courier';
        WHEN v_order.manager_id IS NOT NULL THEN
          v_recipient_user_id = v_order.manager_id;
          v_recipient_role = 'manager';
        ELSE
          v_recipient_role = 'management';
      END CASE;
    ELSE
      SELECT su.role::text
      INTO v_recipient_role
      FROM "public"."shop_users" su
      WHERE su.shop_id = v_event.shop_id
        AND su.user_id = v_recipient_user_id
        AND su.is_active = true
      LIMIT 1;
    END IF;
  END IF;

  v_outbox_status = CASE v_event.status
    WHEN 'sent' THEN 'sent'
    WHEN 'skipped' THEN 'skipped'
    WHEN 'failed' THEN 'dead'
    WHEN 'processing' THEN 'processing'
    ELSE 'pending'
  END;

  v_dead_at = CASE
    WHEN v_event.status = 'failed' THEN COALESCE(v_event.updated_at, NOW())
    ELSE NULL
  END;

  INSERT INTO "public"."domain_events" (
    shop_id,
    aggregate_type,
    aggregate_id,
    event_type,
    event_version,
    actor_type,
    correlation_id,
    idempotency_key,
    payload,
    occurred_at,
    published_at,
    created_at,
    updated_at
  )
  VALUES (
    v_event.shop_id,
    CASE WHEN v_event.order_id IS NULL THEN 'shop' ELSE 'order' END,
    v_event.order_id,
    v_event.type,
    1,
    'system',
    v_event.order_id,
    'legacy-notification-event:' || v_event.id::text,
    jsonb_build_object(
      'source', 'notification_events',
      'sourceNotificationEventId', v_event.id,
      'channel', v_event.channel,
      'recipientType', v_event.recipient_type,
      'payload', v_event.payload
    ),
    v_event.created_at,
    CASE WHEN v_event.status = 'sent' THEN v_event.sent_at ELSE NULL END,
    v_event.created_at,
    v_event.updated_at
  )
  ON CONFLICT (shop_id, idempotency_key)
  DO UPDATE SET
    idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_domain_event_id;

  INSERT INTO "public"."notification_outbox" (
    shop_id,
    domain_event_id,
    source_notification_event_id,
    order_id,
    channel,
    template_key,
    recipient_type,
    recipient_user_id,
    recipient_customer_id,
    recipient_role,
    recipient_address,
    payload,
    status,
    priority,
    attempts,
    max_attempts,
    next_attempt_at,
    last_error,
    sent_at,
    dead_at,
    idempotency_key,
    created_at,
    updated_at
  )
  VALUES (
    v_event.shop_id,
    v_domain_event_id,
    v_event.id,
    v_event.order_id,
    v_event.channel,
    v_event.type,
    v_event.recipient_type,
    v_recipient_user_id,
    v_recipient_customer_id,
    v_recipient_role,
    NULLIF(BTRIM(COALESCE(v_event.recipient_telegram_id, '')), ''),
    v_event.payload,
    v_outbox_status,
    CASE
      WHEN v_event.type IN ('customer_login_code') THEN 5
      WHEN v_event.type IN (
        'florist_order_assigned',
        'courier_order_assigned',
        'bouquet_approval_requested'
      ) THEN 10
      WHEN v_event.type IN ('order_created', 'order_paid') THEN 20
      ELSE 100
    END,
    LEAST(GREATEST(v_event.attempts, 0), 5),
    5,
    CASE
      WHEN v_event.status = 'pending' THEN COALESCE(v_event.updated_at, NOW())
      ELSE NOW()
    END,
    v_event.error,
    v_event.sent_at,
    v_dead_at,
    'legacy-notification-event:' || v_event.id::text,
    v_event.created_at,
    v_event.updated_at
  )
  ON CONFLICT (source_notification_event_id)
  DO UPDATE SET
    domain_event_id = EXCLUDED.domain_event_id,
    order_id = EXCLUDED.order_id,
    channel = EXCLUDED.channel,
    template_key = EXCLUDED.template_key,
    recipient_type = EXCLUDED.recipient_type,
    recipient_user_id = EXCLUDED.recipient_user_id,
    recipient_customer_id = EXCLUDED.recipient_customer_id,
    recipient_role = EXCLUDED.recipient_role,
    recipient_address = EXCLUDED.recipient_address,
    payload = EXCLUDED.payload,
    status = CASE
      WHEN "notification_outbox".status IN ('sent', 'skipped', 'dead')
        THEN "notification_outbox".status
      ELSE EXCLUDED.status
    END,
    attempts = GREATEST("notification_outbox".attempts, EXCLUDED.attempts),
    last_error = EXCLUDED.last_error,
    sent_at = COALESCE("notification_outbox".sent_at, EXCLUDED.sent_at),
    dead_at = COALESCE("notification_outbox".dead_at, EXCLUDED.dead_at),
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_outbox_id;

  RETURN v_outbox_id;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."notification_event_outbox_enqueue_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM "public"."enqueue_notification_event_outbox"(NEW.id);
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "notification_events_outbox_enqueue_trg" ON "public"."notification_events";
--> statement-breakpoint
CREATE TRIGGER "notification_events_outbox_enqueue_trg"
AFTER INSERT ON "public"."notification_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."notification_event_outbox_enqueue_trigger"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."notification_event_outbox_sync_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "public"."notification_outbox"
  SET
    status = CASE NEW.status
      WHEN 'sent' THEN 'sent'
      WHEN 'skipped' THEN 'skipped'
      WHEN 'failed' THEN 'dead'
      WHEN 'processing' THEN 'processing'
      ELSE 'pending'
    END,
    attempts = LEAST(GREATEST(NEW.attempts, 0), max_attempts),
    last_error = NEW.error,
    sent_at = NEW.sent_at,
    dead_at = CASE
      WHEN NEW.status = 'failed' THEN COALESCE(NEW.updated_at, NOW())
      ELSE NULL
    END,
    locked_at = CASE WHEN NEW.status = 'processing' THEN NOW() ELSE NULL END,
    locked_by = CASE WHEN NEW.status = 'processing' THEN 'legacy-notification-worker' ELSE NULL END,
    updated_at = NEW.updated_at
  WHERE source_notification_event_id = NEW.id;

  RETURN NEW;
END;
$function$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "notification_events_outbox_sync_trg" ON "public"."notification_events";
--> statement-breakpoint
CREATE TRIGGER "notification_events_outbox_sync_trg"
AFTER UPDATE OF status, attempts, error, sent_at, updated_at
ON "public"."notification_events"
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.attempts IS DISTINCT FROM NEW.attempts
  OR OLD.error IS DISTINCT FROM NEW.error
  OR OLD.sent_at IS DISTINCT FROM NEW.sent_at
)
EXECUTE FUNCTION "public"."notification_event_outbox_sync_trigger"();
--> statement-breakpoint
SELECT "public"."enqueue_notification_event_outbox"(id)
FROM "public"."notification_events"
ORDER BY created_at, id;
