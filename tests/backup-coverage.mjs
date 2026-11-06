// Handoff issue DATA-02: backups must cover every business record and restore into a clean database,
// signed scholarship agreements must survive, and a backup file must never overwrite or forge records.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';

function freshDb(){
  const sqlite=new DatabaseSync(':memory:');
  for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&!f.includes('_starter_')).sort())sqlite.exec(readFileSync('drizzle/'+f,'utf8'));
  const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return sqlite.prepare(sql).get(...args)??null},async run(){return sqlite.prepare(sql).run(...args)},async all(){return {results:sqlite.prepare(sql).all(...args)}},_execute(){const st=sqlite.prepare(sql);return st.columns().length?{results:st.all(...args)}:{results:[],meta:st.run(...args)}}}},
    async batch(list){sqlite.exec('BEGIN');try{const r=list.map(s=>s._execute());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}};
  return {sqlite,DB};
}
function compile(file,deps){
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {module,exports:module.exports,crypto,TextEncoder,JSON,Date,Number,Object,Array,Set,require:n=>{if(n in deps)return deps[n];throw Error('unexpected import '+n)}});
  return module.exports;
}
function loadBackups(DB){
  const friday=compile('lib/friday-live.ts',{});
  return compile('lib/backup-records.ts',{'cloudflare:workers':{env:{DB}},'./academy-validation':compile('lib/academy-validation.ts',{'./friday-live':friday,'./event-schedule':compile('lib/event-schedule.ts',{})}),'./family-records':compile('lib/family-records.ts',{})});
}
const now='2026-11-05T12:00:00.000Z';
const signature=JSON.stringify({version:1,signer:'Pat Parent',consent:true,termsHash:'a'.repeat(64),strokes:[[[1,2],[3,4],[5,6]]],signedAt:now});

