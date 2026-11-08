PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cash_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`kind` text NOT NULL,
	`program` text,
	`item_id` text NOT NULL,
	`item_label` text NOT NULL,
	`session_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`base_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`pricing` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`order_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`canceled_at` text,
	`canceled_by` text,
	`cancel_reason` text,
	`dates` text DEFAULT '[]' NOT NULL,
	CONSTRAINT "cash_bookings_kind" CHECK("__new_cash_bookings"."kind" IN ('walkin','live','event')),
	CONSTRAINT "cash_bookings_status" CHECK("__new_cash_bookings"."status" IN ('due','paid','canceled')),
	CONSTRAINT "cash_bookings_amounts" CHECK("__new_cash_bookings"."amount_cents" >= 0 AND "__new_cash_bookings"."base_cents" >= 0 AND "__new_cash_bookings"."discount_cents" >= 0 AND "__new_cash_bookings"."amount_cents" = "__new_cash_bookings"."base_cents" - "__new_cash_bookings"."discount_cents")
);
--> statement-breakpoint
INSERT INTO `__new_cash_bookings`("id", "user_id", "email", "wrestler_id", "wrestler_name", "kind", "program", "item_id", "item_label", "session_date", "start_time", "end_time", "base_cents", "discount_cents", "amount_cents", "pricing", "dedupe_key", "status", "order_id", "created_at", "updated_at", "canceled_at", "canceled_by", "cancel_reason", "dates") SELECT "id", "user_id", "email", "wrestler_id", "wrestler_name", "kind", "program", "item_id", "item_label", "session_date", "start_time", "end_time", "base_cents", "discount_cents", "amount_cents", "pricing", "dedupe_key", "status", "order_id", "created_at", "updated_at", "canceled_at", "canceled_by", "cancel_reason", json_array("session_date") FROM `cash_bookings`;--> statement-breakpoint
DROP TABLE `cash_bookings`;--> statement-breakpoint
ALTER TABLE `__new_cash_bookings` RENAME TO `cash_bookings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cash_bookings_open` ON `cash_bookings` (`dedupe_key`) WHERE "cash_bookings"."status" IN ('due','paid');--> statement-breakpoint
CREATE INDEX `cash_bookings_status_date` ON `cash_bookings` (`status`,`session_date`);--> statement-breakpoint
CREATE INDEX `cash_bookings_user` ON `cash_bookings` (`user_id`);--> statement-breakpoint
CREATE INDEX `cash_bookings_session` ON `cash_bookings` (`kind`,`item_id`,`session_date`);