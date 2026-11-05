CREATE TABLE `membership_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`from_program` text NOT NULL,
	`to_program` text NOT NULL,
	`effective_date` text NOT NULL,
	`reason` text NOT NULL,
	`transferred_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transfers_order` ON `membership_transfers` (`order_id`,`effective_date`);