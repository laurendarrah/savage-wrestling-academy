import {env} from 'cloudflare:workers';
import {publicSchedule,monthValid,academyToday} from '../../../lib/public-schedule';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
// The public calendar's data holds nothing private, so browsers and Cloudflare may keep it for a minute and show a
// copy up to five minutes old while a fresh one loads (issue #274). An error is never cached.
export const PUBLIC_CACHE='public, max-age=60, stale-while-revalidate=300';
export const GET = withApi(GET_); async function GET_(request:Request){const today=academyToday(),month=new URL(request.url).searchParams.get('month')||today.slice(0,7);const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};if(!monthValid(month))return Response.json({error:'Choose a valid month.'},{status:400,headers});const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();return Response.json(publicSchedule(row?JSON.parse(row.payload):{},month,today),{headers:{...headers,'Cache-Control':PUBLIC_CACHE}})}
