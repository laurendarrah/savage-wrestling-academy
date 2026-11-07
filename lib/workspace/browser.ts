// The owner workspace's typed rules and maths, for the page (issue #45). scripts/workspace-script.mjs bundles this file
// into /portal-workspace.js, which app/portal.html loads before its own script; the tests run the same bundle.
// The page reads everything from window.SwaWorkspace. Rendering and saving stay in the page.
import * as events from './events';
import * as pricing from './pricing';
import * as programs from './programs';
import * as schedule from './schedule';
import * as settings from './settings';
// The owner navigation (issue #261): the dashboard draws its tools card and opens its sections from the same list as
// the owner shell's sidebar.
import {OWNER_NAV} from '../owner-nav';

const SwaWorkspace = {...programs, ...settings, ...schedule, ...events, ...pricing, OWNER_NAV};
export type Workspace = typeof SwaWorkspace;

(globalThis as typeof globalThis & {SwaWorkspace: Workspace}).SwaWorkspace = SwaWorkspace;
