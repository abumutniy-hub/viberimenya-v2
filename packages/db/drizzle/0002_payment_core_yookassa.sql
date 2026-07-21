ALTER TYPE "public"."payment_status" ADD VALUE 'created' BEFORE 'pending';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'waiting_for_capture' BEFORE 'paid';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'partially_refunded' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'expired';--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" varchar(80) NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"source" varchar(80) NOT NULL,
	"previous_status" "payment_status",
	"next_status" "payment_status",
	"provider_event_id" varchar(255),
	"idempotency_key" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "attempt_no" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "idempotency_key" varchar(64);--> statement-breakpoint
WITH ranked_attempts AS (
	SELECT
		id,
		ROW_NUMBER() OVER (
			PARTITION BY shop_id, order_id, provider
			ORDER BY created_at ASC, id ASC
		)::integer AS attempt_no
	FROM "payments"
)
UPDATE "payments" AS payment
SET "attempt_no" = ranked.attempt_no
FROM ranked_attempts AS ranked
WHERE payment.id = ranked.id;--> statement-breakpoint
UPDATE "payments"
SET "idempotency_key" = 'legacy-' || id::text
WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "attempt_no" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "attempt_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "failure_code" varchar(120);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "last_provider_status" varchar(80);--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_payment_idem_uidx" ON "payment_events" USING btree ("payment_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_events_order_idx" ON "payment_events" USING btree ("order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_events_provider_event_idx" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payments_expiry_idx" ON "payments" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uidx" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_idempotency_uidx" ON "payments" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_attempt_uidx" ON "payments" USING btree ("shop_id","order_id","provider","attempt_no");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt_no_check" CHECK ("payments"."attempt_no" > 0);
