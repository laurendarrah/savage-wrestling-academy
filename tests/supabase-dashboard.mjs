// Issue #139: links go to the project SUPABASE_URL names, and no old project reference is hard-coded.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const module = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/supabase-dashboard.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module, exports: module.exports, URL});
const {supabaseDashboardLink} = module.exports;

assert.equal(supabaseDashboardLink('https://abcdefghijklmnopqrst.supabase.co', 'auth/url-configuration'), 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/auth/url-configuration');
assert.equal(supabaseDashboardLink('https://abcdefghijklmnopqrst.supabase.co'), 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst');
for (const bad of [undefined, '', 'not a url', 'https://example.com', 'https://x.supabase.co.evil.com', 'https://short.supabase.co'])
  assert.equal(supabaseDashboardLink(bad, 'auth'), 'https://supabase.com/dashboard/projects', String(bad));

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const file of [...walk('app'), ...walk('lib')])
  assert(!readFileSync(file, 'utf8').includes('mdxyylvdgntkjfuiovxi'), `${file} hard-codes the old Supabase project`);
console.log('supabase-dashboard ok');
