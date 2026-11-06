import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync('app/family/screen.html','utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
const nodes=new Map();
function element(id){if(!nodes.has(id))nodes.set(id,{hidden:id==='summary',value:'',textContent:'',innerHTML:'',focus(){this.focused=true},scrollIntoView(){},elements:{parentName:{value:'',focus(){}},phone:{value:''},homeAddress:{value:''},homeCity:{value:''},homeState:{value:''},homeZip:{value:''},emergencyContactName:{value:''},emergencyContactPhone:{value:''}}});return nodes.get(id)}
let stored={parentName:'Test Parent',phone:'555-0100',wrestlers:[{id:'test-id',name:'Test Wrestler',grade:'5'}]},revision=1;
let rejectSave=false;
const context=vm.createContext({document:{getElementById:element},location:{},crypto:{randomUUID:()=> 'new-id'},fetch:async(path,options)=>{if(options?.method==='PUT'){if(rejectSave)return{ok:false,json:async()=>({error:'Connection failed.'})};const body=JSON.parse(options.body);stored=body.data;revision++}return{ok:true,status:200,json:async()=>({email:'test@example.test',data:structuredClone(stored),revision,updatedAt:'2026-10-16T12:30:00Z'})}}});
vm.runInContext(script,context);
const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
assert.equal(element('editor').hidden,true);assert.equal(element('summary').hidden,false);assert.match(element('savedDetails').innerHTML,/Test Wrestler/);
vm.runInContext('editProfile()',context);element('familyForm').elements.parentName.value='Updated Parent';element('name0').value='Updated Wrestler';element('grade0').value='6';
element('familyForm').elements.homeAddress.value='100 Sample Lane';
element('familyForm').elements.homeCity.value='Huntington Station';
element('familyForm').elements.homeState.value='NY';
element('familyForm').elements.homeZip.value='11746';
element('familyForm').elements.emergencyContactName.value='Backup Contact';
element('familyForm').elements.emergencyContactPhone.value='555-0101';
element('birthDate0').value='2016-02-29';
element('allergies0').value='Peanuts <sample>';
await element('familyForm').onsubmit({preventDefault(){}});
assert.equal(stored.wrestlers[0].name,'Updated Wrestler');assert.equal(element('editor').hidden,true);assert.match(element('status').textContent,/Success!/);assert.equal(element('summary').focused,true);
assert.equal(stored.homeAddress,'100 Sample Lane');
assert.equal(stored.homeCity,'Huntington Station');
assert.equal(stored.homeState,'NY');
assert.equal(stored.homeZip,'11746');
assert.match(element('savedDetails').innerHTML,/Huntington Station, NY 11746/);
assert.match(element('savedDetails').innerHTML,/USA Wrestling card/);
assert.equal(stored.wrestlers[0].birthDate,'2016-02-29');
assert.match(element('savedDetails').innerHTML,/February 29, 2016/);
assert.match(element('savedDetails').innerHTML,/Backup Contact · 555-0101/);
assert.match(element('savedDetails').innerHTML,/Peanuts &lt;sample&gt;/);
vm.runInContext('editProfile()',context);element('familyForm').elements.parentName.value='Unsaved';vm.runInContext('cancelEdit()',context);assert.match(element('savedDetails').innerHTML,/Updated Parent/);assert.doesNotMatch(element('savedDetails').innerHTML,/Unsaved/);
vm.runInContext('editProfile()',context);rejectSave=true;await element('familyForm').onsubmit({preventDefault(){}});assert.equal(element('editor').hidden,false);assert.match(element('status').textContent,/not been saved/);assert.equal(element('save').disabled,false);
console.log('Passed: saved-profile landing, save confirmation, edit, cancel, and visible save errors.');
// Billing UI must not mistake a saved profile or a registration review for a payment.
assert.match(element('membershipCards').innerHTML,/Not enrolled/);assert.match(element('membershipCards').innerHTML,/Updated Wrestler/);assert.match(element('membershipCards').innerHTML,/wrestler=test-id/);assert.doesNotMatch(element('membershipCards').innerHTML,/\$200|November 1, 2026|Next automatic payment/);
vm.runInContext("profile.wrestlers[0].membership={status:'active',nextCharge:1};renderMembershipCards()",context);assert.match(element('membershipCards').innerHTML,/Not enrolled/);
assert.match(html,/No purchases yet/);assert.match(html,/Fictional wrestler and payments/);
vm.runInContext("renderBillingExample()",context);assert.match(element('sampleMembershipDetails').innerHTML,/next automatic payment is \$200.00 on December 1/);assert.match(element('sampleMembershipDetails').innerHTML,/November 30/);
element('sampleStatus').value='cancelled';vm.runInContext('renderBillingExample()',context);assert.match(element('sampleMembershipDetails').innerHTML,/No upcoming renewal payment/);assert.equal(element('sampleMemberStatus').textContent,'Renewal cancelled');
element('sampleStatus').value='past_due';vm.runInContext('renderBillingExample()',context);assert.match(element('sampleMembershipDetails').innerHTML,/failed on December 1/);assert.match(element('sampleMembershipDetails').innerHTML,/Last successful payment/);assert.equal(element('sampleMemberStatus').textContent,'Payment needs attention');
element('samplePurchaseType').value='walkin';vm.runInContext('renderExamplePurchases()',context);assert.match(element('samplePurchases').innerHTML,/Single-practice walk-in/);assert.match(element('samplePurchases').innerHTML,/\$40.00/);assert.doesNotMatch(element('samplePurchases').innerHTML,/Monthly membership/);
element('samplePurchaseType').value='clinic';vm.runInContext('renderExamplePurchases()',context);assert.match(element('samplePurchases').innerHTML,/No example purchases/);
element('sampleReceipt').hidden=true;vm.runInContext('toggleSampleReceipt()',context);assert.equal(element('sampleReceipt').hidden,false);assert.equal(element('sampleReceipt').focused,true);vm.runInContext('toggleSampleReceipt()',context);assert.equal(element('sampleReceipt').hidden,true);
vm.runInContext("profile.wrestlers=[];renderMembershipCards()",context);assert.match(element('membershipCards').innerHTML,/Add your wrestler/);
console.log('Passed: unpaid account membership cards, wrestler-specific registration link, no client-forged billing state, separated examples, renewal/cancelled/failed payment displays, purchase filters, example receipt and empty family.');

vm.runInContext(`profile.wrestlers=[{id:'scholar-kid',name:'Scholar Wrestler',grade:'7'}];scholarshipAwards=[{wrestler_id:'scholar-kid',status:'active',program:'Intermediate',accepted_at:'2026-11-05T17:00:00Z',terms_text:'Accepted scholarship terms',signer:'Parent'}];renderMembershipCards()`,context);
assert.match(element('membershipCards').innerHTML,/Active scholarship/);
assert.match(element('membershipCards').innerHTML,/\$0.00 tuition/);
assert.match(element('membershipCards').innerHTML,/Accepted scholarship terms/);
assert.doesNotMatch(element('membershipCards').innerHTML,/Not enrolled|pay monthly/);
vm.runInContext("scholarshipAwards[0].status='ended';renderMembershipCards()",context);
assert.doesNotMatch(element('membershipCards').innerHTML,/Active scholarship/);
console.log('Passed: accepted free scholarships render as membership cards and ended awards do not grant active membership.');

// Family navigation keeps the header in place and shows one section at a time.
const tabNames=['summary','memberships','purchaseHistory','documents','lessons'];
const familyLocation={hash:''},listeners={},selected=[];
const makeElement=()=>({children:[],attributes:{},style:{},setAttribute(k,v){this.attributes[k]=v},
 removeAttribute(k){delete this.attributes[k]},getAttribute(k){return this.attributes[k]},addEventListener(name,fn){this[name]=fn},
 append(...children){this.children.push(...children)},scrollIntoView(){}});
const panels=tabNames.map(name=>Object.assign(makeElement(),{dataset:{familyPanel:name,
 tool:{documents:'/family-documents',lessons:'/private-lessons'}[name]}}));
const links=tabNames.map(name=>Object.assign(makeElement(),{hash:'#'+name}));
const navigation=Object.assign(makeElement(),{querySelectorAll:()=>links});
vm.runInNewContext(readFileSync('public/family-tabs.js','utf8'),{
 document:{getElementById:()=>navigation,querySelectorAll:()=>panels,createElement:makeElement},
 location:familyLocation,history:{pushState(_state,_title,hash){selected.push(hash);familyLocation.hash=hash}},
 window:{addEventListener(name,fn){listeners[name]=fn}},requestAnimationFrame:fn=>fn()
});
for(const [index,link] of links.entries()){
 let prevented=false;
 navigation.click({target:{closest:()=>link},button:0,preventDefault(){prevented=true}});
 assert.equal(prevented,true);
 assert.deepEqual(links.map(l=>l.attributes['aria-current']),tabNames.map((_,i)=>i===index?'page':undefined));
 assert.deepEqual(panels.map(p=>p.hidden),tabNames.map((_,i)=>i!==index));
}
assert.equal(panels[3].children[1].src,'/family-documents?embed=family');
assert.equal(panels[4].children[1].src,'/private-lessons?embed=family');
familyLocation.hash='#documents';listeners.popstate();
assert.equal(links[3].attributes['aria-current'],'page');
assert.equal(panels[3].children.length,2);
assert.equal(panels[3].hidden,false);
assert.equal(selected.at(-1),'#lessons');
console.log('Passed: family sections switch under a persistent menu, retain loaded tools, and restore the active button on Back.');
