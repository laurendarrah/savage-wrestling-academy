import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync('app/family/screen.html','utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
const nodes=new Map();
function element(id){if(!nodes.has(id))nodes.set(id,{hidden:id==='summary',value:'',textContent:'',innerHTML:'',focus(){this.focused=true},scrollIntoView(){},elements:{parentName:{value:'',focus(){}},phone:{value:''}}});return nodes.get(id)}
let stored={parentName:'Test Parent',phone:'555-0100',wrestlers:[{id:'test-id',name:'Test Wrestler',grade:'5'}]},revision=1;
let rejectSave=false;
const context=vm.createContext({document:{getElementById:element},location:{},URLSearchParams,crypto:{randomUUID:()=> 'new-id'},fetch:async(path,options)=>{if(options?.method==='PUT'){if(rejectSave)return{ok:false,json:async()=>({error:'Connection failed.'})};const body=JSON.parse(options.body);stored=body.data;revision++}return{ok:true,status:200,json:async()=>({email:'test@example.test',data:structuredClone(stored),revision,updatedAt:'2026-10-16T12:30:00Z'})}}});
vm.runInContext(script,context);
const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
assert.equal(element('editor').hidden,true);assert.equal(element('summary').hidden,false);assert.match(element('savedDetails').innerHTML,/Test Wrestler/);
// Issue #127: no timestamp status line; the saved time reads in New York time, not the browser's locale format.
assert.equal(element('status').textContent,'');assert.equal(element('savedTime').textContent,'Last saved Fri, Oct 16 · 8:30 AM.');
vm.runInContext('editProfile()',context);element('familyForm').elements.parentName.value='Updated Parent';element('name0').value='Updated Wrestler';element('grade0').value='6';
await element('familyForm').onsubmit({preventDefault(){}});
assert.equal(stored.wrestlers[0].name,'Updated Wrestler');assert.equal(element('editor').hidden,true);assert.equal(element('status').textContent,'Your changes are saved.');assert.equal(element('summary').focused,true);
vm.runInContext('editProfile()',context);element('familyForm').elements.parentName.value='Unsaved';vm.runInContext('cancelProfileEdit()',context);assert.match(element('contactRows').innerHTML,/Updated Parent/);assert.doesNotMatch(element('contactRows').innerHTML,/Unsaved/);assert.equal(element('status').textContent,'Nothing was changed.');
vm.runInContext('editProfile()',context);rejectSave=true;await element('familyForm').onsubmit({preventDefault(){}});assert.equal(element('editor').hidden,false);assert.match(element('status').textContent,/not been saved/);assert.equal(element('save').disabled,false);
console.log('Passed: saved-profile landing, save confirmation, edit, cancel, and visible save errors.');
// Billing UI must not mistake a saved profile or a registration review for a payment.
assert.match(element('membershipCards').innerHTML,/Not enrolled/);assert.match(element('membershipCards').innerHTML,/Updated Wrestler/);assert.match(element('membershipCards').innerHTML,/wrestler=test-id/);assert.doesNotMatch(element('membershipCards').innerHTML,/\$200|November 1, 2026|Next automatic payment/);
vm.runInContext("profile.wrestlers[0].membership={status:'active',nextCharge:1};renderMembershipCards()",context);assert.match(element('membershipCards').innerHTML,/Not enrolled/);
assert.match(html,/No purchases yet/);
// Issue #147 and #46: no example membership or purchase history with a fictional wrestler. Only the family's own records show.
for(const gone of [/Alex Example/,/Jamie Example/,/billingExample/,/sample-billing/,/sample-receipt/,/renderBillingExample/,/examplePurchases/,/renderExamplePurchases/,/toggleSampleReceipt/,/toggleSampleManagement/,/Fictional/i,/EXAMPLE-001/,/example receipt/i])assert.doesNotMatch(html,gone,String(gone));
assert.doesNotMatch(html,/\.sample-|\.next-charge|\.billing-controls/,'no CSS left for the removed example');
vm.runInContext("profile.wrestlers=[];renderMembershipCards()",context);assert.match(element('membershipCards').innerHTML,/Add your wrestler/);
console.log('Passed: unpaid account membership cards, wrestler-specific registration link, no client-forged billing state, no fictional example history, and empty family.');

vm.runInContext(`profile.wrestlers=[{id:'scholar-kid',name:'Scholar Wrestler',grade:'7'}];scholarshipAwards=[{wrestler_id:'scholar-kid',status:'active',program:'Intermediate',accepted_at:'2026-11-05T17:00:00Z',terms_text:'Accepted scholarship terms',signer:'Parent'}];renderMembershipCards()`,context);
assert.match(element('membershipCards').innerHTML,/Active scholarship/);
assert.match(element('membershipCards').innerHTML,/\$0.00 tuition/);
assert.match(element('membershipCards').innerHTML,/Accepted scholarship terms/);
assert.doesNotMatch(element('membershipCards').innerHTML,/Not enrolled|pay monthly/);
vm.runInContext("scholarshipAwards[0].status='ended';renderMembershipCards()",context);
assert.doesNotMatch(element('membershipCards').innerHTML,/Active scholarship/);
console.log('Passed: accepted free scholarships render as membership cards and ended awards do not grant active membership.');
