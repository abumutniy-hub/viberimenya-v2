-- VYBERI MENYA v2
-- Canonical production schema baseline
-- Generated from a schema-only production pg_dump.

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
SET idle_in_transaction_session_timeout = 0;
--> statement-breakpoint
SET client_encoding = 'UTF8';
--> statement-breakpoint
SET standard_conforming_strings = on;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', false);
--> statement-breakpoint
SET check_function_bodies = false;
--> statement-breakpoint
SET xmloption = content;
--> statement-breakpoint
SET client_min_messages = warning;
--> statement-breakpoint
SET row_security = off;
--> statement-breakpoint
--
-- Name: bonus_transaction_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."bonus_transaction_type" AS ENUM (
    'earn',
    'spend',
    'manual_add',
    'manual_remove',
    'expire'
);
--> statement-breakpoint
--
-- Name: chat_message_author_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."chat_message_author_type" AS ENUM (
    'customer',
    'staff',
    'system'
);
--> statement-breakpoint
--
-- Name: delivery_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."delivery_type" AS ENUM (
    'delivery',
    'pickup'
);
--> statement-breakpoint
--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."order_status" AS ENUM (
    'new',
    'confirmed',
    'assembling',
    'ready',
    'assigned_courier',
    'delivering',
    'delivered',
    'cancelled',
    'problem'
);
--> statement-breakpoint
--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."payment_method" AS ENUM (
    'cash_on_delivery',
    'transfer_after_confirm',
    'online_card',
    'sbp'
);
--> statement-breakpoint
--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."payment_status" AS ENUM (
    'not_required',
    'pending',
    'paid',
    'failed',
    'refunded',
    'cancelled'
);
--> statement-breakpoint
--
-- Name: product_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."product_status" AS ENUM (
    'draft',
    'active',
    'hidden',
    'archived'
);
--> statement-breakpoint
--
-- Name: shop_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."shop_status" AS ENUM (
    'active',
    'paused',
    'disabled'
);
--> statement-breakpoint
--
-- Name: shop_user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."shop_user_role" AS ENUM (
    'owner',
    'admin',
    'manager',
    'florist',
    'courier'
);
--> statement-breakpoint
--
-- Name: user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."user_status" AS ENUM (
    'active',
    'blocked',
    'deleted'
);
--> statement-breakpoint
--
-- Name: create_customer_telegram_notification_from_staff_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."create_customer_telegram_notification_from_staff_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  customer_telegram_id varchar(80);
  base_payload jsonb := '{}'::jsonb;
  parsed_payload jsonb;
