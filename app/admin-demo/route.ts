import portal from '../portal.html?raw';
import demo from './demo.js?raw';

export function GET(){
 const boot='hydratePrograms();reloadAcademy();';
 const at=portal.lastIndexOf(boot);
 if(at<0)return new Response('Admin demo unavailable.',{status:503});
 const html=(portal.slice(0,at)+demo+'\nstartAdminDemo();'+portal.slice(at+boot.length))
  .replaceAll('crypto.randomUUID()','demoUUID()')
  .replace('<title>Savage | Owner Workspace</title>','<title>Savage Wrestling | Admin Demo</title>')
  .replace('<body>','<body><div class="preview"><strong>ADMIN DEMO</strong> · Fictional data · Changes stay in this tab and reset when you reload</div>')
  .replace('<footer>Times are New York time. <button','<footer>Admin demo · Sample data only · Times are New York time. <button');
 return new Response(html,{headers:{
  'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"sandbox allow-scripts allow-modals; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
 }});
}
