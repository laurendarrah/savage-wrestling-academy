CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`kind` text NOT NULL,
	`program` text,
	`item_id` text NOT NULL,
	`item_label` text NOT NULL,
	`dates` text NOT NULL,
	`base_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`pricing` text NOT NULL,
	`terms_accepted` text NOT NULL,
	`status` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`stripe_session_id` text,
	`stripe_payment_intent` text,
	`livemode` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`paid_at` text,
	`term_start` text,
	`term_end` text,
	CONSTRAINT "orders_kind" CHECK("orders"."kind" IN ('walkin','annual','monthly','event','live')),
	CONSTRAINT "orders_status" CHECK("orders"."status" IN ('pending','paid','expired','canceled','refunded')),
	CONSTRAINT "orders_amounts" CHECK("orders"."amount_cents" >= 0 AND "orders"."base_cents" >= 0 AND "orders"."discount_cents" >= 0 AND "orders"."amount_cents" = "orders"."base_cents" - "orders"."discount_cents"),
	CONSTRAINT "orders_livemode" CHECK("orders"."livemode" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_wrestler_status` ON `orders` (`user_id`,`wrestler_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_stripe_session` ON `orders` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_open_dedupe` ON `orders` (`dedupe_key`) WHERE "orders"."status" IN ('pending','paid');--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`order_id` text,
	`outcome` text NOT NULL,
	`received_at` text NOT NULL
);
