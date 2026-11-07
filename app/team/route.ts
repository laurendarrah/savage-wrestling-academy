import html from './screen.html?raw';
import {publicWebsite, renderTeam, siteOrigin} from '../../lib/website';
export const dynamic='force-dynamic';
// Public team page (issue #196): the coaches the owner chose, wrestler achievements and alumni. Names only, no photos
// (decision #197, question 22), and nothing loaded from other sites (img-src 'self').
export async function GET(){
 const {site,coaches}=await publicWebsite();
 return new Response(renderTeam(html,site,coaches,siteOrigin()),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=20','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"frame-ancestors 'self' https://savagewrestlingacademy.com https://www.savagewrestlingacademy.com http://savagewrestlingacademy.com http://www.savagewrestlingacademy.com; base-uri 'self'; object-src 'none'; img-src 'self'; font-src 'self'"}})}
