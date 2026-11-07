CREATE TABLE `usaw_lookups` (
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`number` text NOT NULL,
	`expires` text NOT NULL,
	`season` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text NOT NULL,
	`card_name` text,
	`card_state` text,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `wrestler_id`),
	CONSTRAINT "usaw_lookup_status" CHECK("usaw_lookups"."status" IN ('active','inactive','not_found','unavailable')),
	CONSTRAINT "usaw_lookup_outcome" CHECK("usaw_lookups"."outcome" IN ('verified','inactive','not_found','mismatch','season','unavailable'))
);
--> statement-breakpoint
CREATE INDEX `usaw_lookups_card` ON `usaw_lookups` (`number`,`season`,`checked_at`);