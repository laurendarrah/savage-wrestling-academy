import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load,request,sqlite} from './accounts.mjs';

const attendance=load('app/api/attendance/route.ts'),pass=load('app/api/wrestler-pass/route.ts');
const directory=load('app/accounts/route.ts'),family=load('app/api/family/route.ts'),registration=load('app/api/registration/route.ts');
const {attendanceToday}=load('lib/program-attendance.ts');
const today=attendanceToday();
const shift=days=>new Date(Date.parse(today)+days*86400000).toISOString().slice(0,10);
const tomorrow=shift(1),end=shift(20);
const programs=[{id:'Elementary',name:'SWA Development'},{id:'Intermediate',name:'SWA Intermediate'}];
const weekly=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day=>({day,start:'17:00',end:'18:00'}));
const seasons=programs.map(p=>({program:p.id,start:shift(-2),end,weekly,excludedDates:[]}));
const settings=()=>JSON.stringify({programs,seasons});
const updateSettings=()=>sqlite.prepare(`INSERT INTO academy_state (id,payload,revision,updated_by,updated_at)
 VALUES('academy',?,1,'test',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).run(settings(),today);
updateSettings();
const alice={parentName:'Alice',phone:'',wrestlers:[{id:'athlete-a',name:'Wrestler A',grade:'5'},{id:'alice-older',name:'Older Sibling',grade:'8'}]};
const bob={parentName:'Bob',phone:'',wrestlers:[{id:'bob-1',name:'Wrestler B',grade:'6'}]};
await family.PUT(request('/api/family','PUT',{revision:2,data:alice},'alice'));
await family.PUT(request('/api/family','PUT',{revision:0,data:bob},'bob'));
const ownerPost=body=>attendance.POST(request('/api/attendance','POST',body,'owner'));
const day=async(date,practice)=>await (await attendance.GET(request('/api/attendance?'+new URLSearchParams({date,...(practice?{practice}:{})}),'GET',null,'owner'))).json();
const practiceId='Elementary:'+today+':17:00';
const walkin={action:'enroll',userId:'alice-uuid',wrestlerId:'athlete-a',program:'Elementary',kind:'walkin',date:today,practiceId};
const membership={action:'enroll',userId:'bob-uuid',wrestlerId:'bob-1',program:'Elementary',kind:'membership',date:today,endsOn:end};
assert.equal((await attendance.GET(request('/api/attendance','GET',null,'alice'))).status,403);
assert.equal((await attendance.POST(request('/api/attendance','POST',walkin,'owner','https://evil.test'))).status,403);
assert.equal((await ownerPost({...walkin,practiceId:'Intermediate:'+today+':17:00'})).status,409);
const review=await registration.POST(request('/api/registration','POST',{...walkin,plan:'walkin'},'alice'));
assert.equal(review.status,200);
assert.equal((await review.json()).paymentsEnabled,false);
assert.deepEqual((await day(today,practiceId)).roster,[]);
assert.equal((await ownerPost(walkin)).status,201);
assert.equal((await ownerPost(walkin)).status,409);
assert.equal((await ownerPost(membership)).status,201);
assert.equal((await ownerPost(membership)).status,409);
assert.equal((await family.PUT(request('/api/family','PUT',{revision:3,data:{...alice,wrestlers:[]}},'alice'))).status,409);
const directoryHtml=await (await directory.GET(request('/accounts?program=Elementary','GET',null,'owner'))).text();
assert.match(directoryHtml,/Wrestler A/);assert.match(directoryHtml,/Wrestler B/);
assert.doesNotMatch(directoryHtml,/Older Sibling/);
assert.doesNotMatch(await (await directory.GET(request('/accounts?program=Intermediate','GET',null,'owner'))).text(),/Wrestler A/);
assert.deepEqual((await day(today,practiceId)).roster.map(w=>w.kind),['walk-in','membership']);
assert.deepEqual((await day(tomorrow,'Elementary:'+tomorrow+':17:00')).roster.map(w=>w.kind),['membership']);
assert.equal((await pass.POST(request('/api/wrestler-pass','POST',{wrestlerId:'athlete-a'},'bob'))).status,404);
const getPass=async()=>await (await pass.POST(request('/api/wrestler-pass','POST',{wrestlerId:'athlete-a'},'alice'))).json();
const {code}=await getPass();
assert.equal((await getPass()).code,code);
assert.match(code,/^SWA1:[a-f0-9]{32}$/);
assert.equal((await ownerPost({action:'scan',date:today,practiceId:'Intermediate:'+today+':17:00',code})).status,409);
const cards=load('app/usa-card/route.ts');
const memberPath='/usa-card?wrestler=athlete-a',ownerPath=memberPath+'&account=alice-uuid';
const image=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const upload=(revision=0,expires=end,actor='alice')=>cards.POST(new Request('https://academy.test'+memberPath,{
 method:'POST',headers:{origin:'https://academy.test','content-type':'image/png','x-card-number':'12345678',
 'x-card-expires':expires,'x-card-revision':String(revision),cookie:'test-session='+actor},body:image
}));
const verify=(revision,confirmed=true)=>cards.POST(request(ownerPath,'POST',{revision,confirmed},'owner'));
const scanAlice=()=>ownerPost({action:'scan',date:today,practiceId,code});
assert.equal((await scanAlice()).status,409);
assert.equal((await day(today,practiceId)).roster[0].cardStatus,'missing');
assert.equal((await upload(0,end,'bob')).status,404);
assert.equal((await upload(0,shift(-1))).status,200);
assert.equal((await day(today,practiceId)).roster[0].cardStatus,'expired');
assert.equal((await verify(1)).status,409);
assert.equal((await upload(1)).status,200);
assert.equal((await day(today,practiceId)).roster[0].cardStatus,'pending');
assert.equal((await scanAlice()).status,409);
assert.equal((await cards.GET(request(ownerPath+'&photo=1','GET',null,'alice'))).status,403);
const photo=await cards.GET(request(ownerPath+'&photo=1','GET',null,'owner'));
assert.equal(photo.status,200);
assert.equal(photo.headers.get('content-type'),'image/png');
assert.match(photo.headers.get('cache-control'),/no-store/);
assert.equal((await verify(2,false)).status,400);
assert.match(await (await cards.GET(request(ownerPath,'GET',null,'owner'))).text(),/usawmembership\.com\/verify_membership/);
assert.equal((await verify(2)).status,200);
assert.equal((await upload(2)).status,409);
assert.equal((await upload(3)).status,200);
assert.equal((await day(today,practiceId)).roster[0].cardStatus,'pending');
assert.equal((await verify(3)).status,409);
assert.equal((await verify(4)).status,200);
const reminder=await (await cards.GET(request(ownerPath,'GET',null,'owner'))).text();
assert.match(reminder,/Renewal due within 30 days/);
assert.match(reminder,/mailto:alice%40example.test/);
assert.doesNotMatch(reminder,/body=[^"]*12345678/);
assert.match(await (await directory.GET(request('/accounts','GET',null,'owner'))).text(),/USA Wrestling cards expiring in the next 30 days \(1\)/);
const blockedManual=await ownerPost({action:'check',date:today,practiceId,userId:'bob-uuid',wrestlerId:'bob-1'});
assert.equal(blockedManual.status,409);
assert.match((await blockedManual.json()).error,/card missing/);
assert.equal((await day(today,practiceId)).roster[0].cardStatus,'current');
sqlite.prepare(`INSERT INTO wrestler_membership_cards(user_id,wrestler_id,card_number,expires_on,photo_key,photo_type,revision,verified_at)
 VALUES('bob-uuid','bob-1','test',?,'sample','image/png',1,?)`).run(end,today);
assert.equal((await ownerPost({action:'scan',date:today,practiceId,code})).status,200);
assert.equal((await ownerPost({action:'scan',date:today,practiceId,code})).status,200);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM attendance_checkins').get().n,1);
assert.equal((await day(today,practiceId)).roster[0].method,'qr');
const bobCheckin={date:today,practiceId,userId:'bob-uuid',wrestlerId:'bob-1'};
assert.equal((await ownerPost({...bobCheckin,action:'check'})).status,200);
assert.equal((await day(today,practiceId)).roster[1].method,'manual');
assert.equal((await ownerPost({...bobCheckin,action:'undo'})).status,200);
assert.equal((await day(today,practiceId)).roster[1].checkedAt,null);
const old=weekly.map(w=>({...w,start:'18:00',end:'19:00'}));
seasons[0].weekly=old;updateSettings();
assert.equal((await day(today,practiceId)).practice.scheduled,false);
assert.deepEqual((await day(today,practiceId)).roster.map(w=>w.kind),['walk-in']);
assert.deepEqual((await day(today,'Elementary:'+today+':18:00')).roster.map(w=>w.kind),['membership']);

sqlite.prepare(`INSERT INTO scholarship_awards
 (id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,status,user_id,wrestler_id,accepted_at,expires_at,created_at,created_by)
 VALUES('scholarship','hash','alice@example.test','Older Sibling','Intermediate',0,'test','active','alice-uuid','alice-older',?,?,?,'test')`)
 .run(today+'T12:00:00Z',end,today);
assert.deepEqual((await day(today,'Intermediate:'+today+':17:00')).roster.map(w=>w.kind),['scholarship']);
assert.deepEqual((await day(shift(-1),'Intermediate:'+shift(-1)+':17:00')).roster,[]);
const setup=load('app/api/test-family/route.ts');
sqlite.prepare(`INSERT INTO document_templates (id,title,kind,body,revision,archived,created_at,updated_at)
 VALUES('test-source','Parent Consent Form','waiver','Sample wording',1,0,?,?)`).run(today,today);
assert.equal((await setup.POST(request('/api/test-family','POST',{selection:'draft:test-source:1'},'owner'))).status,200);
const testPracticeId='test:Elementary:'+today+':18:00';
const testDay=async()=>await (await attendance.GET(request('/api/attendance?'+new URLSearchParams({date:today,test:'1',practice:testPracticeId}),'GET',null,'owner'))).json();
assert.deepEqual((await testDay()).roster.map(w=>w.wrestlerId),['swa-test-development']);
assert.deepEqual((await day(today,'Elementary:'+today+':18:00')).roster.map(w=>w.wrestlerId),['bob-1']);
const testPass=await pass.POST(request('/api/wrestler-pass','POST',{wrestlerId:'swa-test-development'},'owner'));
assert.equal(testPass.status,200);
const testCode=(await testPass.json()).code;
assert.equal((await ownerPost({action:'scan',date:today,practiceId:'Elementary:'+today+':18:00',code:testCode})).status,409);
assert.equal((await ownerPost({action:'scan',date:today,practiceId:testPracticeId,code,test:true})).status,409);
assert.equal((await ownerPost({action:'scan',date:today,practiceId:testPracticeId,code:testCode,test:true})).status,200);
assert.equal((await testDay()).roster[0].method,'qr');
assert.deepEqual((await day(today,'Elementary:'+today+':18:00')).roster.map(w=>w.wrestlerId),['bob-1']);
const qr={window:{},Uint8ClampedArray};
for(const file of ['public/qr-preview.js','public/jsqr-1.4.0.js'])vm.runInNewContext(readFileSync(file,'utf8'),qr);
const svg=qr.window.sampleQrSvg(code,true);
const side=Number(svg.match(/viewBox="0 0 (\d+) /)[1]),scale=5,size=side*scale;
const pixels=new Uint8ClampedArray(size*size*4).fill(255);
for(const [,x,y] of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)){
 for(let row=+y*scale;row<(+y+1)*scale;row++)for(let col=+x*scale;col<(+x+1)*scale;col++){
  pixels.fill(0,(row*size+col)*4,(row*size+col)*4+3);
 }
}
assert.equal((qr.jsQR??qr.window.jsQR)(pixels,size,size).data,code);
console.log('Passed: program filters, exact walk-in roster, recurring membership, private passes, QR round-trip, check-in and undo, duplicate protection, and schedule changes.');

const getProfile=async who=>(await (await family.GET(request('/api/family','GET',null,who))).json());
const beforeDetails=await getProfile('alice');
const baseDetails=beforeDetails.data,revision=beforeDetails.revision;
const details={...baseDetails,homeAddress:' 100 Sample Lane ',homeCity:'Huntington Station',homeState:'NY',homeZip:'11746',emergencyContactName:'Backup Contact',emergencyContactPhone:'555-0101',
 wrestlers:[{...baseDetails.wrestlers[0],birthDate:'2016-02-29',allergies:'Peanuts'},...baseDetails.wrestlers.slice(1)]};
const putDetails=(data,rev)=>family.PUT(request('/api/family','PUT',{revision:rev,data},'alice'));
for(const birthDate of ['2017-02-29','2099-01-01']){
 const invalid={...details,wrestlers:[{...details.wrestlers[0],birthDate},...details.wrestlers.slice(1)]};
 assert.equal((await putDetails(invalid,revision)).status,400);
}
assert.equal((await putDetails(details,revision)).status,200);
assert.equal((await putDetails(baseDetails,revision+1)).status,200);
assert.equal((await getProfile('alice')).data.homeAddress,'100 Sample Lane');
assert.equal((await getProfile('alice')).data.homeCity,'Huntington Station');
assert.equal((await getProfile('alice')).data.homeState,'NY');
assert.equal((await getProfile('alice')).data.homeZip,'11746');
assert.equal((await getProfile('alice')).data.wrestlers[0].allergies,'Peanuts');
assert.equal((await getProfile('bob')).data.homeAddress,undefined);
const checkin=await (await attendance.GET(request('/api/attendance?account=alice-uuid&wrestler=athlete-a','GET',null,'owner'))).json();
assert.equal(checkin.wrestler.birthDate,undefined);
assert.equal(checkin.wrestler.allergies,undefined);
const cleared={...baseDetails,homeAddress:'',homeCity:'',homeState:'',homeZip:'',emergencyContactName:'',emergencyContactPhone:'',
 wrestlers:[{...baseDetails.wrestlers[0],birthDate:'',allergies:''},...baseDetails.wrestlers.slice(1)]};
assert.equal((await putDetails(cleared,revision+2)).status,200);
assert.equal((await getProfile('alice')).data.homeAddress,undefined);
assert.equal((await getProfile('alice')).data.wrestlers[0].birthDate,undefined);
console.log('Passed: private profile fields, invalid dates, legacy updates, and intentional clearing.');
