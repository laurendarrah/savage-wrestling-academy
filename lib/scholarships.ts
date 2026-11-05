import {env} from 'cloudflare:workers';

export const scholarshipDraft=`DRAFT FOR ATTORNEY REVIEW — acceptance is closed.

SWA proposes a full tuition scholarship for the named wrestler in the selected program. Tuition charged to the family is $0. Camps, clinics, Friday Night Live, travel, and private lessons are separate unless an award expressly includes them.

The proposed scholarship starts when the parent/guardian accepts the final agreement and continues until ended under that agreement. School wrestling obligations, medical needs, approved opportunities, notice procedures, and applicable cancellation rights must be addressed in the final text.

Owner proposal for counsel: require the wrestler to remain in SWA. If the wrestler leaves the program or attends another wrestling program, the parent/guardian would repay the cumulative value of scholarship tuition provided after signing, potentially spanning multiple years. Counsel must determine whether any repayment condition is lawful and draft its triggers, exceptions, duration, cap, and notices.

This draft creates no repayment obligation. Recorded scholarship value is informational and is not an invoice or debt. Earlier unconditional free training is not converted into a new repayment obligation. No automatic repayment charge or collection is configured.

An attorney must finalize the agreement before SWA opens acceptance. The parent/guardian must receive the final terms and accept them before the scholarship starts.`;

export type Scholarship={id:string;token_hash:string;recipient_email:string;wrestler_name:string;program:string;reference_cents:number;terms_text:string;terms_ready:number;revision:number;status:string;user_id:string|null;wrestler_id:string|null;signer:string|null;accepted_at:string|null;signature_record:string|null;ended_at:string|null;expires_at:string;created_at:string;created_by:string};
export async function inviteHash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join('')}
export function newInviteToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
export const validInvite=(token:unknown):token is string=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);
export function benefitSummary(award:Scholarship,now=new Date()){
 if(!award.accepted_at)return {completedMonths:0,valueCents:0};
 const nyDate=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 const start=nyDate(new Date(award.accepted_at)),end=nyDate(new Date(Math.min(now.getTime(),award.ended_at?Date.parse(award.ended_at):Infinity)));
 const [y,m,d]=start.split('-').map(Number),[ey,em]=end.split('-').map(Number);
 let months=Math.max(0,(ey-y)*12+em-m);
 const anniversaryDay=Math.min(d,new Date(Date.UTC(ey,em,0)).getUTCDate());
 const anniversary=`${ey}-${String(em).padStart(2,'0')}-${String(anniversaryDay).padStart(2,'0')}`;
 if(end<anniversary)months=Math.max(0,months-1);
 return {completedMonths:months,valueCents:months*award.reference_cents};
}
export function scholarshipView(award:Scholarship,now=new Date()){
 const {token_hash,created_by,signature_record,...visible}=award;
 return {...visible,...benefitSummary(award,now),tuitionCents:0,signatureCaptured:!!signature_record,inviteExpired:Date.parse(award.expires_at)<=now.getTime()};
}
export async function hasScholarship(userId:string,wrestlerId:string,program?:string){
 const row=await env.DB!.prepare("SELECT program FROM scholarship_awards WHERE user_id=? AND wrestler_id=? AND status='active'").bind(userId,wrestlerId).first<{program:string}>();
 return !!row&&(!program||row.program===program);
}
