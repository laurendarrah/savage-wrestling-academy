import html from './screen.html?raw';

export function GET(){
 return new Response(html,{headers:{
  'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(self), microphone=()',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob:; media-src blob:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'"
 }});
}
