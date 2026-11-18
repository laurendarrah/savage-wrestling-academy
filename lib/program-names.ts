// Display names change without changing the IDs used by schedules, plans, or access rules.
export const programDetails:Record<string,{name:string;grades:string;description:string}>={
 Elementary:{name:'SWA Development',grades:'Grades K–6',description:'For new and returning younger wrestlers. Build fundamentals, confidence, and wrestling skills, with practice partners grouped by experience and readiness.'},
 Intermediate:{name:'SWA Intermediate',grades:'Grades 7–12',description:'For beginners and intermediate wrestlers. Build sound technique, purposeful drilling habits, and confidence applying skills in live wrestling.'},
 Advanced:{name:'SWA Advance',grades:'Grades 7–12 · Coach approval required',description:'For experienced wrestlers ready for faster drilling, demanding situations, and competitive live wrestling. Placement considers technique, size, maturity, focus, and readiness to train safely. All SWA Advance wrestlers require coach approval.'}
};
// The one list of program names (issue #355). Every page, email, receipt and error message that names a program reads
// it from here, so a name can never read one way on the welcome page and another on the roster. To rename a program,
// change it here; tests/program-names-one-source.mjs fails if a second copy of the names appears in lib/.
export const programName=(id:string):string=>programDetails[id]?.name??id;
// A saved settings document always carries these names, whatever was typed into it (the owner's Programs & pricing
// page shows the name as fixed, like the grades). Descriptions and prices stay the owner's own.
export function standardProgramNames<T extends {id?:string;name?:string}>(programs:readonly T[]):T[]{
 return programs.map(p=>p&&typeof p.id==='string'&&programDetails[p.id]&&p.name!==programDetails[p.id].name?{...p,name:programDetails[p.id].name}:p);
}
export function upgradeProgramNames(state:any){
 if(!state||typeof state!=='object'||!Array.isArray(state.programs))return state;
 const current=state.programNamingVersion>=2?state:{...state,programNamingVersion:2,programs:state.programs.map((p:any)=>p&&programDetails[p.id]?{...p,...programDetails[p.id],priceCents:20000,walkInPriceCents:4000}:p)};
 const named=standardProgramNames(current.programs as any[]);
 return named.every((p,i)=>p===current.programs[i])?current:{...current,programs:named};
}
