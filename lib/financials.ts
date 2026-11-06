export const financialCategories={income:['Memberships','Walk-ins','Camps & clinics','Private lessons','Other income'],expense:['Rent','Coach pay','Supplies','Refunds','Other expense']} as const;
export type FinancialKind=keyof typeof financialCategories;
export const financialMonth=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v)&&v>='1900-01'&&v<='9999-12';
export function amountCents(amount:unknown){if(typeof amount!=='string'||!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount.trim()))return null;const [d,f='']=amount.trim().split('.'),cents=Number(d)*100+Number(f.padEnd(2,'0'));return cents>=1&&cents<=100000000?cents:null}
export function cleanFinancialEntry(input:any,today:string){
 if(!input||!['income','expense'].includes(input.kind)||typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!financialMonth(input.date.slice(0,7))||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date||input.date>today)return null;
 const kind=input.kind as FinancialKind,cents=amountCents(input.amount),description=typeof input.description==='string'?input.description.trim():'';
 if(cents===null||!(financialCategories[kind] as readonly string[]).includes(input.category)||!description||description.length>160||/[\u0000-\u001f]/.test(description))return null;
 return {date:input.date,kind,category:input.category as string,description,cents};
}
