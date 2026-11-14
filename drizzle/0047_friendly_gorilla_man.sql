PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_subscriptions` (
	`order_id` text PRIMARY KEY NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`payments_made` integer NOT NULL,
	`payments_total` integer,
	`term_start` text NOT NULL,
	`term_end` text,
	`paid_through` text NOT NULL,
	`cancel_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "subscriptions_status" CHECK("__new_subscriptions"."status" IN ('active','past_due','canceled','completed','paused')),
	CONSTRAINT "subscriptions_payments" CHECK("__new_subscriptions"."payments_made" >= 0 AND ("__new_subscriptions"."payments_total" IS NULL OR "__new_subscriptions"."payments_made" <= "__new_subscriptions"."payments_total"))
);
--> statement-breakpoint
INSERT INTO `__new_subscriptions`("order_id", "stripe_subscription_id", "status", "payments_made", "payments_total", "term_start", "term_end", "paid_through", "cancel_at", "updated_at") SELECT "order_id", "stripe_subscription_id", "status", "payments_made", "payments_total", "term_start", "term_end", "paid_through", "cancel_at", "updated_at" FROM `subscriptions`;--> statement-breakpoint
DROP TABLE `subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_subscriptions` RENAME TO `subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe` ON `subscriptions` (`stripe_subscription_id`);