CREATE TABLE `coach_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`coach_email` text NOT NULL,
	`coach_name` text NOT NULL,
	`paid_on` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`period_from` text,
	`period_to` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	CONSTRAINT "coach_payment_amount" CHECK("coach_payments"."amount_cents" BETWEEN 1 AND 100000000),
	CONSTRAINT "coach_payment_method" CHECK("coach_payments"."method" IN ('check','cash','bank','zelle','venmo','other'))
);
--> statement-breakpoint
CREATE INDEX `coach_payments_coach` ON `coach_payments` (`coach_email`,`paid_on`);--> statement-breakpoint
CREATE INDEX `coach_payments_paid` ON `coach_payments` (`paid_on`);