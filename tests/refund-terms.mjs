// Issue #3: the single-purchase refund policy Justin decided on Nov 13 is on the terms page, and every checkout that
// takes a single purchase links to its part before payment (NY GBL §218-a: post it clearly before payment).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page = readFileSync('app/membership-terms/screen.html', 'utf8');
const section = page.match(/<section id="refunds">([\s\S]*?)<\/section>/)?.[1];
assert.ok(section, 'a refunds section');
for (const id of ['walkins', 'camps', 'lessons']) assert.match(section, new RegExp(`<h3 id="${id}">`), id);
const text = section.replace(/<[^>]+>/g, ' ');
for (const rule of [
  /Cancel at least 24 hours before the practice starts for a full refund/,
  /If the academy cancels the practice[^.]*full refund/,
  /Cancel at least 14 days before the first day for a full refund/,
  /Cancel 7 to 13 days before the first day for a 50% refund/,
  /Less than 7 days before the first day, there is no refund/,
  /single camp day follows the same rules/,
  /doctor’s note[^.]*\. These are decided case by case/,
  /If the academy cancels a camp, clinic or event, you get a full refund/,
  /Cancel at least 24 hours before the lesson for a full refund/,
  /If the coach cancels, you choose a full refund or a new time/,
  /refunded to the same card within 10 business days/,
  /written copy of this refund policy/,
]) assert.match(text, rule, String(rule));
assert.equal((text.match(/no-shows are not refunded/g) || []).length, 2, 'no-shows: walk-ins and lessons');
assert.match(page, /<p class="notice"><strong>These terms are final\.<\/strong> They cover single purchases and the monthly membership\./);
assert.doesNotMatch(section, /credit|fee/i, 'no academy credit or refund fee, which were not decided');

assert.match(readFileSync('app/booking/screen.html', 'utf8'), /href="\/membership-terms#refunds"[^>]*>refund policy<\/a>/);
assert.match(readFileSync('app/lesson/screen.html', 'utf8'), /href="\/membership-terms#lessons"[^>]*>refund policy<\/a>/);
assert.match(readFileSync('app/register/screen.html', 'utf8'), /href="\/membership-terms"/);
console.log('Refund terms: ok');
