CREATE TABLE `payment_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`dispute_id` text NOT NULL,
	`order_id` text NOT NULL,
	`payment_intent` text NOT NULL,
	`charge_id` text,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reason` text,
	`status` text,
	`occurred_at` text NOT NULL,
	`livemode` integer NOT NULL,
	`received_at` text NOT NULL,
	CONSTRAINT "payment_dispute_kind" CHECK("payment_disputes"."kind" IN ('created','funds_withdrawn','funds_reinstated','closed')),
	CONSTRAINT "payment_dispute_amount" CHECK("payment_disputes"."amount_cents" >= 0),
	CONSTRAINT "payment_dispute_livemode" CHECK("payment_disputes"."livemode" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `payment_disputes_order` ON `payment_disputes` (`order_id`);--> statement-breakpoint
CREATE INDEX `payment_disputes_dispute` ON `payment_disputes` (`dispute_id`,`occurred_at`);