function seed(sqlite){
  const run=(sql,...v)=>sqlite.prepare(sql).run(...v);
  run("INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) VALUES (?,?,?,?,?)",'parent-1','pat@example.test',JSON.stringify({parentName:'Pat Parent',phone:'555-0100',homeAddress:'20 Railroad St',homeCity:'Huntington Station',homeState:'NY',homeZip:'11746',emergencyContactName:'Jordan Parent',emergencyContactPhone:'631-555-0199',wrestlers:[{id:'w-1',name:'Sam Example',grade:'8',birthDate:'2012-04-18',allergies:'Peanuts'}]}),1,now);
  run("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES (?,?,?,?,?,?)",'open-1','coach-1','2026-12-01','16:00','17:00','dana@example.test');
  run("INSERT INTO practice_curriculum_groups VALUES (?,?,?,?,?,?,?)",'grp-1','Advanced','Foundations','foundations',1,'owner',now);
  run("INSERT INTO practice_curricula(id,name,name_key,payload,revision,updated_by,updated_at,curriculum_id,lesson_order) VALUES (?,?,?,?,?,?,?,?,?)",'les-1','Lesson 1','lesson 1',JSON.stringify({title:'Stance',sections:[]}),1,'owner',now,'grp-1',1);
  run("INSERT INTO program_approvals VALUES (?,?,?,?,?,?,?,?,?,?)",'appr-1','parent-1','w-1','Advanced','Sam Example','8','approved',now,now,'owner');
  run("INSERT INTO approval_messages VALUES (?,?,?,?,?,?)",'msg-1','appr-1','parent-1','parent','Sam has two years of folkstyle.',now);
  run("INSERT INTO practice_plans VALUES (?,?,?,?,?,?,?,?)",'plan-1','Advanced','2026-12-02',JSON.stringify({title:'Leg attacks',sections:[]}),1,1,'owner',now);
  run(`INSERT INTO scholarship_awards(id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,terms_ready,revision,status,user_id,wrestler_id,signer,accepted_at,ended_at,expires_at,created_at,created_by,signature_record) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'sch-1','b'.repeat(64),'pat@example.test','Sam Example','Advanced',20000,'Final attorney-reviewed terms.',1,2,'active','parent-1','w-1','Pat Parent',now,null,'2026-12-05T00:00:00.000Z',now,'owner',signature);
  run("INSERT INTO staff_access VALUES (?,?,?,?,?)",'coach@example.test','Coach','["Advanced"]',1,now);
  run("INSERT INTO integration_secrets VALUES (?,?,?,?)",'stripe-test','ENCRYPTED-BLOB','owner',now);
  run("INSERT INTO security_events VALUES (?,?,?,?,?)",'evt-1','owner','scholarship_accepted','sch-1',now);
  // Issue #78: payments, attendance and every feature table added since the first backup version.
  run(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,stripe_session_id,stripe_payment_intent,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
    VALUES ('ord-1','parent-1','pat@example.test','w-1','Sam Example','annual','Advanced','Advanced','Membership','[]',240000,0,240000,'usd','{"method":"check"}','{"offline":true}','paid','k1',NULL,NULL,0,?,?,?,'2026-11-05','2027-11-04','offline')`,now,now,now);
  run("INSERT INTO stripe_events VALUES (?,?,?,?,?)",'evt_stripe_1','checkout.session.completed','ord-1','paid',now);
  run("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)",'ord-1','sub_1','active',1,12,'2026-11-05','2027-11-04','2026-12-04','2027-11-05',now);
  run("INSERT INTO attendance VALUES (?,?,?,?,?,?,?,?,?)",'att-1','practice:Advanced:2026-11-05:18:00','2026-11-05','parent-1','w-1','Sam Example','Member',now,'owner');
  run("INSERT INTO usaw_reviews VALUES (?,?,?,?,?,?,?,?)",'parent-1','w-1','AB1234','2027-08-31','valid','','owner',now);
  run("INSERT INTO waiver_versions VALUES (?,?,?,?,?,?,?)",'wv-1','Waiver','Approved text.','c'.repeat(64),now,'owner',null);
  run("INSERT INTO waiver_signatures VALUES (?,?,?,?,?,?,?,?,?)",'ws-1','wv-1','parent-1','w-1','Sam Example','Pat Parent','pat@example.test','{"strokes":[]}',now);
  run("INSERT INTO academy_settings VALUES (?,?,?,?)",'lessons','{"prices":{"one-on-one":6000}}',now,'owner');
  run("INSERT INTO wrestler_passes VALUES (?,?,?,?,?,?,?)",'pass-1','parent-1','w-1','t'.repeat(32),now,null,null);
  run("INSERT INTO waitlist_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",'wl-1','camp','full','["2026-12-20"]','parent-1','w-1','Sam Example','pat@example.test','waiting',now,null,null,null,0,null,null);
  run("INSERT INTO membership_transfers VALUES (?,?,?,?,?,?,?,?)",'tr-1','ord-1','Intermediate','Advanced','2026-11-10','Moved up','owner',now);
  run("INSERT INTO announcements VALUES (?,?,?,?,?,?,?,?)",'an-1','Practice moved','Six thirty tonight.','{"type":"all"}','All families','owner',now,1);
  run("INSERT INTO announcement_recipients(announcement_id,user_id,email,read_at,email_status) VALUES (?,?,?,?,?)",'an-1','parent-1','pat@example.test',null,'skipped');
  run("INSERT INTO family_messages(id,user_id,sender_role,body,created_at,read_at,email_status) VALUES (?,?,?,?,?,?,?)",'fm-1','parent-1','owner','Great practice.',now,null,'skipped');
  run("INSERT INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status) VALUES (?,?,?,?,?,?,?,?,?,?)",'nt-1','parent-1','pat@example.test','card_expiring','Card expires soon','Renew it.','card-soon:parent-1:w-1:2026-12-01',now,null,'skipped');
  run("INSERT INTO data_requests VALUES (?,?,?,?,?,?,?,?,?,?)",'dr-1','parent-1','pat@example.test','close','Moving away','open',now,null,null,null);
  // Issue #190: coach profiles are backed up; invites (which grant access) are not.
  run("INSERT INTO coach_profiles VALUES (?,?,?,?,?,?,?,?)",'dana@example.test','Coach Dana','Two-time state placer.','["Takedowns","Mat returns"]','555-0101',null,now,'owner');
  run("INSERT INTO coach_invites(id,token_hash,email,name,programs,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",'inv-1','INVITE-HASH','new.coach@example.test','New Coach','["Advanced"]','owner',now,'2026-12-01T00:00:00.000Z');
  run("INSERT INTO booking_exceptions VALUES (?,?,?,?,?,?,?,?,?,?,?)",'ex-1','parent-1','w-1','usaw','2026-11-05','2026-12-05','Renewal pending','owner',now,null,null);
  // Issue #194: the owner's own entries in the books.
  run("INSERT INTO financial_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",'fe-1','expense','2026-11-01',180000,'Rent','November rent','Check 1042',1,now,'owner',now,'owner',null,null);
}
const dump=(sqlite,t)=>sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all().map(r=>({...r}));
const legacy=['practice_curriculum_groups','practice_curricula','program_approvals','approval_messages','practice_plans','scholarship_awards'];
const restorable=[...legacy,'orders','stripe_events','subscriptions','attendance','usaw_reviews','waiver_versions','waiver_signatures','academy_settings','wrestler_passes','waitlist_entries','membership_transfers','announcements','announcement_recipients','family_messages','booking_exceptions','notifications','data_requests','coach_profiles','financial_entries'];
// Every table is either backed up or deliberately left out (see lib/backup-records.ts). A new migration that adds a
// table fails here until someone decides which.
{
  const db=freshDb().sqlite,tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all().map(r=>r.name);
  const core=['academy_state','family_accounts','coach_openings'],excluded=['staff_access','coach_invites','integration_secrets','auth_attempts','error_log','usaw_lookups','recovery_snapshots','restore_guard','security_events'];
  const missing=tables.filter(t=>![...core,...excluded,...restorable].includes(t));
  assert.deepEqual(missing,[],'tables neither backed up nor excluded: '+missing.join(', '));
}

