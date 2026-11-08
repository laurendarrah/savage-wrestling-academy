import {env} from 'cloudflare:workers';
import type {FamilyProfile} from './family-records';
export type Wrestler=FamilyProfile['wrestlers'][number];
export async function familyProfile(userId:string){const row=await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(userId).first<{payload:string}>();return row?JSON.parse(row.payload) as FamilyProfile:null}
export const HIGH_SCHOOL=['7','8','9','10','11','12'];
export function requiresApproval(program:string,w:Wrestler){return program==='Advanced'&&HIGH_SCHOOL.includes(w.grade)}
export type ApprovalRow={id?:string;status:string;wrestler_name:string;grade:string};
const sameName=(a:unknown,b:unknown)=>String(a??'').trim().toLowerCase()===String(b??'').trim().toLowerCase();
// An SWA Advance decision belongs to the wrestler, not to the grade they were in when they asked (issue #271): it stays
// valid through a grade change within 7–12, so a family is not sent back to "not requested" every September. It stops
// applying when the entry's name changes (the family may have renamed it to another child, issue #97) or the wrestler
// leaves grades 7–12. The owner's page shows "Requested as Grade 9, now Grade 10" from the stored grade.
export function approvalApplies(row:ApprovalRow|null|undefined,w:Pick<Wrestler,'name'|'grade'>){return !!row&&sameName(row.wrestler_name,w.name)&&HIGH_SCHOOL.includes(w.grade)}
// SQL for the same rule: the approval row (by its alias or table name) against a wrestler object w from json_each(f.payload,'$.wrestlers').
export const approvalAppliesSql=(row:string)=>`lower(trim(json_extract(w.value,'$.name')))=lower(trim(${row}.wrestler_name)) AND json_extract(w.value,'$.grade') IN ('7','8','9','10','11','12')`;
export async function approvalStatus(userId:string,w:Wrestler){
 const row=await env.DB!.prepare("SELECT status,wrestler_name,grade FROM program_approvals WHERE user_id=? AND wrestler_id=? AND program='Advanced'").bind(userId,w.id).first<ApprovalRow>();
 return approvalApplies(row,w)?row!.status:'not_requested';
}
export async function checkCompetitionAccess(userId:string,program:string,w:Wrestler){
 if(program==='Elementary')return ['K','1','2','3','4','5','6'].includes(w.grade)?null:'SWA Development is for grades K–6. Choose a program that matches this wrestler’s saved grade.';
 if(program==='Intermediate')return HIGH_SCHOOL.includes(w.grade)?null:'SWA Intermediate is for grades 7–12. Choose a program that matches this wrestler’s saved grade.';
 if(program!=='Advanced')return 'Choose an available program.';
 if(!HIGH_SCHOOL.includes(w.grade))return 'SWA Advance is for grades 7–12 and requires coach approval.';
 if(requiresApproval(program,w)&&await approvalStatus(userId,w)!=='approved')return 'Contact Justin and receive approval before registering for SWA Advance.';
 return null;
}