BEGIN
  IF NEW.channel <> 'telegram' THEN
    RETURN NEW;
  END IF;

  IF NEW.recipient_type <> 'staff' THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('order_created', 'order_confirmed', 'payment_link_added', 'order_paid') THEN
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

  IF jsonb_typeof(NEW.payload) = 'object' THEN
    base_payload := NEW.payload;
  ELSIF jsonb_typeof(NEW.payload) = 'string' THEN
    BEGIN
      parsed_payload := (NEW.payload #>> '{}')::jsonb;

      IF jsonb_typeof(parsed_payload) = 'object' THEN
        base_payload := parsed_payload;
      END IF;
    EXCEPTION WHEN others THEN
      base_payload := '{}'::jsonb;
    END;
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
    base_payload || jsonb_build_object('audience', 'customer'),
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$;
--> statement-breakpoint
SET default_tablespace = '';
--> statement-breakpoint
SET default_table_access_method = "heap";
--> statement-breakpoint
--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."admin_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" character varying(32),
    "event_type" character varying(100) NOT NULL,
    "entity_type" character varying(80),
    "entity_id" "text",
    "severity" character varying(20) DEFAULT 'info'::character varying NOT NULL,
    "ip" character varying(80),
    "user_agent" "text",
    "summary" character varying(500) NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_audit_log_severity_check" CHECK ((("severity")::"text" = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::"text"[])))
);
--> statement-breakpoint
--
-- Name: admin_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."admin_sessions" (
    "token" "text" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "ip" "text",
    "user_agent" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: bonus_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bonus_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "type" "public"."bonus_transaction_type" NOT NULL,
    "amount" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "slug" character varying(120) NOT NULL,
    "name" character varying(160) NOT NULL,
    "description" "text",
    "image_url" "text",
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "author_type" "public"."chat_message_author_type" NOT NULL,
    "author_user_id" "uuid",
    "author_customer_id" "uuid",
    "text" "text" NOT NULL,
    "attachment_url" "text",
    "is_read_by_staff" boolean DEFAULT false NOT NULL,
    "is_read_by_customer" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "message_scope" character varying(40) DEFAULT 'customer'::character varying NOT NULL
);
--> statement-breakpoint
--
-- Name: customer_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."customer_addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "city" character varying(120),
    "street" character varying(255),
    "house" character varying(60),
    "apartment" character varying(60),
    "entrance" character varying(60),
    "floor" character varying(60),
    "comment" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: customer_channel_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."customer_channel_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "provider" character varying(40) NOT NULL,
    "provider_user_id" character varying(160) NOT NULL,
    "provider_username" character varying(160),
    "provider_display_name" character varying(220),
    "is_active" boolean DEFAULT true NOT NULL,
    "linked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: customer_link_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."customer_link_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "provider" character varying(40) NOT NULL,
    "purpose" character varying(80) NOT NULL,
    "token" character varying(180) NOT NULL,
    "status" character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: customer_login_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."customer_login_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "phone" character varying(32) NOT NULL,
    "code" character varying(12) NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "consumed_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: customer_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."customer_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "user_agent" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "phone" character varying(32) NOT NULL,
    "name" character varying(160),
    "email" character varying(255),
    "telegram_username" character varying(120),
    "bonus_balance" integer DEFAULT 0 NOT NULL,
    "total_orders" integer DEFAULT 0 NOT NULL,
    "total_spent" integer DEFAULT 0 NOT NULL,
    "last_order_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: delivery_intervals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."delivery_intervals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "name" character varying(80) NOT NULL,
    "starts_at" character varying(8) NOT NULL,
    "ends_at" character varying(8) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: delivery_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."delivery_zones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "name" character varying(160) NOT NULL,
    "description" "text",
    "price" integer DEFAULT 0 NOT NULL,
    "free_from_amount" integer,
    "is_express_available" boolean DEFAULT false NOT NULL,
    "express_price" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: employee_link_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."employee_link_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" character varying(50) DEFAULT 'telegram'::character varying NOT NULL,
    "purpose" character varying(80) DEFAULT 'connect_staff'::character varying NOT NULL,
    "token" character varying(255) NOT NULL,
    "status" character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "type" character varying(80) NOT NULL,
    "channel" character varying(40) DEFAULT 'telegram'::character varying NOT NULL,
    "recipient_type" character varying(40) DEFAULT 'staff'::character varying NOT NULL,
    "recipient_telegram_id" character varying(80),
    "status" character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: order_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "is_closed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "product_name" character varying(255) NOT NULL,
    "product_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "price" integer DEFAULT 0 NOT NULL,
    "total" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "from_status" "public"."order_status",
    "to_status" "public"."order_status" NOT NULL,
    "changed_by_user_id" "uuid",
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "order_number" character varying(40) NOT NULL,
    "status" "public"."order_status" DEFAULT 'new'::"public"."order_status" NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "payment_method" "public"."payment_method" DEFAULT 'transfer_after_confirm'::"public"."payment_method" NOT NULL,
    "delivery_type" "public"."delivery_type" DEFAULT 'delivery'::"public"."delivery_type" NOT NULL,
    "delivery_zone_id" "uuid",
    "delivery_interval_id" "uuid",
    "delivery_date" timestamp with time zone,
    "delivery_address_text" "text",
    "delivery_comment" "text",
    "recipient_name" character varying(160),
    "recipient_phone" character varying(32),
    "customer_comment" "text",
    "internal_comment" "text",
    "contact_preference" character varying(80) DEFAULT 'call_or_message'::character varying NOT NULL,
    "subtotal" integer DEFAULT 0 NOT NULL,
    "discount_total" integer DEFAULT 0 NOT NULL,
    "delivery_price" integer DEFAULT 0 NOT NULL,
    "bonus_spent" integer DEFAULT 0 NOT NULL,
    "bonus_earned" integer DEFAULT 0 NOT NULL,
    "total" integer DEFAULT 0 NOT NULL,
    "manager_id" "uuid",
    "florist_id" "uuid",
    "courier_id" "uuid",
    "tracking_token" character varying(120) NOT NULL,
    "bouquet_photo_url" "text",
    "delivered_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "provider" character varying(80) DEFAULT 'manual'::character varying NOT NULL,
    "provider_payment_id" character varying(255),
    "method" "public"."payment_method" NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "amount" integer NOT NULL,
    "currency" character varying(8) DEFAULT 'RUB'::character varying NOT NULL,
    "payment_url" "text",
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "alt" character varying(255),
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_main" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "slug" character varying(160) NOT NULL,
    "name" character varying(255) NOT NULL,
    "short_description" "text",
    "description" "text",
    "composition" "text",
    "care_text" "text",
    "price" integer DEFAULT 0 NOT NULL,
    "old_price" integer,
    "cost_price" integer,
    "stock_quantity" integer,
    "is_stock_visible" boolean DEFAULT false NOT NULL,
    "status" "public"."product_status" DEFAULT 'draft'::"public"."product_status" NOT NULL,
    "is_featured" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: promocodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."promocodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "code" character varying(80) NOT NULL,
    "description" "text",
    "discount_type" character varying(40) DEFAULT 'percent'::character varying NOT NULL,
    "discount_value" integer DEFAULT 0 NOT NULL,
    "min_order_amount" integer,
    "usage_limit" integer,
    "used_count" integer DEFAULT 0 NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "order_id" "uuid",
    "rating" integer NOT NULL,
    "text" "text",
    "author_name" character varying(160),
    "is_published" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: shop_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shop_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "domain" character varying(255) NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: shop_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shop_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "logo_url" "text",
    "primary_color" character varying(32) DEFAULT '#7c3aed'::character varying NOT NULL,
    "accent_color" character varying(32) DEFAULT '#f43f5e'::character varying NOT NULL,
    "phone" character varying(32),
    "whatsapp" character varying(80),
    "telegram" character varying(80),
    "instagram" "text",
    "address" "text",
    "work_hours" character varying(160),
    "hero_title" character varying(255) DEFAULT 'Цветы, которые говорят за вас'::character varying NOT NULL,
    "hero_subtitle" "text",
    "hero_image_url" "text",
    "is_online_payment_enabled" boolean DEFAULT false NOT NULL,
    "is_cash_payment_enabled" boolean DEFAULT true NOT NULL,
    "is_transfer_payment_enabled" boolean DEFAULT true NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: shop_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shop_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."shop_user_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" character varying(80) NOT NULL,
    "name" character varying(160) NOT NULL,
    "legal_name" character varying(255),
    "status" "public"."shop_status" DEFAULT 'active'::"public"."shop_status" NOT NULL,
    "timezone" character varying(80) DEFAULT 'Europe/Moscow'::character varying NOT NULL,
    "currency" character varying(8) DEFAULT 'RUB'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: telegram_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."telegram_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "customer_id" "uuid",
    "telegram_id" character varying(80) NOT NULL,
    "username" character varying(120),
    "first_name" character varying(160),
    "last_name" character varying(160),
    "is_active" boolean DEFAULT true NOT NULL,
    "linked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notifications_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
