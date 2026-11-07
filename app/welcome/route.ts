import html from './screen.html?raw';
import {publicWebsite, renderWelcome, siteOrigin, DEFAULT_WEBSITE} from '../../lib/website';
export const dynamic='force-dynamic';
// Public: the owner's website content (issue #196) around the programs and calendar the page loads itself. If the
// content cannot be read, the page still opens with the standard wording. No images from other sites (img-src 'self').
export async function GET(){
 let content;try{content=await publicWebsite()}catch(e){console.error('website content unavailable',e);content={site:DEFAULT_WEBSITE,coaches:[]}}
 return new Response(renderWelcome(html,content.site,content.coaches,siteOrigin()),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=20','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"frame-ancestors 'self' https://savagewrestlingacademy.com https://www.savagewrestlingacademy.com http://savagewrestlingacademy.com http://www.savagewrestlingacademy.com; base-uri 'self'; object-src 'none'; img-src 'self'; font-src 'self'"}})}
