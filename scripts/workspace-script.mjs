// Bundles the owner workspace's typed modules (lib/workspace/browser.ts) into one classic script, /portal-workspace.js,
// which app/portal.html loads before its own script (issue #45). The Vite plugin in vite.config.ts serves it in
// development and writes it into the build; tests/fixtures/portal-script.mjs gives the tests the same output.
import {build} from 'vite';
import {fileURLToPath} from 'node:url';

export const WORKSPACE_SCRIPT = 'portal-workspace.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = fileURLToPath(new URL('../lib/workspace/browser.ts', import.meta.url));

/** @returns {Promise<string>} the script's source */
export async function workspaceScript() {
  const result = await build({
    configFile: false, root, logLevel: 'silent', publicDir: false,
    build: {
      write: false, minify: false, target: 'es2022', copyPublicDir: false, emptyOutDir: false,
      lib: {entry, formats: ['iife'], name: 'SwaWorkspaceBundle', fileName: () => WORKSPACE_SCRIPT},
      rollupOptions: {output: {banner: '// Built from lib/workspace/ by scripts/workspace-script.mjs (issue #45). Edit those files, not this one.'}},
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find(o => o.type === 'chunk' && o.isEntry);
  if (!chunk || chunk.type !== 'chunk') throw new Error('The owner workspace script did not build.');
  return chunk.code;
}
