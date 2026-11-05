export const MAX_PRACTICE_MINUTES=90;
export const planKinds=['warmup','drill','technique','live','conditioning','cooldown','custom'] as const;
export type PlanBlock={id:string;kind:typeof planKinds[number];title:string;minutes:number|null;notes:string};
export type PracticePlan={title:string;objective:string;sections:PlanBlock[];notes:string};
export function validPracticePlan(value:unknown):value is PracticePlan{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const p=value as PracticePlan;
 return typeof p.title==='string'&&p.title.trim().length>0&&p.title.length<=120&&typeof p.objective==='string'&&p.objective.length<=5000&&typeof p.notes==='string'&&p.notes.length<=5000&&Array.isArray(p.sections)&&p.sections.length>=1&&p.sections.length<=30&&new Set(p.sections.map(b=>b?.id)).size===p.sections.length&&p.sections.every(b=>b&&typeof b.id==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(b.id)&&planKinds.includes(b.kind)&&typeof b.title==='string'&&b.title.trim().length>0&&b.title.length<=80&&typeof b.notes==='string'&&b.notes.length<=5000&&(Number.isInteger(b.minutes)&&Number(b.minutes)>=1&&Number(b.minutes)<=MAX_PRACTICE_MINUTES))&&p.sections.reduce((total,b)=>total+Number(b.minutes),0)<=MAX_PRACTICE_MINUTES&&JSON.stringify(p).length<=30000;
}
export function cleanPracticePlan(p:PracticePlan):PracticePlan{return {title:p.title.trim(),objective:p.objective.trim(),notes:p.notes.trim(),sections:p.sections.map(b=>({id:b.id,kind:b.kind,title:b.title.trim(),minutes:b.minutes,notes:b.notes.trim()}))}}