// 1. Export covers every business table, and excludes grants, secrets and bookkeeping.
const source=freshDb();seed(source.sqlite);
const lib=loadBackups(source.DB);
const backup=JSON.parse(JSON.stringify(await lib.readBackup()));
assert.equal(backup.version,3);
assert.deepEqual(Object.keys(backup.records).sort(),[...restorable].sort());
for(const t of restorable)assert.equal(backup.records[t].length,1,`${t} exported`);
assert.equal(backup.records.scholarship_awards[0].signature_record,signature,'signature evidence exported byte for byte');
assert.equal(backup.archive.security_events.length,1);assert.equal(backup.archive.truncated,false);
const text=JSON.stringify(backup);
assert.ok(!text.includes('ENCRYPTED-BLOB'),'Stripe credential never exported');
assert.ok(!text.includes('coach@example.test'),'staff access grants never exported');
assert.ok(!text.includes('INVITE-HASH')&&!text.includes('new.coach@example.test'),'coach invites never exported');
assert.equal(backup.staff,undefined);
assert.equal(lib.validBackup(backup),true);

// 2. Restore into a clean database recovers every business record exactly.
const target=freshDb();
const targetLib=loadBackups(target.DB);
const fp=await targetLib.fingerprint(await targetLib.metadata());
const result=await targetLib.restoreBackup(backup,fp,'owner');
assert.ok(result,'restore accepted');
for(const t of restorable){assert.equal(result.restored[t],1,`${t} restored count`);assert.deepEqual(dump(target.sqlite,t),dump(source.sqlite,t),`${t} identical after restore`)}
assert.equal(dump(target.sqlite,'family_accounts').length,1);
// Issue #188: contact and safety details travel inside the family profile and survive a restore.
{const p=JSON.parse(dump(target.sqlite,'family_accounts')[0].payload);assert.equal(p.homeZip,'11746');assert.equal(p.emergencyContactPhone,'631-555-0199');assert.equal(p.wrestlers[0].birthDate,'2012-04-18');assert.equal(p.wrestlers[0].allergies,'Peanuts')}
assert.equal(dump(target.sqlite,'coach_openings').length,1);
assert.equal(dump(target.sqlite,'coach_openings')[0].coach_email,'dana@example.test','coach link restored');
assert.equal(dump(target.sqlite,'staff_access').length,0,'restore never grants staff access');
assert.equal(dump(target.sqlite,'coach_invites').length,0,'restore never re-creates an invite');
assert.equal(dump(target.sqlite,'integration_secrets').length,0);
const events=dump(target.sqlite,'security_events');
assert.equal(events.length,1,'archived audit events are not replayed; only the restore itself is logged');
assert.equal(events[0].action,'backup_restored');assert.match(events[0].target,/^v3:.*scholarship_awards.*orders/);
const snap=JSON.parse(dump(target.sqlite,'recovery_snapshots')[0].payload);
assert.equal(snap.version,1,'recovery snapshot holds only the overwritable core sections');