--
-- Name: telegram_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."telegram_cart_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "telegram_chat_id" bigint NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "telegram_cart_items_quantity_check" CHECK (("quantity" > 0))
);
--> statement-breakpoint
--
-- Name: telegram_checkout_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."telegram_checkout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "telegram_chat_id" bigint NOT NULL,
    "step" character varying(80) NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" character varying(32),
    "email" character varying(255),
    "name" character varying(160),
    "password_hash" "text",
    "status" "public"."user_status" DEFAULT 'active'::"public"."user_status" NOT NULL,
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
--> statement-breakpoint
--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: admin_sessions admin_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("token");
--> statement-breakpoint
--
-- Name: bonus_transactions bonus_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bonus_transactions"
    ADD CONSTRAINT "bonus_transactions_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: customer_addresses customer_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: customer_channel_links customer_channel_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_channel_links"
    ADD CONSTRAINT "customer_channel_links_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: customer_link_tokens customer_link_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_link_tokens"
    ADD CONSTRAINT "customer_link_tokens_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: customer_link_tokens customer_link_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_link_tokens"
    ADD CONSTRAINT "customer_link_tokens_token_key" UNIQUE ("token");
--> statement-breakpoint
--
-- Name: customer_login_codes customer_login_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_login_codes"
    ADD CONSTRAINT "customer_login_codes_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: customer_sessions customer_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_sessions"
    ADD CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: customer_sessions customer_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_sessions"
    ADD CONSTRAINT "customer_sessions_token_key" UNIQUE ("token");
