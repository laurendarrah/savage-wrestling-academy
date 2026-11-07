CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`payment_intent` text NOT NULL,
	`charge_id` text,
	`amount_cents` integer NOT NULL,
	`refunded_cents` integer NOT NULL,
	`refunded_at` text NOT NULL,
	`livemode` integer NOT NULL,
	`received_at` text NOT NULL,
	CONSTRAINT "payment_refund_amounts" CHECK("payment_refunds"."refunded_cents" >= 0 AND "payment_refunds"."refunded_cents" <= "payment_refunds"."amount_cents"),
	CONSTRAINT "payment_refund_livemode" CHECK("payment_refunds"."livemode" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `payment_refunds_intent` ON `payment_refunds` (`payment_intent`,`refunded_at`);--> statement-breakpoint
CREATE INDEX `payment_refunds_order` ON `payment_refunds` (`order_id`);--> statement-breakpoint
CREATE TABLE `stripe_fees` (
	`payment_intent` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`balance_transaction` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`fee_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`charged_at` text NOT NULL,
	`livemode` integer NOT NULL,
	`recorded_at` text NOT NULL,
	CONSTRAINT "stripe_fee_amounts" CHECK("stripe_fees"."fee_cents" >= 0 AND "stripe_fees"."amount_cents" >= 0),
	CONSTRAINT "stripe_fee_livemode" CHECK("stripe_fees"."livemode" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `stripe_fees_order` ON `stripe_fees` (`order_id`);--> statement-breakpoint
CREATE INDEX `stripe_fees_charged` ON `stripe_fees` (`charged_at`);