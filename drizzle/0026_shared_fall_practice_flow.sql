-- This fall example had been shared after it was generated. Keep its sharing status and coaching cues.
UPDATE practice_plans
SET payload=json_set(payload,
 '$.sections[0].title','Quick meeting & warm-up',
 '$.sections[0].notes','2 min — Quick meeting: review the practice goal and one safety cue. 8 min — Warm-up: ' || json_extract(payload,'$.sections[0].notes'),
 '$.sections[5].title','Cool-down, quick meeting & team breakdown',
 '$.sections[5].notes','2 min — Cool down: walk, breathe, and hydrate. 2 min — Quick meeting: ask wrestlers to repeat one technique cue and share reminders. 1 min — Team breakdown and dismissal.'),
 revision=revision+1,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE program='Elementary' AND date='2026-11-02' AND published=1 AND revision=2
 AND json_extract(payload,'$.sections[0].title')='Warm-up'
 AND json_extract(payload,'$.sections[0].notes')='Movement games, light jogging, stance motion, and dynamic mobility. Match partners by size and experience.'
 AND json_extract(payload,'$.sections[5].title')='Cool-down'
 AND json_extract(payload,'$.sections[5].notes')='Walk, breathe, hydrate, and ask wrestlers to repeat one technique cue.';
