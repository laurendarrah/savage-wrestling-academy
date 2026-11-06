CREATE TABLE `financial_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`cents` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`voided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "financial_entry_kind" CHECK("financial_entries"."kind" IN ('income','expense')),
	CONSTRAINT "financial_entry_cents" CHECK("financial_entries"."cents" BETWEEN 1 AND 100000000)
);
--> statement-breakpoint
CREATE INDEX `financial_entry_date` ON `financial_entries` (`date`,`id`);