CREATE TABLE `academy_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_orders` (
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
	`source` text DEFAULT 'stripe' NOT NULL,
	CONSTRAINT "orders_kind" CHECK("__new_orders"."kind" IN ('walkin','annual','monthly','event','live','lesson')),
	CONSTRAINT "orders_status" CHECK("__new_orders"."status" IN ('pending','paid','expired','canceled','refunded')),
	CONSTRAINT "orders_amounts" CHECK("__new_orders"."amount_cents" >= 0 AND "__new_orders"."base_cents" >= 0 AND "__new_orders"."discount_cents" >= 0 AND "__new_orders"."amount_cents" = "__new_orders"."base_cents" - "__new_orders"."discount_cents"),
	CONSTRAINT "orders_livemode" CHECK("__new_orders"."livemode" IN (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "user_id", "email", "wrestler_id", "wrestler_name", "kind", "program", "item_id", "item_label", "dates", "base_cents", "discount_cents", "amount_cents", "currency", "pricing", "terms_accepted", "status", "dedupe_key", "stripe_session_id", "stripe_payment_intent", "livemode", "created_at", "updated_at", "paid_at", "term_start", "term_end", "source") SELECT "id", "user_id", "email", "wrestler_id", "wrestler_name", "kind", "program", "item_id", "item_label", "dates", "base_cents", "discount_cents", "amount_cents", "currency", "pricing", "terms_accepted", "status", "dedupe_key", "stripe_session_id", "stripe_payment_intent", "livemode", "created_at", "updated_at", "paid_at", "term_start", "term_end", "source" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_wrestler_status` ON `orders` (`user_id`,`wrestler_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_stripe_session` ON `orders` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_open_dedupe` ON `orders` (`dedupe_key`) WHERE "orders"."status" IN ('pending','paid');--> statement-breakpoint
ALTER TABLE `coach_openings` ADD `coach_email` text;