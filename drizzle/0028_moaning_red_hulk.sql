CREATE TABLE `data_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`kind` text NOT NULL,
	`note` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`resolution` text,
	CONSTRAINT "data_request_kind" CHECK("data_requests"."kind" IN ('close')),
	CONSTRAINT "data_request_status" CHECK("data_requests"."status" IN ('open','handled'))
);
--> statement-breakpoint
CREATE INDEX `data_requests_status` ON `data_requests` (`status`,`created_at`);