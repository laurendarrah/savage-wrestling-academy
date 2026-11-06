// Family help (issue #109). Public: it holds no account data.
import html from './screen.html?raw';
export const dynamic = 'force-static';
export function GET() { return new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff'}}); }
