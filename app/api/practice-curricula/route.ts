import {env} from 'cloudflare:workers';
import {ownerIdentity,accountReply,sameOrigin} from '../../../lib/account-auth';
import {validPracticePlan,cleanPracticePlan} from '../../../lib/practice-plans';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(v);
export async function GET(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 const id=new URL(request.url).searchParams.get('id');
 if(id!==null){if(!identifier(id))return reply({error:'Choose a saved lesson.'},400);const row=await env.DB!.prepare('SELECT id,curriculum_id,lesson_order,name,payload,revision,updated_at FROM practice_curricula WHERE id=?').bind(id).first<{id:string;curriculum_id:string|null;lesson_order:number;name:string;payload:string;revision:number;updated_at:string}>();if(!row)return reply({error:'Lesson not found. Refresh the library.'},404);return reply({curriculum:{id:row.id,curriculumId:row.curriculum_id,lessonOrder:row.lesson_order,name:row.name,data:JSON.parse(row.payload),revision:row.revision,updatedAt:row.updated_at}})}
 const groups=await env.DB!.prepare('SELECT id,program,name,revision,updated_at FROM practice_curriculum_groups ORDER BY program,name_key').all();
 const lessons=await env.DB!.prepare('SELECT id,curriculum_id,lesson_order,name,revision,updated_at FROM practice_curricula ORDER BY curriculum_id,lesson_order,name_key').all();
 return reply({groups:groups.results,curricula:lessons.results});
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Only the owner can edit program curricula.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>40000)return reply({error:'Lesson is too long.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||!Number.isInteger(input.revision)||input.revision<0||(input.id!==undefined&&!identifier(input.id)))return reply({error:'Enter a name and reload the current version before editing.'},400);
 if((input.id&&input.revision===0)||(!input.id&&input.revision!==0))return reply({error:'Reload the current version before updating.'},400);
 const id=input.id||crypto.randomUUID(),name=input.name.trim(),nameKey=name.toLocaleLowerCase('en-US'),now=new Date().toISOString();
 if(input.action==='saveGroup'){
 if(!['Elementary','Intermediate','Advanced'].includes(input.program))return reply({error:'Choose a valid program.'},400);
 const row=input.id?await env.DB!.prepare('UPDATE practice_curriculum_groups SET name=?,name_key=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND program=? AND revision=? AND NOT EXISTS (SELECT 1 FROM practice_curriculum_groups WHERE program=? AND name_key=? AND id!=?) RETURNING revision').bind(name,nameKey,auth.user!.id,now,id,input.program,input.revision,input.program,nameKey,id).first<{revision:number}>():await env.DB!.prepare('INSERT INTO practice_curriculum_groups(id,program,name,name_key,revision,updated_by,updated_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(program,name_key) DO NOTHING RETURNING revision').bind(id,input.program,name,nameKey,auth.user!.id,now).first<{revision:number}>();
 if(!row)return reply({error:'That curriculum name is in use for this program, or the curriculum changed. Refresh before editing.'},409);await securityEvent(auth.user!.id,'program_curriculum_saved',id);return reply({id,revision:row.revision,updatedAt:now});
 }
 if(input.action!=='save'||!identifier(input.curriculumId)||!Number.isInteger(input.lessonOrder)||input.lessonOrder<1||input.lessonOrder>10000||!validPracticePlan(input.data))return reply({error:'Choose a program curriculum, lesson number, and valid lesson plan.'},400);
 const group=await env.DB!.prepare('SELECT id FROM practice_curriculum_groups WHERE id=?').bind(input.curriculumId).first<{id:string}>();if(!group)return reply({error:'Curriculum not found. Create or select a program curriculum first.'},404);
 const payload=JSON.stringify(cleanPracticePlan(input.data));
 const row=input.id?await env.DB!.prepare('UPDATE practice_curricula SET name=?,name_key=?,lesson_order=?,payload=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND curriculum_id=? AND revision=? AND NOT EXISTS (SELECT 1 FROM practice_curricula WHERE curriculum_id=? AND name_key=? AND id!=?) RETURNING revision').bind(name,nameKey,input.lessonOrder,payload,auth.user!.id,now,id,input.curriculumId,input.revision,input.curriculumId,nameKey,id).first<{revision:number}>():await env.DB!.prepare('INSERT INTO practice_curricula(id,curriculum_id,lesson_order,name,name_key,payload,revision,updated_by,updated_at) VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT(curriculum_id,name_key) DO NOTHING RETURNING revision').bind(id,input.curriculumId,input.lessonOrder,name,nameKey,payload,auth.user!.id,now).first<{revision:number}>();
 if(!row)return reply({error:'That lesson name is already in this curriculum, or the lesson changed. Refresh the library before saving.'},409);
 await securityEvent(auth.user!.id,input.id?'curriculum_lesson_updated':'curriculum_lesson_created',id);return reply({id,revision:row.revision,updatedAt:now});
}
