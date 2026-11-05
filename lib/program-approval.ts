import {env} from 'cloudflare:workers';
import type {FamilyProfile} from './family-records';
export type Wrestler=FamilyProfile['wrestlers'][number];
export async function familyProfile(userId:string){const row=await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(userId).first<{payload:string}>();return row?JSON.parse(row.payload) as FamilyProfile:null}
export function requiresApproval(program:string,w:Wrestler){return program==='Advanced'&&['7','8','9','10','11','12'].includes(w.grade)}
export async function approvalStatus(userId:string,w:Wrestler){
 const row=await env.DB!.prepare("SELECT status,wrestler_name,grade FROM program_approvals WHERE user_id=? AND wrestler_id=? AND program='Advanced'").bind(userId,w.id).first<{status:string;wrestler_name:string;grade:string}>();
 return row&&row.wrestler_name===w.name&&row.grade===w.grade?row.status:'not_requested';
}
export async function checkCompetitionAccess(userId:string,program:string,w:Wrestler){
 if(program==='Elementary')return ['K','1','2','3','4','5','6'].includes(w.grade)?null:'SWA Development is for grades K–6. Choose a program that matches this wrestler’s saved grade.';
 if(program==='Intermediate')return ['7','8','9','10','11','12'].includes(w.grade)?null:'SWA Intermediate is for grades 7–12. Choose a program that matches this wrestler’s saved grade.';
 if(program!=='Advanced')return 'Choose an available program.';
 if(!['7','8','9','10','11','12'].includes(w.grade))return 'SWA Advance is for grades 7–12 and requires coach approval.';
 if(requiresApproval(program,w)&&await approvalStatus(userId,w)!=='approved')return 'Contact Justin and receive approval before registering for SWA Advance.';
 return null;
}
