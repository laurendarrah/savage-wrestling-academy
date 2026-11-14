import assert from 'node:assert/strict';
import {load,request,DB,sqlite,users} from './accounts.mjs';
import {encryptBackup,decryptBackup} from '../public/security-backup.js';
const api=load('app/api/security/route.ts'),staff=load('app/api/staff/route.ts'),coach=load('app/api/coach/route.ts'),family=load('app/api/family/route.ts'),academy=load('app/api/academy/route.ts'),backups=load('app/api/backups/route.ts');
// Sign-in is a confirmed email and a password (issues #306, #347). An account that still has an authenticator saved in
// Supabase from before Nov 14 is like any other: the stand-in client has no factor calls at all, so any attempt to
// read or check one would fail here.
const leftover=id=>[{id,status:'verified',factor_type:'totp'}];
users.ownerOld={...users.owner,factors:leftover('factor-owner')};
assert.equal((await academy.GET(request('/api/academy','GET',null,'ownerOld'))).status,200);
assert.equal((await academy.GET(request('/api/academy','GET',null,'unverified'))).status,403,'the owner email without a confirmed email is not the owner');
assert.equal((await staff.GET(request('/api/staff','GET',null,'alice'))).status,403);
assert.equal((await backups.GET(request('/api/backups','GET',null,'alice'))).status,403);
assert.equal((await api.GET(request('/api/security'))).status,401);
// /api/security sets nothing up and checks no code; a page left open from before gets one plain sentence.
for(const body of [{action:'enroll'},{action:'verify',factorId:'factor-owner',code:'123456'}])for(const who of ['ownerOld','alice','']){const r=await api.POST(request('/api/security','POST',body,who));assert.equal(r.status,410);assert.equal((await r.json()).error,api.GONE)}
assert.doesNotMatch(api.GONE,/authenticator|code|factor/i);
assert.deepEqual(await (await api.GET(request('/api/security','GET',null,'ownerOld'))).json(),{email:'savagewrestlingclub@gmail.com',role:'owner',destination:'/'});
users.aliceOld={...users.alice,factors:leftover('alice-factor')};
assert.equal((await family.GET(request('/api/family','GET',null,'aliceOld'))).status,200);
users.coach1={id:'coach-uuid',email:'coach@example.test',email_confirmed_at:'2026-10-15',factors:leftover('coach-factor')};
const grant={action:'grant',email:'coach@example.test',name:'Coach Test',programs:['Elementary']};
assert.equal((await staff.POST(request('/api/staff','POST',grant,'alice'))).status,403);
assert.equal((await coach.GET(request('/api/coach','GET',null,'coach1'))).status,403,'not a coach until the owner says so');
assert.equal((await staff.POST(request('/api/staff','POST',grant,'owner'))).status,200);
assert.equal((await coach.GET(request('/api/coach','GET',null,'coach1'))).status,200);
assert.equal((await academy.GET(request('/api/academy','GET',null,'coach1'))).status,403);
assert.equal((await backups.GET(request('/api/backups','GET',null,'coach1'))).status,403);
const opening={action:'add',user_id:'other-coach',date:'2026-11-01',start:'15:00',end:'16:00'};
assert.equal((await coach.POST(request('/api/coach','POST',opening,'coach1'))).status,200);
assert.equal(sqlite.prepare('SELECT user_id FROM coach_openings').get().user_id,'coach-uuid');
assert.equal((await coach.POST(request('/api/coach','POST',opening,'coach1'))).status,409);
assert.equal((await coach.POST(request('/api/coach','POST',{...opening,date:'2026-02-31'},'coach1'))).status,400);
sqlite.prepare('INSERT INTO coach_openings(id,user_id,date,start,end) VALUES (?,?,?,?,?)').run('other-slot','other-uuid','2026-11-01','16:00','17:00');
await coach.POST(request('/api/coach','POST',{action:'remove',id:'other-slot'},'coach1'));assert(sqlite.prepare("SELECT 1 FROM coach_openings WHERE id='other-slot'").get());
const own=await (await coach.GET(request('/api/coach','GET',null,'coach1'))).json();assert.equal(own.openings.length,1);assert.equal(own.families,undefined);assert.deepEqual(own.programs,['Elementary']);
await staff.POST(request('/api/staff','POST',{action:'revoke',email:grant.email},'owner'));assert.equal((await coach.GET(request('/api/coach','GET',null,'coach1'))).status,403);
const state={kids:[],bookings:[],messages:[],offers:[],seasons:[],staff:[],attendance:{},settings:{test:'original'}};
assert.equal((await academy.PUT(request('/api/academy','PUT',{revision:0,data:state},'owner'))).status,200);
const exportResponse=await backups.GET(request('/api/backups','GET',null,'owner'));assert.equal(exportResponse.status,200);const {backup}=await exportResponse.json();
assert.equal(backup.project,'appgprj_6ad13665e8c881918c12b096132b4cae');assert.equal(backup.staff,undefined);assert.equal(backup.families.length,1);
const password='private backup passphrase only for tests';const encrypted=await encryptBackup(backup,password);assert(!JSON.stringify(encrypted).includes('Alice'));assert.deepEqual(await decryptBackup(encrypted,password),backup);
await assert.rejects(decryptBackup(encrypted,'incorrect passphrase for test'));
const damaged={...encrypted,data:(encrypted.data[0]==='A'?'B':'A')+encrypted.data.slice(1)};await assert.rejects(decryptBackup(damaged,password));
assert.equal((await backups.POST(request('/api/backups','POST',{action:'restore',backup,fingerprint:'invalid'},'owner'))).status,409);
const changed={...state,settings:{test:'changed'}};await academy.PUT(request('/api/academy','PUT',{revision:1,data:changed},'owner'));
const preview=await (await backups.GET(request('/api/backups?mode=preview','GET',null,'owner'))).json();
assert.equal((await backups.POST(request('/api/backups','POST',{action:'restore',backup,fingerprint:preview.fingerprint},'owner','https://evil.test'))).status,403);
assert.equal((await backups.POST(request('/api/backups','POST',{action:'restore',backup:{...backup,project:'another-site'},fingerprint:preview.fingerprint},'owner'))).status,400);
const restored=await backups.POST(request('/api/backups','POST',{action:'restore',backup,fingerprint:preview.fingerprint},'owner'));assert.equal(restored.status,200);
assert.equal(JSON.parse(sqlite.prepare("SELECT payload FROM academy_state WHERE id='academy'").get().payload).settings.test,'original');
const snapshot=sqlite.prepare('SELECT payload FROM recovery_snapshots').get();assert.equal(JSON.parse(snapshot.payload).academy.settings.test,'changed');assert.equal(sqlite.prepare('SELECT count(*) AS n FROM restore_guard').get().n,0);
const fresh=await (await backups.GET(request('/api/backups?mode=preview','GET',null,'owner'))).json();
const realBatch=DB.batch;
DB.batch=async statements=>{if(statements[0]._sql.startsWith('INSERT INTO restore_guard'))sqlite.prepare("UPDATE family_accounts SET revision=revision+1 WHERE user_id='alice-uuid'").run();return realBatch(statements)};
const beforeCount=sqlite.prepare('SELECT count(*) AS n FROM recovery_snapshots').get().n;
const raced=await backups.POST(request('/api/backups','POST',{action:'restore',backup,fingerprint:fresh.fingerprint},'owner'));assert.equal(raced.status,409);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM recovery_snapshots').get().n,beforeCount);DB.batch=realBatch;
console.log('Passed: owner-only settings and backups, password-only sign-in with nothing to set up, coach assignment/revocation/isolation, encrypted backups, wrong passphrase/tamper rejection, restore rollback and recovery snapshot, concurrent-change protection.');
