CREATE TABLE `usaw_reviews` (
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`number` text NOT NULL,
	`expires` text NOT NULL,
	`status` text NOT NULL,
	`note` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`reviewed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `wrestler_id`),
	CONSTRAINT "usaw_review_status" CHECK("usaw_reviews"."status" IN ('valid','invalid'))
);
