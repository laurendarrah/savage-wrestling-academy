-- Invited coaches who already signed up but landed on the family side (issue #392). Their email is confirmed (a family
-- account is only saved for a confirmed email) and has an open coach invite, so they get coach access now, exactly as
-- signing in does from this change on. The newest open invite for the email is used; the owner's email never is.
-- Each gets a line in the security log. A family account they left with nothing in it (no wrestler, payment, cash
-- booking, message or data request) is deleted, so they show under Coaches and not under Families.
INSERT INTO `security_events`(`id`,`actor`,`action`,`target`,`created_at`)
SELECT lower(hex(randomblob(16))), 'migration:0051', 'coach_invite_accepted', i.`email`, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `coach_invites` i
WHERE i.`used_at` IS NULL AND i.`revoked_at` IS NULL AND i.`expires_at` > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND i.`email` <> 'savagewrestlingclub@gmail.com'
  AND EXISTS (SELECT 1 FROM `family_accounts` f WHERE lower(f.`email`) = i.`email`)
  AND i.`created_at` = (SELECT max(j.`created_at`) FROM `coach_invites` j WHERE j.`email` = i.`email` AND j.`used_at` IS NULL AND j.`revoked_at` IS NULL);--> statement-breakpoint
INSERT INTO `staff_access`(`email`,`name`,`programs`,`active`,`updated_at`)
SELECT i.`email`, i.`name`, i.`programs`, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `coach_invites` i
WHERE i.`used_at` IS NULL AND i.`revoked_at` IS NULL AND i.`expires_at` > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND i.`email` <> 'savagewrestlingclub@gmail.com'
  AND EXISTS (SELECT 1 FROM `family_accounts` f WHERE lower(f.`email`) = i.`email`)
  AND i.`created_at` = (SELECT max(j.`created_at`) FROM `coach_invites` j WHERE j.`email` = i.`email` AND j.`used_at` IS NULL AND j.`revoked_at` IS NULL)
ON CONFLICT(`email`) DO UPDATE SET `name`=excluded.`name`, `programs`=excluded.`programs`, `active`=1, `updated_at`=excluded.`updated_at`;--> statement-breakpoint
UPDATE `coach_invites` SET `used_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now'), `used_by` = 'migration:0051'
WHERE `used_at` IS NULL AND `revoked_at` IS NULL AND `expires_at` > strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND EXISTS (SELECT 1 FROM `staff_access` s WHERE s.`email` = `coach_invites`.`email` AND s.`active` = 1);--> statement-breakpoint
DELETE FROM `family_accounts`
WHERE COALESCE(json_array_length(`payload`,'$.wrestlers'),0) = 0
  AND EXISTS (SELECT 1 FROM `security_events` e WHERE e.`actor` = 'migration:0051' AND e.`target` = lower(`family_accounts`.`email`))
  AND EXISTS (SELECT 1 FROM `staff_access` s WHERE s.`email` = lower(`family_accounts`.`email`) AND s.`active` = 1)
  AND NOT EXISTS (SELECT 1 FROM `orders` x WHERE x.`user_id` = `family_accounts`.`user_id`)
  AND NOT EXISTS (SELECT 1 FROM `cash_bookings` c WHERE c.`user_id` = `family_accounts`.`user_id`)
  AND NOT EXISTS (SELECT 1 FROM `family_messages` m WHERE m.`user_id` = `family_accounts`.`user_id`)
  AND NOT EXISTS (SELECT 1 FROM `data_requests` d WHERE d.`user_id` = `family_accounts`.`user_id`);
