import html from './screen.html?raw';
import {academyContact, renderWelcome, siteOrigin, ACADEMY_ADDRESS, ACADEMY_EMAIL} from '../../lib/website';
export const dynamic='force-dynamic';
// Public: a short fixed welcome and the academy's address and email (issue #412) around the programs and calendar the page
// loads itself. If the contact cannot be read, the page still opens with the fixed ones. No images from other sites.
export async function GET(){
 let contact;try{contact=await academyContact()}catch(e){console.error('academy contact unavailable',e);contact={address:ACADEMY_ADDRESS,email:ACADEMY_EMAIL}}
 return new Response(renderWelcome(html,contact,siteOrigin()),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=20','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"frame-ancestors 'self' https://savagewrestlingacademy.com https://www.savagewrestlingacademy.com http://savagewrestlingacademy.com http://www.savagewrestlingacademy.com; base-uri 'self'; object-src 'none'; img-src 'self'; font-src 'self'"}})}
