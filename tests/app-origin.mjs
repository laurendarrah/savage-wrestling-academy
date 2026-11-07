// Email links (sign-up confirmation, resend, password reset) are built from appOrigin().
// Handoff issue AUTH-01: the origin was hard-coded to an old Sites hostname.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function loadAuth(env){
  const module={exports:{}};
  const source=ts.transpileModule(readFileSync('lib/account-auth.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const policy={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync('lib/mfa-policy.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:policy,exports:policy.exports,String});
  const deps={'./mfa-policy':policy.exports,'cloudflare:workers':{env},'@supabase/ssr':{createServerClient(){},parseCookieHeader(){return []},serializeCookieHeader(){return ''}}};
  vm.runInNewContext(source,{module,exports:module.exports,URL,Headers,Response,require:name=>{if(name in deps)return deps[name];throw Error('unexpected import '+name)}});
  return module.exports;
}

// No default (issue #119): the old chatgpt.site address must never be used again, so a missing setting is an error.
{
  assert.throws(()=>loadAuth({}).appOrigin(),/APP_ORIGIN is not set/);
  assert.throws(()=>loadAuth({APP_ORIGIN:'   '}).appOrigin(),/APP_ORIGIN is not set/,'blank counts as missing');
  assert.equal(loadAuth({}).DEFAULT_APP_ORIGIN,undefined);
}

// A configured origin wins and is normalized to scheme://host[:port].
assert.equal(loadAuth({APP_ORIGIN:'https://register.savagewrestling.example'}).appOrigin(),'https://register.savagewrestling.example');
assert.equal(loadAuth({APP_ORIGIN:'https://register.savagewrestling.example/some/path?x=1'}).appOrigin(),'https://register.savagewrestling.example');
assert.equal(loadAuth({APP_ORIGIN:'http://127.0.0.1:5173'}).appOrigin(),'http://127.0.0.1:5173','plain http allowed on loopback for local development');
assert.equal(loadAuth({APP_ORIGIN:'http://localhost:5173/'}).appOrigin(),'http://localhost:5173');

// Unsafe or malformed settings fail loudly instead of emailing a bad link.
assert.throws(()=>loadAuth({APP_ORIGIN:'http://register.savagewrestling.example'}).appOrigin(),/https/);
assert.throws(()=>loadAuth({APP_ORIGIN:'register.savagewrestling.example'}).appOrigin(),/absolute URL/);
assert.throws(()=>loadAuth({APP_ORIGIN:'javascript:alert(1)'}).appOrigin(),/https/);

// No source file may reintroduce the retired hostname or a hard-coded origin constant.
function* files(dir){for(const name of readdirSync(dir)){const p=join(dir,name);if(statSync(p).isDirectory())yield* files(p);else if(/\.(ts|tsx|html|js|mjs)$/.test(name))yield p}}
for(const dir of ['app','lib','public']){
  for(const file of files(dir)){
    const text=readFileSync(file,'utf8');
    assert.ok(!text.includes('wellrose34'),`${file} still references the retired wellrose34 host`);
    assert.ok(!/\bAPP_ORIGIN\s*[+}]/.test(text),`${file} builds a URL from a hard-coded APP_ORIGIN constant`);
  }
}

console.log('Passed: email-link origin defaults to the live Sites host, honors a validated APP_ORIGIN setting, rejects unsafe values, and the retired host is gone.');
