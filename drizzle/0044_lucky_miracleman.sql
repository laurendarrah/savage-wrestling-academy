CREATE TABLE `installment_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`invoice_id` text,
	`payment_number` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`expected_cents` integer NOT NULL,
	`livemode` integer NOT NULL,
	`received_at` text NOT NULL,
	CONSTRAINT "installment_payment_amounts" CHECK("installment_payments"."amount_cents" >= 0 AND "installment_payments"."expected_cents" >= 0),
	CONSTRAINT "installment_payment_livemode" CHECK("installment_payments"."livemode" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `installment_payments_order` ON `installment_payments` (`order_id`,`payment_number`);--> statement-breakpoint
CREATE TABLE `signature_carryovers` (
	`signature_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`reason` text NOT NULL,
	`carried_by` text NOT NULL,
	`carried_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signature_carryovers_user` ON `signature_carryovers` (`user_id`,`wrestler_id`);