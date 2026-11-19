-- Removed coach shifts are deleted, not kept crossed out (issue #375, decided by Lauren on Nov 19, 2026). Shifts that
-- were marked removed before this change are deleted here. The security log keeps one line for each: the coach, the
-- day, the practice and the reason it was removed. No other shift is touched.
INSERT INTO `security_events`(`id`,`actor`,`action`,`target`,`created_at`)
SELECT lower(hex(randomblob(16))), 'migration:0048', 'coach_shift_removed', substr(`coach_email` || ' · ' || `work_date` || ' · ' || coalesce(`session_title`, 'No scheduled practice') || coalesce(' · ' || `void_reason`, ''), 1, 500), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `coach_time_entries` WHERE `voided_at` IS NOT NULL;--> statement-breakpoint
DELETE FROM `coach_time_entries` WHERE `voided_at` IS NOT NULL;
