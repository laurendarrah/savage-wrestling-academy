import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync('tests').filter(n => n.endsWith('.mjs')).sort();
let failed = 0;
for (const name of files) {
  console.log(`\nRunning ${name}`);
  const result = spawnSync(process.execPath, [`tests/${name}`], {stdio:'inherit'});
  if (result.status !== 0) failed++;
}
console.log(`\n${files.length - failed}/${files.length} scripts passed`);
process.exitCode = failed ? 1 : 0;
