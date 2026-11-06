-- Update the generated fall drafts while preserving plans that have been edited or shared.
UPDATE practice_plans
SET payload=json_set(payload,
 '$.sections[0].title','Quick meeting & warm-up',
 '$.sections[0].notes','2 min — Quick meeting: review the practice goal and one safety cue. 8 min — Warm-up: ' || json_extract(payload,'$.sections[0].notes'),
 '$.sections[5].title','Cool-down, quick meeting & team breakdown',
 '$.sections[5].notes','2 min — Cool down and hydrate. 2 min — Quick meeting: recap one key skill and share reminders. 1 min — Team breakdown and dismissal.'),
 revision=revision+1,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE updated_by='fall-2026-examples' AND published=0 AND revision=1
 AND date BETWEEN '2026-09-01' AND '2026-11-30'
 AND json_extract(payload,'$.sections[0].kind')='warmup'
 AND json_extract(payload,'$.sections[5].kind')='cooldown';
