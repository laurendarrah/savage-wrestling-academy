ALTER TABLE `error_log` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `error_log` ADD `role` text;--> statement-breakpoint
CREATE INDEX `family_accounts_updated` ON `family_accounts` (`updated_at`,`user_id`);--> statement-breakpoint
CREATE INDEX `orders_status_program` ON `orders` (`status`,`kind`,`program`,`term_start`);--> statement-breakpoint
CREATE INDEX `orders_status_item` ON `orders` (`status`,`kind`,`item_id`);--> statement-breakpoint
CREATE INDEX `orders_status_paid` ON `orders` (`status`,`paid_at`);--> statement-breakpoint
CREATE INDEX `security_events_created` ON `security_events` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `stripe_events_order` ON `stripe_events` (`order_id`,`outcome`);