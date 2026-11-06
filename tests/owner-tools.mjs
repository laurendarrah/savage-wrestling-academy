// Issue #143: the owner dashboard's tools are grouped: four daily tiles, short labeled lists, settings folded away.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/portal.html', 'utf8');
const src = html.match(/function realTools\(\)\{[\s\S]*?<\/section>`\}/)[0];
const out = vm.runInNewContext(src + ';realTools()');

const daily = out.match(/<div class="daily">([\s\S]*?)<\/div><div class="toolgroups">/)[1];
assert.deepEqual([...daily.matchAll(/href="([^"]+)"/g)].map(m => m[1]), ['/roster', '/payments', '/messages', '/cards'], 'the daily four come first as tiles');

const groups = [...out.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
assert.deepEqual(groups, ['Families', 'Schedule &amp; programs'.replace('&amp;', '&'), 'Coaches & lessons']);

const more = out.match(/<details class="toolmore"><summary>Settings & records<\/summary>([\s\S]*?)<\/details>/);
assert(more, 'settings fold away');
assert.doesNotMatch(more[0], /<details[^>]* open/, 'folded by default');

// Every page that had a tile is still reachable, exactly once.
const pages = ['/roster', '/payments', '/cards', '/waivers', '/messages', '/transfers', '/waitlists', '/lesson-settings', '/coach-pay', '/accounts', '/approvals',
  '/scholarships', '/staff', '/practice-plans', '/curricula', '/payment-setup', '/backups', '/site-health', '/data-requests', '/help/owner', '/security-log'];
for (const p of pages) assert.equal(out.split(`href="${p}"`).length - 1, 1, p);
for (const g of ['Schedules', 'Programs & pricing', 'Camps & events']) assert.equal(out.split(`go('${g}')`).length - 1, 1, g);
assert.equal((out.match(/href="|onclick="go\(/g) || []).length, 24, 'no tool added or lost');
console.log('owner-tools ok');
