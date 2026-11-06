-- Name the built-in test wrestlers consistently without changing regular profiles.
UPDATE family_accounts AS f SET
 payload=json_set(f.payload,
  '$.parentName',CASE WHEN json_extract(f.payload,'$.parentName')='SWA Test Family' THEN 'Jordan Demo' ELSE json_extract(f.payload,'$.parentName') END,
  '$.wrestlers',json((SELECT json_group_array(json(
   CASE json_extract(w.value,'$.id')
    WHEN 'swa-test-development' THEN json_set(w.value,'$.name','Sam Demo')
    WHEN 'swa-test-intermediate' THEN json_set(w.value,'$.name','Morgan Demo')
    WHEN 'swa-test-advance' THEN json_set(w.value,'$.name','Alex Demo')
    ELSE w.value END
  )) FROM json_each(f.payload,'$.wrestlers') w))),
 revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE EXISTS (SELECT 1 FROM json_each(f.payload,'$.wrestlers') w
 WHERE json_extract(w.value,'$.id') IN ('swa-test-development','swa-test-intermediate','swa-test-advance'));
--> statement-breakpoint
UPDATE document_assignments SET
 wrestler_name=CASE wrestler_id WHEN 'swa-test-development' THEN 'Sam Demo'
  WHEN 'swa-test-intermediate' THEN 'Morgan Demo' WHEN 'swa-test-advance' THEN 'Alex Demo' END,
 parent_name=CASE WHEN parent_name='SWA Test Family' THEN 'Jordan Demo' ELSE parent_name END
WHERE status='pending' AND wrestler_id IN ('swa-test-development','swa-test-intermediate','swa-test-advance')
 AND version_id IN (SELECT id FROM document_versions WHERE template_id='swa-test-waiver');
--> statement-breakpoint
UPDATE attendance_checkins SET wrestler_name=CASE wrestler_id WHEN 'swa-test-development' THEN 'Sam Demo'
 WHEN 'swa-test-intermediate' THEN 'Morgan Demo' WHEN 'swa-test-advance' THEN 'Alex Demo' END
WHERE practice_id LIKE 'test:%' AND wrestler_id IN ('swa-test-development','swa-test-intermediate','swa-test-advance');
