-- SQLite / Cloudflare D1 schema derived from all 13 tracked migrations.
-- Schema only. No customer or authentication data.

CREATE TABLE `academy_state` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `approval_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`approval_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "approval_sender_role" CHECK("approval_messages"."sender_role" IN ('owner','parent'))
);

CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`bucket` integer NOT NULL
);

CREATE TABLE `coach_openings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL
);

CREATE TABLE `family_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `integration_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `practice_curricula` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
, `curriculum_id` text, `lesson_order` integer DEFAULT 0 NOT NULL);

CREATE TABLE `practice_curriculum_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`program` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `practice_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`program` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	`published` integer NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "practice_plan_published" CHECK("practice_plans"."published" IN (0,1))
);

CREATE TABLE `program_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`program` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`grade` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`decided_by` text,
	CONSTRAINT "approval_status" CHECK("program_approvals"."status" IN ('pending','approved','declined'))
);

CREATE TABLE `recovery_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);

CREATE TABLE `restore_guard` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "valid_restore" CHECK("restore_guard"."valid" = 1)
);

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
	`created_by` text NOT NULL, `signature_record` text,
	CONSTRAINT "scholarship_status" CHECK("scholarship_awards"."status" IN ('offered','active','revoked','ended')),
	CONSTRAINT "scholarship_ready" CHECK("scholarship_awards"."terms_ready" IN (0,1))
);

CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created_at` text NOT NULL
);

CREATE TABLE `staff_access` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`programs` text NOT NULL,
	`active` integer NOT NULL,
	`updated_at` text NOT NULL
);

CREATE UNIQUE INDEX `approval_family_wrestler_program` ON `program_approvals` (`user_id`,`wrestler_id`,`program`);

CREATE INDEX `approval_messages_thread_order` ON `approval_messages` (`approval_id`,`created_at`,`id`);

CREATE UNIQUE INDEX `curriculum_program_name` ON `practice_curriculum_groups` (`program`,`name_key`);

CREATE UNIQUE INDEX `practice_curriculum_lesson_name` ON `practice_curricula` (`curriculum_id`,`name_key`);

CREATE UNIQUE INDEX `practice_plan_program_date` ON `practice_plans` (`program`,`date`);

CREATE UNIQUE INDEX `scholarship_active_wrestler` ON `scholarship_awards` (`user_id`,`wrestler_id`) WHERE "scholarship_awards"."status" = 'active';

CREATE UNIQUE INDEX `scholarship_invite_hash` ON `scholarship_awards` (`token_hash`);
