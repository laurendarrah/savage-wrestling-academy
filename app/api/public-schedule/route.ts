import {env} from 'cloudflare:workers';
import {publicSchedule,monthValid,academyToday} from '../../../lib/public-schedule';
export const dynamic='force-dynamic';
export async function GET(request:Request){const today=academyToday(),month=new URL(request.url).searchParams.get('month')||today.slice(0,7);const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};if(!monthValid(month))return Response.json({error:'Choose a valid month.'},{status:400,headers});const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();return Response.json(publicSchedule(row?JSON.parse(row.payload):{},month,today),{headers})}