--> statement-breakpoint
--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: delivery_intervals delivery_intervals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."delivery_intervals"
    ADD CONSTRAINT "delivery_intervals_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: delivery_zones delivery_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: employee_link_tokens employee_link_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."employee_link_tokens"
    ADD CONSTRAINT "employee_link_tokens_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: employee_link_tokens employee_link_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."employee_link_tokens"
    ADD CONSTRAINT "employee_link_tokens_token_key" UNIQUE ("token");
--> statement-breakpoint
--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: order_chats order_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_chats"
    ADD CONSTRAINT "order_chats_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_status_history"
    ADD CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: promocodes promocodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promocodes"
    ADD CONSTRAINT "promocodes_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: shop_domains shop_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_domains"
    ADD CONSTRAINT "shop_domains_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: shop_settings shop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_settings"
    ADD CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: shop_users shop_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_users"
    ADD CONSTRAINT "shop_users_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: telegram_accounts telegram_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_accounts"
    ADD CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: telegram_cart_items telegram_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_cart_items"
    ADD CONSTRAINT "telegram_cart_items_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: telegram_cart_items telegram_cart_items_shop_id_telegram_chat_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_cart_items"
    ADD CONSTRAINT "telegram_cart_items_shop_id_telegram_chat_id_product_id_key" UNIQUE ("shop_id", "telegram_chat_id", "product_id");
--> statement-breakpoint
--
-- Name: telegram_checkout_sessions telegram_checkout_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_checkout_sessions"
    ADD CONSTRAINT "telegram_checkout_sessions_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: telegram_checkout_sessions telegram_checkout_sessions_shop_id_telegram_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_checkout_sessions"
    ADD CONSTRAINT "telegram_checkout_sessions_shop_id_telegram_chat_id_key" UNIQUE ("shop_id", "telegram_chat_id");