// 3. Restore never overwrites an existing record, even a changed one, and re-running adds nothing.
target.sqlite.prepare("UPDATE scholarship_awards SET status='ended',ended_at=? WHERE id='sch-1'").run(now);
target.sqlite.prepare("UPDATE program_approvals SET status='declined' WHERE id='appr-1'").run();
const again=await targetLib.restoreBackup(backup,await targetLib.fingerprint(await targetLib.metadata()),'owner');
for(const t of restorable)assert.equal(again.restored[t],0,`${t}: nothing re-added`);
assert.equal(dump(target.sqlite,'scholarship_awards')[0].status,'ended','ended award stays ended');
assert.equal(dump(target.sqlite,'scholarship_awards')[0].signature_record,signature,'signature preserved');
assert.equal(dump(target.sqlite,'program_approvals')[0].status,'declined','owner decision not reverted');

// 4. A deleted record is re-created; everything else is untouched.
target.sqlite.prepare("DELETE FROM approval_messages").run();
const third=await targetLib.restoreBackup(backup,await targetLib.fingerprint(await targetLib.metadata()),'owner');
assert.equal(third.restored.approval_messages,1);assert.equal(dump(target.sqlite,'approval_messages').length,1);

// 5. Malformed or forged backups are rejected before anything is written.
const clone=()=>JSON.parse(JSON.stringify(backup));
let bad=clone();bad.records.scholarship_awards[0].extra='x';assert.equal(lib.validBackup(bad),false,'unknown column');
bad=clone();delete bad.records.practice_plans;assert.equal(lib.validBackup(bad),false,'missing section');
bad=clone();bad.records.staff_access=[];assert.equal(lib.validBackup(bad),false,'unexpected section');
bad=clone();bad.records.scholarship_awards[0].reference_cents='20000';assert.equal(lib.validBackup(bad),false,'wrong type');
bad=clone();bad.records.program_approvals[0].decided_by=undefined;assert.equal(lib.validBackup(bad),false,'missing field');
bad=clone();bad.records.practice_plans.push({...bad.records.practice_plans[0]});assert.equal(lib.validBackup(bad),false,'duplicate id');
bad=clone();bad.archive.security_events[0].id=5;assert.equal(lib.validBackup(bad),false,'bad archive row');

