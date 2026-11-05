// Display names change without changing the IDs used by schedules, plans, or access rules.
export const programDetails:Record<string,{name:string;grades:string;description:string}>={
 Elementary:{name:'SWA Development',grades:'Grades K–6',description:'For new and returning younger wrestlers. Build fundamentals, confidence, and wrestling skills, with practice partners grouped by experience and readiness.'},
 Intermediate:{name:'SWA Intermediate',grades:'Grades 7–12',description:'For beginners and intermediate wrestlers. Build sound technique, purposeful drilling habits, and confidence applying skills in live wrestling.'},
 Advanced:{name:'SWA Advance',grades:'Grades 7–12 · Coach approval required',description:'For experienced wrestlers ready for faster drilling, demanding situations, and competitive live wrestling. Placement considers technique, size, maturity, focus, and readiness to train safely. All SWA Advance wrestlers require coach approval.'}
};
export function upgradeProgramNames(state:any){
 if(!state||typeof state!=='object'||state.programNamingVersion>=2||!Array.isArray(state.programs))return state;
 return {...state,programNamingVersion:2,programs:state.programs.map((p:any)=>p&&programDetails[p.id]?{...p,...programDetails[p.id],priceCents:20000,walkInPriceCents:4000}:p)};
}
