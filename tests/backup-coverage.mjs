// Handoff issue DATA-02: backups must cover every business record and restore into a clean database,
// signed scholarship agreements must survive, and a backup file must never overwrite or forge records.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';

function freshDb(){
  const sqlite=new DatabaseSync(':memory:');
  for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+f,'utf8'));
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
  return compile('lib/backup-records.ts',{'cloudflare:workers':{env:{DB}},'./academy-validation':compile('lib/academy-validation.ts',{'./friday-live':friday}),'./family-records':compile('lib/family-records.ts',{})});
}
const now='2026-11-05T12:00:00.000Z';
const signature=JSON.stringify({version:1,signer:'Pat Parent',consent:true,termsHash:'a'.repeat(64),strokes:[[[1,2],[3,4],[5,6]]],signedAt:now});

function seed(sqlite){
  const run=(sql,...v)=>sqlite.prepare(sql).run(...v);
  run("INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) VALUES (?,?,?,?,?)",'parent-1','pat@example.test',JSON.stringify({parentName:'Pat Parent',phone:'555-0100',wrestlers:[{id:'w-1',name:'Sam Example',grade:'8'}]}),1,now);
  run("INSERT INTO coach_openings(id,user_id,date,start,end) VALUES (?,?,?,?,?)",'open-1','coach-1','2026-12-01','16:00','17:00');
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
}
const dump=(sqlite,t)=>sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all().map(r=>({...r}));
const restorable=['practice_curriculum_groups','practice_curricula','program_approvals','approval_messages','practice_plans','scholarship_awards'];

// 1. Export covers every business table, and excludes grants, secrets and bookkeeping.
const source=freshDb();seed(source.sqlite);
const lib=loadBackups(source.DB);
const backup=JSON.parse(JSON.stringify(await lib.readBackup()));
assert.equal(backup.version,2);
assert.deepEqual(Object.keys(backup.records).sort(),[...restorable].sort());
for(const t of restorable)assert.equal(backup.records[t].length,1,`${t} exported`);
assert.equal(backup.records.scholarship_awards[0].signature_record,signature,'signature evidence exported byte for byte');
assert.equal(backup.archive.security_events.length,1);assert.equal(backup.archive.truncated,false);
const text=JSON.stringify(backup);
assert.ok(!text.includes('ENCRYPTED-BLOB'),'Stripe credential never exported');
assert.ok(!text.includes('coach@example.test'),'staff access grants never exported');
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
assert.equal(dump(target.sqlite,'coach_openings').length,1);
assert.equal(dump(target.sqlite,'staff_access').length,0,'restore never grants staff access');
assert.equal(dump(target.sqlite,'integration_secrets').length,0);
const events=dump(target.sqlite,'security_events');
assert.equal(events.length,1,'archived audit events are not replayed; only the restore itself is logged');
assert.equal(events[0].action,'backup_restored');assert.match(events[0].target,/^v2:.*scholarship_awards/);
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

// 6. Version 1 backups from before this change still validate and restore.
const v1={version:1,project:backup.project,createdAt:backup.createdAt,academy:backup.academy,families:backup.families,openings:backup.openings};
assert.equal(lib.validBackup(v1),true);
assert.equal(lib.validBackup({...v1,records:backup.records}),false,'v1 cannot smuggle v2 sections');
const old=freshDb(),oldLib=loadBackups(old.DB);
assert.ok(await oldLib.restoreBackup(v1,await oldLib.fingerprint(await oldLib.metadata()),'owner'));
assert.equal(dump(old.sqlite,'family_accounts').length,1);assert.equal(dump(old.sqlite,'scholarship_awards').length,0);

console.log('Passed: v2 backup covers scholarships and signatures, approvals and messages, plans and curricula; clean-database restore is exact; restore never overwrites, grants access, exports secrets, or replays audit events; v1 backups still restore.');
