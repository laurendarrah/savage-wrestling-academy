CREATE TABLE `subscriptions` (
	`order_id` text PRIMARY KEY NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`payments_made` integer NOT NULL,
	`payments_total` integer NOT NULL,
	`term_start` text NOT NULL,
	`term_end` text NOT NULL,
	`paid_through` text NOT NULL,
	`cancel_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "subscriptions_status" CHECK("subscriptions"."status" IN ('active','past_due','canceled','completed')),
	CONSTRAINT "subscriptions_payments" CHECK("subscriptions"."payments_made" >= 0 AND "subscriptions"."payments_made" <= "subscriptions"."payments_total")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe` ON `subscriptions` (`stripe_subscription_id`);