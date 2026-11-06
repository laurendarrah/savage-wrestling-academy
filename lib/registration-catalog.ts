import {upgradeProgramNames} from './program-names';
// Only customer-facing program fields leave the private owner workspace.
const ids=['Elementary','Intermediate','Advanced'];
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const validPrice=(n:unknown):n is number=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=1000000;
// Match the actual and observed holiday names in the semester planner.
function holidayNames(year:number){
 const names=new Map<string,string>();
 const date=(month:number,day:number)=>new Date(Date.UTC(year,month,day));
 const key=(day:Date)=>day.toISOString().slice(0,10);
 const fixed=(month:number,day:number,name:string)=>{
  const holiday=date(month,day),weekday=holiday.getUTCDay();
  names.set(key(holiday),name);
  if(weekday===0||weekday===6)names.set(key(date(month,day+(weekday===6?-1:1))),name+' (observed)');
 };
 const nth=(month:number,weekday:number,n:number)=>key(date(month,1+(weekday-date(month,1).getUTCDay()+7)%7+7*(n-1)));
 fixed(0,1,'New Year’s Day');
 names.set(nth(0,1,3),'Martin Luther King Jr. Day');
 names.set(nth(1,1,3),'Washington’s Birthday');
 const lastMay=date(5,0);
 names.set(key(date(4,lastMay.getUTCDate()-(lastMay.getUTCDay()+6)%7)),'Memorial Day');
 fixed(5,19,'Juneteenth');
 fixed(6,4,'Independence Day');
 names.set(nth(8,1,1),'Labor Day');
 names.set(nth(9,1,2),'Columbus Day');
 fixed(10,11,'Veterans Day');
 names.set(nth(10,4,4),'Thanksgiving Day');
 fixed(11,25,'Christmas Day');
 return names;
}
export function registrationCatalog(state:any,month:string,today:string){
 state=upgradeProgramNames(state);
 const programs=(Array.isArray(state?.programs)?state.programs:[]).filter((p:any)=>ids.includes(p?.id)).map((p:any)=>({id:p.id,name:String(p.name??p.id).slice(0,100),description:String(p.description??'').slice(0,2000),grades:String(p.grades??'').slice(0,100),monthlyCents:validPrice(p.priceCents)?p.priceCents:null,walkInCents:validPrice(p.walkInPriceCents)?p.walkInPriceCents:null}));
 const seasons=Array.isArray(state?.seasons)?state.seasons:[];
 const practices:{id:string;program:string;date:string;start:string;end:string}[]=[];
 const closures:{program:string;date:string}[]=[];
 const [year,mo]=month.split('-').map(Number),count=new Date(Date.UTC(year,mo,0)).getUTCDate();
 const holidays=Number.isFinite(count)
  ? [...holidayNames(year),...(mo===12?holidayNames(year+1):[])].filter(([date])=>date.startsWith(month+'-')).map(([date,name])=>({date,name}))
  : [];
 for(let day=1;day<=count;day++){
 const date=month+'-'+String(day).padStart(2,'0');if(date<today)continue;
 const weekday=days[new Date(date+'T12:00:00Z').getUTCDay()];
 for(const p of programs){
 // Match the latest saved semester, just as the owner calendar does. No fallback sample practices.
 const season=[...seasons].reverse().find((s:any)=>s.program===p.id&&date>=s.start&&date<=s.end);
 if(!season)continue;
 // Legacy free-text exceptions need owner review before dates can be offered.
 if(season.exceptions&&!Array.isArray(season.excludedDates))continue;
 const slot=season.weekly?.find((w:any)=>w.day===weekday);
 if(!slot||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end)||slot.start>=slot.end)continue;
 if(season.excludedDates?.includes(date)){
  if(!Array.isArray(season.excludedDates))continue;
  closures.push({program:p.id,date});
  continue;
 }
 practices.push({id:p.id+':'+date+':'+slot.start,program:p.id,date,start:slot.start,end:slot.end});
 }
 }
 return {programs,practices,closures,holidays,month,today,membershipTermMonths:12,renewal:'manual',termsStatus:'draft',termsUrl:'/membership-terms',paymentsEnabled:false};
}
