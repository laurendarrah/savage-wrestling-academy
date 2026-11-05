import {upgradeProgramNames} from './program-names';
// Only customer-facing program fields leave the private owner workspace.
const ids=['Elementary','Intermediate','Advanced'];
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const validPrice=(n:unknown):n is number=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=1000000;
export function registrationCatalog(state:any,month:string,today:string){
 state=upgradeProgramNames(state);
 const programs=(Array.isArray(state?.programs)?state.programs:[]).filter((p:any)=>ids.includes(p?.id)).map((p:any)=>({id:p.id,name:String(p.name??p.id).slice(0,100),description:String(p.description??'').slice(0,2000),grades:String(p.grades??'').slice(0,100),monthlyCents:validPrice(p.priceCents)?p.priceCents:null,annualCents:validPrice(p.priceCents)?p.priceCents*12:null,walkInCents:validPrice(p.walkInPriceCents)?p.walkInPriceCents:null}));
 const seasons=Array.isArray(state?.seasons)?state.seasons:[];
 const practices:{id:string;program:string;date:string;start:string;end:string}[]=[];
 const [year,mo]=month.split('-').map(Number),count=new Date(Date.UTC(year,mo,0)).getUTCDate();
 for(let day=1;day<=count;day++){
 const date=month+'-'+String(day).padStart(2,'0');if(date<today)continue;
 const weekday=days[new Date(date+'T12:00:00Z').getUTCDay()];
 for(const p of programs){
 // Match the latest saved semester, just as the owner calendar does. No fallback sample practices.
 const season=[...seasons].reverse().find((s:any)=>s.program===p.id&&date>=s.start&&date<=s.end);
 if(!season||season.excludedDates?.includes(date))continue;
 // Legacy free-text exceptions need owner review before dates can be offered.
 if(season.exceptions&&!Array.isArray(season.excludedDates))continue;
 const slot=season.weekly?.find((w:any)=>w.day===weekday);
 if(!slot||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end)||slot.start>=slot.end)continue;
 practices.push({id:p.id+':'+date+':'+slot.start,program:p.id,date,start:slot.start,end:slot.end});
 }
 }
 return {programs,practices,month,today,membershipTermMonths:12,renewal:'manual',termsStatus:'draft',termsUrl:'/membership-terms',paymentsEnabled:false};
}
