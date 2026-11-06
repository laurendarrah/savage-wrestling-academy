type WrestlerProfile={id:string;name:string;grade:string;birthDate?:string;allergies?:string};
export type FamilyProfile={
 parentName:string;phone:string;wrestlers:WrestlerProfile[];
 homeAddress?:string;homeCity?:string;homeState?:string;homeZip?:string;emergencyContactName?:string;emergencyContactPhone?:string;
};
export const emptyFamily=():FamilyProfile=>({parentName:'',phone:'',wrestlers:[]});
const grades=['K',...Array.from({length:12},(_,i)=>String(i+1)),'Adult'];
const optionalText=(value:unknown,max:number)=>value===undefined||typeof value==='string'&&value.length<=max;
function validBirthDate(value:unknown,today:string){
 if(value===undefined||value==='')return true;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>today)return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;
}
export function validFamily(value:unknown):value is FamilyProfile{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as FamilyProfile;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return typeof v.parentName==='string'&&v.parentName.length<=120&&typeof v.phone==='string'&&v.phone.length<=40&&
  optionalText(v.homeAddress,300)&&optionalText(v.homeCity,100)&&optionalText(v.homeState,40)&&optionalText(v.homeZip,12)&&optionalText(v.emergencyContactName,120)&&optionalText(v.emergencyContactPhone,40)&&
  Array.isArray(v.wrestlers)&&v.wrestlers.length<=20&&new Set(v.wrestlers.map(w=>w?.id)).size===v.wrestlers.length&&
  v.wrestlers.every(w=>w&&typeof w.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(w.id)&&
   typeof w.name==='string'&&w.name.trim().length>0&&w.name.length<=120&&grades.includes(w.grade)&&
   validBirthDate(w.birthDate,today)&&optionalText(w.allergies,500));
}
export function cleanFamily(value:FamilyProfile,prior?:FamilyProfile):FamilyProfile{
 const homeAddress=(value.homeAddress??prior?.homeAddress)?.trim();
 const homeCity=(value.homeCity??prior?.homeCity)?.trim();
 const homeState=(value.homeState??prior?.homeState)?.trim();
 const homeZip=(value.homeZip??prior?.homeZip)?.trim();
 const emergencyContactName=(value.emergencyContactName??prior?.emergencyContactName)?.trim();
 const emergencyContactPhone=(value.emergencyContactPhone??prior?.emergencyContactPhone)?.trim();
 return {parentName:value.parentName.trim(),phone:value.phone.trim(),
  ...(homeAddress?{homeAddress}:{}),...(homeCity?{homeCity}:{}),...(homeState?{homeState}:{}),...(homeZip?{homeZip}:{}),
  ...(emergencyContactName?{emergencyContactName}:{}),...(emergencyContactPhone?{emergencyContactPhone}:{}),
  wrestlers:value.wrestlers.map(w=>{
   const old=prior?.wrestlers.find(p=>p.id===w.id);
   const birthDate=w.birthDate??old?.birthDate,allergies=(w.allergies??old?.allergies)?.trim();
   return {id:w.id,name:w.name.trim(),grade:w.grade,...(birthDate?{birthDate}:{}),...(allergies?{allergies}:{})};
  })};
}
