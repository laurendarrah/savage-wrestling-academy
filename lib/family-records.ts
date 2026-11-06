// Family profile, stored as JSON in family_accounts.payload. Issue #188 adds optional contact and safety details:
// a home address (street, city, state, ZIP), an emergency contact, and per wrestler a birth date and allergies or
// medical notes. None of them is required (which ones should be is open in #197, question 14), so older profiles
// stay valid. Profiles saved in ChatGPT Sites version 130 kept the whole address in homeAddress; it stays as the street.
export type Wrestler={id:string;name:string;grade:string;usawNumber?:string;usawExpires?:string;birthDate?:string;allergies?:string};
export type FamilyProfile={
 parentName:string;phone:string;wrestlers:Wrestler[];
 homeAddress?:string;homeCity?:string;homeState?:string;homeZip?:string;emergencyContactName?:string;emergencyContactPhone?:string;
};
// Longest text the server keeps for each optional field. The street allows 300 so an older one-line address still fits.
export const DETAIL_LIMITS={homeAddress:300,homeCity:100,homeState:40,homeZip:10,emergencyContactName:120,emergencyContactPhone:40,birthDate:10,allergies:500} as const;
const FAMILY_DETAILS=['homeAddress','homeCity','homeState','homeZip','emergencyContactName','emergencyContactPhone'] as const;
// USA Wrestling card (issue #68): optional on the profile, required to book. Number is letters, digits or dashes.
export const USAW_NUMBER=/^[A-Za-z0-9-]{4,24}$/;
const cardDate=(d:unknown)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const validCard=(w:any)=>(w.usawNumber===undefined||w.usawNumber===''||(typeof w.usawNumber==='string'&&USAW_NUMBER.test(w.usawNumber.trim())))&&(w.usawExpires===undefined||w.usawExpires===''||cardDate(w.usawExpires));
const optional=(v:unknown,max:number)=>v===undefined||v===null||(typeof v==='string'&&v.length<=max);
export const emptyFamily=():FamilyProfile=>({parentName:'',phone:'',wrestlers:[]});
// The shape and lengths of a stored profile. Backups are restored through this too, so it checks only what keeps the
// data safe to handle; familyProblem() checks the formats of what a family types in.
export function validFamily(value:unknown):value is FamilyProfile{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as FamilyProfile;
 return typeof v.parentName==='string'&&v.parentName.length<=120&&typeof v.phone==='string'&&v.phone.length<=40&&
  FAMILY_DETAILS.every(k=>optional(v[k],DETAIL_LIMITS[k]))&&
  Array.isArray(v.wrestlers)&&v.wrestlers.length<=20&&new Set(v.wrestlers.map(w=>w?.id)).size===v.wrestlers.length&&v.wrestlers.every(w=>w&&typeof w.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(w.id)&&typeof w.name==='string'&&w.name.trim().length>0&&w.name.length<=120&&typeof w.grade==='string'&&['K',...Array.from({length:12},(_,i)=>String(i+1)),'Adult'].includes(w.grade)&&validCard(w)&&
   optional(w.birthDate,DETAIL_LIMITS.birthDate)&&optional(w.allergies,DETAIL_LIMITS.allergies));
}
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
export const ZIP=/^\d{5}(?:-\d{4})?$/;
const STATE=/^[A-Za-z][A-Za-z .'-]{1,39}$/;
// A US number has 10 digits (11 with a leading 1); a number written with + may be from another country.
export function plausiblePhone(raw:string){
 if(!/^[+()\d.\-\s]+$/.test(raw))return false;
 const digits=raw.replace(/\D/g,'');
 return digits.length===10||(digits.length===11&&digits[0]==='1')||(raw.trim().startsWith('+')&&digits.length>=8&&digits.length<=15);
}
// A real calendar date, from 1900 up to today (the academy's date, America/New_York).
export function plausibleBirthDate(value:string,today:string){return cardDate(value)&&value>='1900-01-01'&&value<=today}
// The first thing a family needs to fix before the profile can be saved, in plain words, or null when all is well.
export function familyProblem(v:FamilyProfile,today:string):string|null{
 const zip=text(v.homeZip),state=text(v.homeState),phone=text(v.emergencyContactPhone);
 if(zip&&!ZIP.test(zip))return 'Check the ZIP code. Use 5 digits, for example 11746.';
 if(state&&!STATE.test(state))return 'Check the state. Use letters only, for example NY.';
 if(phone&&!plausiblePhone(phone))return 'Check the emergency contact’s phone number. Use 10 digits, for example 631-555-0100.';
 for(const w of v.wrestlers){
  const born=text(w.birthDate),name=text(w.name)||'your wrestler';
  if(born&&!cardDate(born))return `Check ${name}’s birth date.`;
  if(born&&born>today)return `${name}’s birth date can’t be in the future.`;
  if(born&&born<'1900-01-01')return `Check ${name}’s birth date.`;
 }
 return null;
}
export function cleanFamily(value:FamilyProfile):FamilyProfile{
 const out:FamilyProfile={parentName:value.parentName.trim(),phone:value.phone.trim(),wrestlers:value.wrestlers.map(w=>{
  const birthDate=text(w.birthDate),allergies=text(w.allergies).replace(/\r\n/g,'\n');
  return {id:w.id,name:w.name.trim(),grade:w.grade,usawNumber:(w.usawNumber||'').trim().toUpperCase(),usawExpires:w.usawExpires||'',...(birthDate?{birthDate}:{}),...(allergies?{allergies}:{})};
 })};
 for(const k of FAMILY_DETAILS){const t=text(value[k]);if(t)out[k]=k==='homeState'&&t.length===2?t.toUpperCase():t}
 return out;
}
// The address as one or two lines for display: street, then "City, ST 12345".
export function addressLines(f:Partial<FamilyProfile>){
 const place=[text(f.homeCity),[text(f.homeState),text(f.homeZip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
 return [text(f.homeAddress),place].filter(Boolean);
}
