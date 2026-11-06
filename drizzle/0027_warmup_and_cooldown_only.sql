-- Remove the previous meeting instructions from the generated fall plans.
WITH opening(prefix) AS (VALUES(
 '2 min — Quick meeting: review the practice goal and one safety cue. 8 min — Warm-up: '
))
UPDATE practice_plans
SET payload=json_set(payload,
 '$.sections[0].title','Warm-up',
 '$.sections[0].notes',substr(json_extract(payload,'$.sections[0].notes'),(SELECT length(prefix)+1 FROM opening)),
 '$.sections[5].title','Cool-down',
 '$.sections[5].notes','Gradually lower the pace with easy movement, gentle mobility, and hydration.'),
 revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (
 (updated_by='fall-2026-examples' AND published=0 AND revision=2 AND date BETWEEN '2026-09-01' AND '2026-11-30')
 OR (program='Elementary' AND date='2026-11-02' AND published=1 AND revision=3)
)
 AND json_extract(payload,'$.sections[0].title')='Quick meeting & warm-up'
 AND substr(json_extract(payload,'$.sections[0].notes'),1,(SELECT length(prefix) FROM opening))=(SELECT prefix FROM opening)
 AND json_extract(payload,'$.sections[5].title')='Cool-down, quick meeting & team breakdown';
