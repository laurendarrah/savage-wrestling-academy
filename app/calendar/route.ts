import html from './screen.html?raw';
import {ownerWorkspaceMarkup} from '../../lib/owner-workspace';
export const dynamic='force-dynamic';
export async function GET(request:Request){return new Response(ownerWorkspaceMarkup(request,html),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=20','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"frame-ancestors 'self' https://savagewrestlingacademy.com https://www.savagewrestlingacademy.com http://savagewrestlingacademy.com http://www.savagewrestlingacademy.com; base-uri 'self'; object-src 'none'"}})}
