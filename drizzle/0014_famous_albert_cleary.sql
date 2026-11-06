CREATE TABLE `document_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`user_id` text NOT NULL,
	`family_email` text NOT NULL,
	`parent_name` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`wrestler_grade` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`assigned_at` text NOT NULL,
	`assigned_by` text NOT NULL,
	`signer` text,
	`signer_role` text,
	`signed_at` text,
	`signature_record` text,
	CONSTRAINT "document_assignment_status" CHECK("document_assignments"."status" IN ('pending','signed','void'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_family_wrestler_version` ON `document_assignments` (`version_id`,`user_id`,`wrestler_id`);--> statement-breakpoint
CREATE INDEX `document_family_status` ON `document_assignments` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `document_assignment_time` ON `document_assignments` (`assigned_at`,`id`);--> statement-breakpoint
CREATE TABLE `document_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "document_kind" CHECK("document_templates"."kind" IN ('waiver','contract')),
	CONSTRAINT "document_archived" CHECK("document_templates"."archived" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`source_revision` integer NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`body_hash` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_template_version` ON `document_versions` (`template_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_published_revision` ON `document_versions` (`template_id`,`source_revision`);