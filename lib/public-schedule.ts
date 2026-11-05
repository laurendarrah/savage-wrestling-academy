import {fridayLiveSchedule} from './friday-live';
import {registrationCatalog} from './registration-catalog';
export const privateFormats=[{id:'one-on-one',name:'One-on-one lesson',description:'Individual coaching for one wrestler.'},{id:'partner',name:'Partner lesson',description:'Focused training for two wrestlers.'},{id:'small-group',name:'Small-group lesson',description:'Targeted instruction with additional training partners.'}];
const realDate=(d:unknown):d is string=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const cents=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10000?Math.round(v*100):null;
export function publicSchedule(state:any,month:string,today:string){
 const catalog=registrationCatalog(state,month,'0000-01-01');
 const events=(Array.isArray(state?.events)?state.events:[]).filter((e:any)=>e&&!e.archived&&typeof e.id==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(e.id)&&['Camp','Clinic','Event'].includes(e.type)&&Array.isArray(e.dates)&&e.dates.length>0&&e.dates.every(realDate)&&[...e.dates].sort().at(-1)>=today).map((e:any)=>({id:e.id,name:String(e.name??'').slice(0,120),type:e.type,gradeRange:typeof e.gradeRange==='string'?e.gradeRange.slice(0,80):'',description:typeof e.description==='string'?e.description.slice(0,2000):'',dates:[...e.dates].sort(),cents:cents(e.price),dayCents:cents(e.day),full:Number(e.slots)===0}));
 return {...catalog,today,events,liveClasses:fridayLiveSchedule(state,month,today),privateFormats,timeZone:'America/New_York'};
}
export function monthValid(month:string){return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&Number(month.slice(0,4))>=2020&&Number(month.slice(0,4))<=2100}
export function academyToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
