// The owner workspace's script as the browser runs it (issue #45): /portal-workspace.js, built from lib/workspace/ by
// the same function the site's build uses, then the page's own script from app/portal.html.
import {readFileSync} from 'node:fs';
import {workspaceScript} from '../../scripts/workspace-script.mjs';

export const portalHtml = readFileSync('app/portal.html', 'utf8');
export const workspaceCode = await workspaceScript();
// The page's own script.
export const pageScript = portalHtml.match(/<script>([\s\S]*)<\/script>/)[1];
// Both, up to start-up (which would load the saved academy).
export const portalCode = workspaceCode + '\n' + pageScript.split('// Start-up')[0];