// 6. Version 2 backups made before issue #78 (six tables) still validate and restore; a v3 file cannot drop a table.
{
  const v2={...JSON.parse(JSON.stringify(backup)),version:2,records:Object.fromEntries(legacy.map(t=>[t,backup.records[t]]))};
  assert.equal(lib.validBackup(v2),true,'older v2 backup accepted');
  assert.equal(lib.validBackup({...v2,records:backup.records}),false,'v2 cannot carry v3 tables');
  const o2=freshDb(),o2Lib=loadBackups(o2.DB);
  assert.ok(await o2Lib.restoreBackup(v2,await o2Lib.fingerprint(await o2Lib.metadata()),'owner'));
  assert.equal(dump(o2.sqlite,'scholarship_awards').length,1);assert.equal(dump(o2.sqlite,'orders').length,0);
  let b3=clone();delete b3.records.orders;assert.equal(lib.validBackup(b3),false,'v3 missing orders');
  // A version 3 file made before coach profiles were added still restores; one that has them must have them right.
  b3=clone();delete b3.records.coach_profiles;assert.equal(lib.validBackup(b3),true,'v3 from before coach profiles');
  {const o3=freshDb(),o3Lib=loadBackups(o3.DB);const res=await o3Lib.restoreBackup(b3,await o3Lib.fingerprint(await o3Lib.metadata()),'owner');assert.equal(res.restored.orders,1);assert.equal(dump(o3.sqlite,'coach_profiles').length,0)}
  // The same for the books (issue #194): a file made before them still restores and adds no entries.
  b3=clone();delete b3.records.financial_entries;assert.equal(lib.validBackup(b3),true,'v3 from before the books');
  {const o4=freshDb(),o4Lib=loadBackups(o4.DB);const res=await o4Lib.restoreBackup(b3,await o4Lib.fingerprint(await o4Lib.metadata()),'owner');assert.equal(res.restored.orders,1);assert.equal(dump(o4.sqlite,'financial_entries').length,0)}
  b3=clone();b3.records.coach_profiles[0].specialties='not json';assert.equal(lib.validBackup(b3),false,'coach profile specialties must be a list');
  b3=clone();b3.records.usaw_reviews.push({...b3.records.usaw_reviews[0]});assert.equal(lib.validBackup(b3),false,'duplicate composite key');
}
// Issue #194: a deleted or edited entry in the books is not undone by restoring an older file, and a deleted one comes back
// only if its row is gone. Amounts must be whole cents.
{
  target.sqlite.prepare("UPDATE financial_entries SET amount_cents=190000,revision=2 WHERE id='fe-1'").run();
  await targetLib.restoreBackup(backup,await targetLib.fingerprint(await targetLib.metadata()),'owner');
  assert.equal(dump(target.sqlite,'financial_entries')[0].amount_cents,190000,'restore does not overwrite an edited entry');
  let bad=clone();bad.records.financial_entries[0].amount_cents=1800.5;assert.equal(lib.validBackup(bad),false,'amounts are whole cents');
  bad=clone();bad.records.financial_entries[0].amount_cents='180000';assert.equal(lib.validBackup(bad),false,'amounts are numbers');
}
// A backup never changes a payment that already exists.
{
  target.sqlite.prepare("UPDATE orders SET status='refunded' WHERE id='ord-1'").run();
  await targetLib.restoreBackup(backup,await targetLib.fingerprint(await targetLib.metadata()),'owner');
  assert.equal(dump(target.sqlite,'orders')[0].status,'refunded','restore does not overwrite an existing order');
}

// 7. Version 1 backups from before this change still validate and restore.
const v1={version:1,project:backup.project,createdAt:backup.createdAt,academy:backup.academy,families:backup.families,openings:backup.openings};
assert.equal(lib.validBackup(v1),true);
assert.equal(lib.validBackup({...v1,records:backup.records}),false,'v1 cannot smuggle v2 sections');
const old=freshDb(),oldLib=loadBackups(old.DB);
assert.ok(await oldLib.restoreBackup(v1,await oldLib.fingerprint(await oldLib.metadata()),'owner'));
assert.equal(dump(old.sqlite,'family_accounts').length,1);assert.equal(dump(old.sqlite,'scholarship_awards').length,0);

console.log('Passed: v3 backup covers payments, attendance, waivers, passes, waitlists, transfers, messages and exceptions as well as scholarships and signatures, approvals and messages, plans and curricula; clean-database restore is exact; restore never overwrites, grants access, exports secrets, or replays audit events; v1 backups still restore.');
