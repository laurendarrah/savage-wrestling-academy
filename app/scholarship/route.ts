import html from './screen.html?raw';
import {securityHeaders} from '../../lib/account-auth';
// The scholarship invitation page: public (the invite token stays after # in the address), with the same headers as the
// signed-in pages (issue #274), so the Worker gives it the nonce script policy too.
export function GET(){const headers=securityHeaders();headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers})}
