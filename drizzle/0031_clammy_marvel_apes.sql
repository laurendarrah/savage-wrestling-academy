CREATE TABLE `wrestler_membership_cards` (
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`card_number` text NOT NULL,
	`expires_on` text NOT NULL,
	`photo_key` text NOT NULL,
	`photo_type` text NOT NULL,
	`revision` integer NOT NULL,
	`verified_at` text,
	`verified_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wrestler_card_family_wrestler` ON `wrestler_membership_cards` (`user_id`,`wrestler_id`);