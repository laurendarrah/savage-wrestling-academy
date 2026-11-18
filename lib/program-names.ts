// Display names change without changing the IDs used by schedules, plans, or access rules.
export const programDetails:Record<string,{name:string;grades:string;description:string}>={
 Elementary:{name:'SWA Development',grades:'Grades K–6',description:'For new and returning younger wrestlers. Build fundamentals, confidence, and wrestling skills, with practice partners grouped by experience and readiness.'},
 Intermediate:{name:'SWA Intermediate',grades:'Grades 7–12',description:'For beginners and intermediate wrestlers. Build sound technique, purposeful drilling habits, and confidence applying skills in live wrestling.'},
 Advanced:{name:'SWA Advanced',grades:'Grades 7–12 · Coach approval required',description:'For experienced wrestlers ready for faster drilling, demanding situations, and competitive live wrestling. Placement considers technique, size, maturity, focus, and readiness to train safely. All SWA Advanced wrestlers require coach approval.'}
};
// The one list of built-in program names (issue #355). Everything inside the site names a program with these: the
// code, stored records, emails as they are written, the tests. tests/program-names-one-source.mjs fails if a second
// copy of the names appears in lib/.
export const programName=(id:string):string=>programDetails[id]?.name??id;

// ---------- The owner's own names (issue #363) ----------
// The owner can rename a program on Programs & pricing. The new name is saved with the academy settings as
// `programNames` (only the programs that differ from the built-in name). Nothing inside the site changes: the built-in
// names stay the one vocabulary. At the last step, everything the site sends out has each built-in name replaced by the
// owner's (lib/program-renames.ts: every page and data reply, every email, the product name at Stripe). One place does
// the replacing, so no page can be missed and two pages can never disagree.
export const PROGRAM_IDS=['Elementary','Intermediate','Advanced'] as const;
export const NAME_MIN=2,NAME_MAX=40;
export const NAME_RULE=`Use ${NAME_MIN} to ${NAME_MAX} letters, numbers and spaces. These marks are fine too: - . ( ) / + , : and & with a space on each side.`;
// Letters, numbers and spaces, plus - . ( ) / + , : and an & between spaces. Nothing that means anything to a page, a
// script, a spreadsheet or a data reply, so a name is safe wherever it lands without being escaped.
const SAFE_NAME=/^[\p{L}\p{N}](?:[\p{L}\p{N} \-.()\/+,:]| & )*$/u;
export function cleanProgramName(v:unknown):string|null{
 if(typeof v!=='string')return null;
 const t=v.normalize('NFC').replace(/\s+/g,' ').trim();
 return t.length>=NAME_MIN&&t.length<=NAME_MAX&&SAFE_NAME.test(t)?t:null;
}
const lower=(s:string)=>s.toLocaleLowerCase('en-US');
// What was typed for each program (by id; a program left out keeps its built-in name), checked. Returns the names to
// save, which are only the ones that differ from the built-in name, or the sentence to show the owner.
export function programNamesFrom(input:unknown):{names:Record<string,string>}|{error:string}{
 if(!input||typeof input!=='object'||Array.isArray(input))return {error:'Invalid program names.'};
 const names:Record<string,string>={};
 for(const [id,typed] of Object.entries(input as Record<string,unknown>)){
  if(!(PROGRAM_IDS as readonly string[]).includes(id))return {error:'Invalid program names.'};
  const name=cleanProgramName(typed);
  if(!name)return {error:'That program name can’t be used. '+NAME_RULE};
  // A name that holds another program's built-in name would be read as that program wherever it is typed later.
  const other=PROGRAM_IDS.find(o=>o!==id&&lower(name).includes(lower(programDetails[o].name)));
  if(other)return {error:`“${name}” includes the site’s name for another program (${programDetails[other].name}). Choose a different name.`};
  if(name!==programDetails[id].name)names[id]=name;
 }
 const shown=PROGRAM_IDS.map(id=>lower(names[id]??programDetails[id].name));
 if(new Set(shown).size!==shown.length)return {error:'Two programs can’t have the same name.'};
 return {names};
}
// The owner's names saved in a settings document. Anything that would not pass the check above counts as none saved.
export function customProgramNames(state:any):Record<string,string>{
 const saved=state&&typeof state==='object'?state.programNames:undefined;
 if(saved===undefined||saved===null)return {};
 const checked=programNamesFrom(saved);
 return 'names' in checked?checked.names:{};
}
// The name people see for a program.
export const shownProgramName=(id:string,names:Record<string,string>):string=>names[id]??programName(id);
const escapeRe=(s:string)=>s.replace(/[.*+?^${}()|[\]\\\/-]/g,'\\$&');
// Replaces each renamed program's built-in name with the owner's name, in one pass. Text that already holds the
// owner's name (a message the owner typed) is left as it is, even when that name starts with the built-in one.
export function applyProgramNames(text:string,names:Record<string,string>):string{
 const ids=PROGRAM_IDS.filter(id=>names[id]);
 if(!ids.length||typeof text!=='string'||!text)return text;
 const swap=new Map<string,string>();
 for(const id of ids){swap.set(names[id],names[id]);swap.set(programDetails[id].name,names[id])}
 const pattern=new RegExp([...ids.map(id=>names[id]),...ids.map(id=>programDetails[id].name)].map(escapeRe).join('|'),'g');
 return text.replace(pattern,found=>swap.get(found)??found);
}

// Inside a saved settings document, a program's own `name` is always the built-in one (the owner's name is in
// `programNames`). Descriptions and prices stay the owner's own.
// The program was "SWA Advance" until Nov 17, 2026, when Lauren confirmed "SWA Advanced", as on the academy's own
// schedule (issue #359). The starter settings were saved with the old name in the standard description too. A saved
// description that is still exactly the standard text with the old name is shown with the new one; a description the
// owner has edited is theirs and is left alone. This is the only place the old name may appear.
const EARLIER_NAME=/SWA Advance(?!d)/g;
const standardDescription=(id:string,description:unknown)=>typeof description==='string'&&description!==programDetails[id].description&&description.replace(EARLIER_NAME,'SWA Advanced')===programDetails[id].description;
export function standardProgramNames<T extends {id?:string;name?:string;description?:string}>(programs:readonly T[]):T[]{
 return programs.map(p=>{
  if(!p||typeof p.id!=='string'||!programDetails[p.id])return p;
  const name=p.name!==programDetails[p.id].name,words=standardDescription(p.id,p.description);
  return name||words?{...p,name:programDetails[p.id].name,...(words?{description:programDetails[p.id].description}:{})}:p;
 });
}
export function upgradeProgramNames(state:any){
 if(!state||typeof state!=='object'||!Array.isArray(state.programs))return state;
 const current=state.programNamingVersion>=2?state:{...state,programNamingVersion:2,programs:state.programs.map((p:any)=>p&&programDetails[p.id]?{...p,...programDetails[p.id],priceCents:20000,walkInPriceCents:4000}:p)};
 const named=standardProgramNames(current.programs as any[]);
 return named.every((p,i)=>p===current.programs[i])?current:{...current,programs:named};
}