--> statement-breakpoint
--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
--
-- Name: admin_audit_log_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "admin_audit_log_actor_idx" ON "public"."admin_audit_log" USING "btree" ("shop_id", "actor_user_id", "created_at" DESC);
--> statement-breakpoint
--
-- Name: admin_audit_log_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "admin_audit_log_severity_idx" ON "public"."admin_audit_log" USING "btree" ("shop_id", "severity", "created_at" DESC);
--> statement-breakpoint
--
-- Name: admin_audit_log_shop_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "admin_audit_log_shop_created_idx" ON "public"."admin_audit_log" USING "btree" ("shop_id", "created_at" DESC);
--> statement-breakpoint
--
-- Name: admin_audit_log_shop_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "admin_audit_log_shop_event_idx" ON "public"."admin_audit_log" USING "btree" ("shop_id", "event_type", "created_at" DESC);
--> statement-breakpoint
--
-- Name: bonus_transactions_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bonus_transactions_customer_idx" ON "public"."bonus_transactions" USING "btree" ("customer_id");
--> statement-breakpoint
--
-- Name: categories_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "categories_shop_idx" ON "public"."categories" USING "btree" ("shop_id");
--> statement-breakpoint
--
-- Name: categories_shop_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "categories_shop_slug_uidx" ON "public"."categories" USING "btree" ("shop_id", "slug");
--> statement-breakpoint
--
-- Name: chat_messages_chat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_messages_chat_idx" ON "public"."chat_messages" USING "btree" ("chat_id");
--> statement-breakpoint
--
-- Name: chat_messages_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_messages_order_idx" ON "public"."chat_messages" USING "btree" ("order_id");
--> statement-breakpoint
--
-- Name: chat_messages_order_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_messages_order_scope_idx" ON "public"."chat_messages" USING "btree" ("order_id", "message_scope", "created_at");
--> statement-breakpoint
--
-- Name: customer_addresses_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_addresses_customer_idx" ON "public"."customer_addresses" USING "btree" ("customer_id");
--> statement-breakpoint
--
-- Name: customer_channel_links_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_channel_links_customer_idx" ON "public"."customer_channel_links" USING "btree" ("shop_id", "customer_id");
--> statement-breakpoint
--
-- Name: customer_channel_links_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "customer_channel_links_provider_uidx" ON "public"."customer_channel_links" USING "btree" ("shop_id", "provider", "provider_user_id");
--> statement-breakpoint
--
-- Name: customer_link_tokens_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_link_tokens_customer_idx" ON "public"."customer_link_tokens" USING "btree" ("shop_id", "customer_id");
--> statement-breakpoint
--
-- Name: customer_link_tokens_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_link_tokens_lookup_idx" ON "public"."customer_link_tokens" USING "btree" ("provider", "purpose", "token", "status", "expires_at");
--> statement-breakpoint
--
-- Name: customer_login_codes_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_login_codes_customer_idx" ON "public"."customer_login_codes" USING "btree" ("customer_id");
--> statement-breakpoint
--
-- Name: customer_login_codes_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_login_codes_phone_idx" ON "public"."customer_login_codes" USING "btree" ("shop_id", "phone", "created_at" DESC);
--> statement-breakpoint
--
-- Name: customer_sessions_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_sessions_customer_idx" ON "public"."customer_sessions" USING "btree" ("customer_id");
--> statement-breakpoint
--
-- Name: customer_sessions_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customer_sessions_token_idx" ON "public"."customer_sessions" USING "btree" ("token");
--> statement-breakpoint
--
-- Name: customers_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customers_shop_idx" ON "public"."customers" USING "btree" ("shop_id");
--> statement-breakpoint
--
-- Name: customers_shop_phone_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "customers_shop_phone_uidx" ON "public"."customers" USING "btree" ("shop_id", "phone");
--> statement-breakpoint
--
-- Name: delivery_intervals_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "delivery_intervals_shop_idx" ON "public"."delivery_intervals" USING "btree" ("shop_id");
--> statement-breakpoint
--
-- Name: delivery_zones_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "delivery_zones_shop_idx" ON "public"."delivery_zones" USING "btree" ("shop_id");
--> statement-breakpoint
--
-- Name: employee_link_tokens_shop_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "employee_link_tokens_shop_user_idx" ON "public"."employee_link_tokens" USING "btree" ("shop_id", "user_id");
--> statement-breakpoint
--
-- Name: employee_link_tokens_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "employee_link_tokens_token_idx" ON "public"."employee_link_tokens" USING "btree" ("token");
--> statement-breakpoint
--
-- Name: idx_admin_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_admin_sessions_expires_at" ON "public"."admin_sessions" USING "btree" ("expires_at");
--> statement-breakpoint
--
-- Name: idx_admin_sessions_shop_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_admin_sessions_shop_user_active" ON "public"."admin_sessions" USING "btree" ("shop_id", "user_id") WHERE ("revoked_at" IS NULL);
--> statement-breakpoint
--
-- Name: idx_admin_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_admin_sessions_user_id" ON "public"."admin_sessions" USING "btree" ("user_id");
--> statement-breakpoint
--
-- Name: idx_telegram_cart_items_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_telegram_cart_items_chat" ON "public"."telegram_cart_items" USING "btree" ("shop_id", "telegram_chat_id");
--> statement-breakpoint
--
-- Name: idx_telegram_checkout_sessions_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_telegram_checkout_sessions_chat" ON "public"."telegram_checkout_sessions" USING "btree" ("shop_id", "telegram_chat_id");
--> statement-breakpoint
--
-- Name: notification_events_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_events_order_idx" ON "public"."notification_events" USING "btree" ("order_id");
--> statement-breakpoint
--
-- Name: notification_events_shop_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_events_shop_status_idx" ON "public"."notification_events" USING "btree" ("shop_id", "status", "created_at");
--> statement-breakpoint
--
-- Name: notification_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_events_type_idx" ON "public"."notification_events" USING "btree" ("type");
--> statement-breakpoint
--
-- Name: order_chats_order_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "order_chats_order_uidx" ON "public"."order_chats" USING "btree" ("order_id");
--> statement-breakpoint
--
-- Name: order_items_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "order_items_order_idx" ON "public"."order_items" USING "btree" ("order_id");
--> statement-breakpoint
--
-- Name: order_status_history_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "order_status_history_order_idx" ON "public"."order_status_history" USING "btree" ("order_id");
--> statement-breakpoint
--
-- Name: orders_courier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "orders_courier_idx" ON "public"."orders" USING "btree" ("courier_id");
--> statement-breakpoint
--
-- Name: orders_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "orders_customer_idx" ON "public"."orders" USING "btree" ("customer_id");
--> statement-breakpoint
--
-- Name: orders_shop_delivery_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "orders_shop_delivery_date_idx" ON "public"."orders" USING "btree" ("shop_id", "delivery_date");
--> statement-breakpoint
--
-- Name: orders_shop_order_number_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "orders_shop_order_number_uidx" ON "public"."orders" USING "btree" ("shop_id", "order_number");
--> statement-breakpoint
--
-- Name: orders_shop_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "orders_shop_status_idx" ON "public"."orders" USING "btree" ("shop_id", "status");
--> statement-breakpoint
--
-- Name: orders_tracking_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "orders_tracking_token_uidx" ON "public"."orders" USING "btree" ("tracking_token");
--> statement-breakpoint
--
-- Name: payments_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "payments_order_idx" ON "public"."payments" USING "btree" ("order_id");
--> statement-breakpoint
--
-- Name: payments_shop_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "payments_shop_status_idx" ON "public"."payments" USING "btree" ("shop_id", "status");
--> statement-breakpoint
--
-- Name: product_images_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "product_images_product_idx" ON "public"."product_images" USING "btree" ("product_id");
--> statement-breakpoint
--
-- Name: products_shop_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "products_shop_category_idx" ON "public"."products" USING "btree" ("shop_id", "category_id");
--> statement-breakpoint
--
-- Name: products_shop_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "products_shop_slug_uidx" ON "public"."products" USING "btree" ("shop_id", "slug");
--> statement-breakpoint
--
-- Name: products_shop_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "products_shop_status_idx" ON "public"."products" USING "btree" ("shop_id", "status");
--> statement-breakpoint
--
-- Name: promocodes_shop_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "promocodes_shop_code_uidx" ON "public"."promocodes" USING "btree" ("shop_id", "code");
--> statement-breakpoint
--
-- Name: promocodes_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "promocodes_shop_idx" ON "public"."promocodes" USING "btree" ("shop_id");
--> statement-breakpoint
--
-- Name: reviews_shop_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_shop_published_idx" ON "public"."reviews" USING "btree" ("shop_id", "is_published");
--> statement-breakpoint
--
-- Name: shop_domains_domain_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "shop_domains_domain_uidx" ON "public"."shop_domains" USING "btree" ("domain");
--> statement-breakpoint
--
-- Name: shop_domains_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shop_domains_shop_idx" ON "public"."shop_domains" USING "btree" ("shop_id");
--> statement-breakpoint
--
-- Name: shop_settings_shop_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "shop_settings_shop_uidx" ON "public"."shop_settings" USING "btree" ("shop_id");
--> statement-breakpoint
--
-- Name: shop_users_shop_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shop_users_shop_role_idx" ON "public"."shop_users" USING "btree" ("shop_id", "role");
--> statement-breakpoint
--
-- Name: shop_users_shop_user_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "shop_users_shop_user_uidx" ON "public"."shop_users" USING "btree" ("shop_id", "user_id");
--> statement-breakpoint
--
-- Name: shops_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "shops_slug_uidx" ON "public"."shops" USING "btree" ("slug");
--> statement-breakpoint
--
-- Name: telegram_accounts_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "telegram_accounts_customer_idx" ON "public"."telegram_accounts" USING "btree" ("customer_id");
--> statement-breakpoint
--
-- Name: telegram_accounts_shop_telegram_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "telegram_accounts_shop_telegram_uidx" ON "public"."telegram_accounts" USING "btree" ("shop_id", "telegram_id");
--> statement-breakpoint
--
-- Name: telegram_accounts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "telegram_accounts_user_idx" ON "public"."telegram_accounts" USING "btree" ("user_id");
--> statement-breakpoint
--
-- Name: users_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "users_email_uidx" ON "public"."users" USING "btree" ("email");
--> statement-breakpoint
--
-- Name: users_phone_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "users_phone_uidx" ON "public"."users" USING "btree" ("phone");
--> statement-breakpoint
--
-- Name: notification_events notification_events_customer_copy_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "notification_events_customer_copy_trg" AFTER INSERT ON "public"."notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."create_customer_telegram_notification_from_staff_event"();
--> statement-breakpoint
--
-- Name: admin_audit_log admin_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: admin_audit_log admin_audit_log_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: admin_sessions admin_sessions_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: admin_sessions admin_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: bonus_transactions bonus_transactions_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bonus_transactions"
    ADD CONSTRAINT "bonus_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: bonus_transactions bonus_transactions_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bonus_transactions"
    ADD CONSTRAINT "bonus_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: bonus_transactions bonus_transactions_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bonus_transactions"
    ADD CONSTRAINT "bonus_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: categories categories_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: chat_messages chat_messages_author_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_author_customer_id_customers_id_fk" FOREIGN KEY ("author_customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: chat_messages chat_messages_author_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: chat_messages chat_messages_chat_id_order_chats_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_chat_id_order_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."order_chats"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: chat_messages chat_messages_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: chat_messages chat_messages_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_addresses customer_addresses_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_addresses customer_addresses_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_channel_links customer_channel_links_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_channel_links"
    ADD CONSTRAINT "customer_channel_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_channel_links customer_channel_links_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_channel_links"
    ADD CONSTRAINT "customer_channel_links_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_link_tokens customer_link_tokens_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_link_tokens"
    ADD CONSTRAINT "customer_link_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_link_tokens customer_link_tokens_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_link_tokens"
    ADD CONSTRAINT "customer_link_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_link_tokens customer_link_tokens_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_link_tokens"
    ADD CONSTRAINT "customer_link_tokens_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_login_codes customer_login_codes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_login_codes"
    ADD CONSTRAINT "customer_login_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_login_codes customer_login_codes_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_login_codes"
    ADD CONSTRAINT "customer_login_codes_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_sessions customer_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_sessions"
    ADD CONSTRAINT "customer_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customer_sessions customer_sessions_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customer_sessions"
    ADD CONSTRAINT "customer_sessions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customers customers_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: customers customers_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: delivery_intervals delivery_intervals_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."delivery_intervals"
    ADD CONSTRAINT "delivery_intervals_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: delivery_zones delivery_zones_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: employee_link_tokens employee_link_tokens_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."employee_link_tokens"
    ADD CONSTRAINT "employee_link_tokens_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: employee_link_tokens employee_link_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."employee_link_tokens"
    ADD CONSTRAINT "employee_link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: notification_events notification_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: notification_events notification_events_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: order_chats order_chats_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_chats"
    ADD CONSTRAINT "order_chats_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: order_chats order_chats_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_chats"
    ADD CONSTRAINT "order_chats_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: order_items order_items_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: order_items order_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: order_items order_items_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: order_status_history order_status_history_changed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_status_history"
    ADD CONSTRAINT "order_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: order_status_history order_status_history_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_status_history"
    ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: order_status_history order_status_history_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_status_history"
    ADD CONSTRAINT "order_status_history_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: orders orders_courier_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_courier_id_users_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: orders orders_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: orders orders_delivery_interval_id_delivery_intervals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_delivery_interval_id_delivery_intervals_id_fk" FOREIGN KEY ("delivery_interval_id") REFERENCES "public"."delivery_intervals"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: orders orders_delivery_zone_id_delivery_zones_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: orders orders_florist_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_florist_id_users_id_fk" FOREIGN KEY ("florist_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: orders orders_manager_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: orders orders_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: payments payments_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: payments payments_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: product_images product_images_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: product_images product_images_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: products products_category_id_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: products products_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: promocodes promocodes_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promocodes"
    ADD CONSTRAINT "promocodes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: reviews reviews_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: reviews reviews_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;
--> statement-breakpoint
--
-- Name: reviews reviews_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: shop_domains shop_domains_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_domains"
    ADD CONSTRAINT "shop_domains_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: shop_settings shop_settings_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_settings"
    ADD CONSTRAINT "shop_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: shop_users shop_users_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_users"
    ADD CONSTRAINT "shop_users_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: shop_users shop_users_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_users"
    ADD CONSTRAINT "shop_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: telegram_accounts telegram_accounts_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_accounts"
    ADD CONSTRAINT "telegram_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: telegram_accounts telegram_accounts_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_accounts"
    ADD CONSTRAINT "telegram_accounts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: telegram_accounts telegram_accounts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_accounts"
    ADD CONSTRAINT "telegram_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: telegram_cart_items telegram_cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_cart_items"
    ADD CONSTRAINT "telegram_cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: telegram_cart_items telegram_cart_items_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_cart_items"
    ADD CONSTRAINT "telegram_cart_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
--
-- Name: telegram_checkout_sessions telegram_checkout_sessions_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."telegram_checkout_sessions"
    ADD CONSTRAINT "telegram_checkout_sessions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;
--> statement-breakpoint
