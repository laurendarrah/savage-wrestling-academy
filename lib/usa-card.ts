import {env} from 'cloudflare:workers';

export type UsaCard={card_number:string;expires_on:string;photo_key:string;photo_type:string;revision:number;verified_at:string|null};
export const usaCardBucket=()=> (env as Cloudflare.Env & {BUCKET?:R2Bucket}).BUCKET;
export const usaCardLabels={missing:'USA Wrestling card missing',pending:'USA Wrestling card needs review',expired:'USA Wrestling card expired',current:'USA Wrestling card verified'} as const;
export const usaCardStatus=(card:Pick<UsaCard,'expires_on'|'verified_at'>|null,date:string)=>
 !card?'missing':card.expires_on<date?'expired':card.verified_at?'current':'pending';

export function usaCardRenewalThrough(date:string){
 const next=new Date(date+'T12:00:00Z');
 next.setUTCDate(next.getUTCDate()+30);
 return next.toISOString().slice(0,10);
}

export async function deleteUsaCardPhoto(key:string){
 try{await usaCardBucket()?.delete(key)}
 catch(error){console.error('Unable to clean up a private USA Wrestling card photo.',error)}
}
