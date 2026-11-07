import html from './screen.html?raw';
export const dynamic='force-dynamic';
// The coach invitation page (issue #190). Public: the invite token stays in the address after # and is only ever sent
// to /api/coach-invite in a request body.
export async function GET(){return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"}})}
