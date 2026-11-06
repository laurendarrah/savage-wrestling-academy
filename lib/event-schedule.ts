export type EventSession={date:string;start:string;end:string};
const timePattern=/^([01]\d|2[0-3]):[0-5]\d$/;

export function validEventSchedule(dates:unknown,schedule:unknown):schedule is EventSession[]{
 if(!Array.isArray(dates)||!Array.isArray(schedule)||schedule.length!==dates.length)return false;
 const expected=new Set(dates);
 return schedule.every(slot=>slot&&typeof slot.date==='string'&&expected.delete(slot.date)&&
  typeof slot.start==='string'&&timePattern.test(slot.start)&&typeof slot.end==='string'&&timePattern.test(slot.end)&&slot.start<slot.end);
}

export function publishedEventSessions(dates:string[],schedule:unknown):EventSession[]{
 if(!validEventSchedule(dates,schedule))return [];
 return schedule.map(({date,start,end})=>({date,start,end})).sort((a,b)=>a.date.localeCompare(b.date));
}
