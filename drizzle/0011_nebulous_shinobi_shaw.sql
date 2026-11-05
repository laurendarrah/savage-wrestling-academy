CREATE TABLE `scholarship_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`recipient_email` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`program` text NOT NULL,
	`reference_cents` integer NOT NULL,
	`terms_text` text NOT NULL,
	`terms_ready` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	`user_id` text,
	`wrestler_id` text,
	`signer` text,
	`accepted_at` text,
	`ended_at` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	CONSTRAINT "scholarship_status" CHECK("scholarship_awards"."status" IN ('offered','active','revoked','ended')),
	CONSTRAINT "scholarship_ready" CHECK("scholarship_awards"."terms_ready" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scholarship_invite_hash` ON `scholarship_awards` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `scholarship_active_wrestler` ON `scholarship_awards` (`user_id`,`wrestler_id`) WHERE "scholarship_awards"."status" = 'active';