CREATE TABLE `financial_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`entry_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`category` text NOT NULL,
	`note` text NOT NULL,
	`receipt` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	CONSTRAINT "financial_entry_kind" CHECK("financial_entries"."kind" IN ('expense','income')),
	CONSTRAINT "financial_entry_amount" CHECK("financial_entries"."amount_cents" BETWEEN 1 AND 100000000)
);
--> statement-breakpoint
CREATE INDEX `financial_entries_date` ON `financial_entries` (`entry_date`);