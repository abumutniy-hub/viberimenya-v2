SET search_path TO public;
--> statement-breakpoint
ALTER TABLE "customer_channel_links" ADD COLUMN "provider_chat_id" varchar(180);--> statement-breakpoint
ALTER TABLE "customer_channel_links" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_channel_links" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_channel_links" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_channel_links" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "customer_channel_links" AS channel_link
SET
  "provider_chat_id" = COALESCE(channel_link."provider_chat_id", telegram_account."telegram_id"),
  "notifications_enabled" = telegram_account."notifications_enabled",
  "verified_at" = COALESCE(channel_link."verified_at", telegram_account."linked_at"),
  "last_seen_at" = COALESCE(channel_link."last_seen_at", telegram_account."updated_at"),
  "metadata" = channel_link."metadata" || jsonb_build_object(
    'legacyTelegramAccountId', telegram_account."id"::text
  ),
  "updated_at" = NOW()
FROM "telegram_accounts" AS telegram_account
WHERE channel_link."shop_id" = telegram_account."shop_id"
  AND channel_link."customer_id" = telegram_account."customer_id"
  AND channel_link."provider" = 'telegram'
  AND channel_link."provider_user_id" = telegram_account."telegram_id";--> statement-breakpoint
CREATE TABLE "channel_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_update_id" varchar(220) NOT NULL,
	"update_type" varchar(120) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(160),
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_updates_status_check" CHECK ("channel_updates"."status" in ('pending', 'processing', 'processed', 'failed', 'dead')),
	CONSTRAINT "channel_updates_attempts_check" CHECK ("channel_updates"."attempts" >= 0 and "channel_updates"."max_attempts" > 0 and "channel_updates"."attempts" <= "channel_updates"."max_attempts")
);
--> statement-breakpoint
ALTER TABLE "channel_updates" ADD CONSTRAINT "channel_updates_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_updates_provider_uidx" ON "channel_updates" USING btree ("shop_id","provider","external_update_id");--> statement-breakpoint
CREATE INDEX "channel_updates_ready_idx" ON "channel_updates" USING btree ("provider","status","next_attempt_at","received_at");--> statement-breakpoint
CREATE INDEX "channel_updates_shop_received_idx" ON "channel_updates" USING btree ("shop_id","received_at");--> statement-breakpoint
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'viberimenya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "channel_updates" TO viberimenya_app;
  END IF;
END
$grant$;
