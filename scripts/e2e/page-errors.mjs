// What the walkthrough does with an uncaught page error (issue #296): it fails the step, except for one message from
// Chromium itself, which is noted in the log instead.
//
// Owner pages opt into cross-document View Transitions (public/owner-shell.css). When a transition reaches a page that
// has not opted in, Chromium aborts it and rejects it on that new page with exactly this message. The new page cannot
// catch it (its pagereveal has no viewTransition), so it surfaces as an unhandled rejection. The shell prevents it for
// every link out of the shell by skipping the transition on pageswap (SHELL_BOOT in lib/owner-shell.ts), but the old
// page cannot foresee an owner address that answers with a page outside the shell, such as an error page or a
// redirect to sign-in. The owner sees an ordinary page load. Only this exact message is let through: any other
// View Transition message, and any error that merely mentions one (a broken skipTransition call), still fails.
export const ABORTED_TRANSITION = 'Transition was aborted because of invalid state. ViewTransition opt-in disabled';

export const abortedTransition = message => String(message ?? '').trim() === ABORTED_TRANSITION;

// Either {note} for the log or {problem} for the failure list.
export function pageError(step, url, message) {
  if (abortedTransition(message)) return {note: `    note: [${step}] the browser aborted a View Transition into ${url}, a page that did not opt in (issue #296)`};
  return {problem: `[${step}] page error on ${url}: ${message}`};
}
