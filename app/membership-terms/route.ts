import html from './screen.html?raw';
import {securityHeaders} from '../../lib/account-auth';
// The membership terms page, with the same headers as the signed-in pages (issue #274).
export function GET(){const headers=securityHeaders();headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers})}
