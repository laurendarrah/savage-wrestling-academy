// Outbound calls with a time limit (issue #274). Supabase (sign-in) and Resend (email) are called from inside a
// request, so a hung connection would hang the page; every call to them gives up after a few seconds instead.
// Test harnesses that lack AbortSignal get a plain fetch.
export const SUPABASE_TIMEOUT_MS = 8000;
export const EMAIL_TIMEOUT_MS = 10000;

export function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

// The caller's own signal, if any, combined with the time limit.
export function withTimeout(signal: AbortSignal | null | undefined, ms: number): AbortSignal | undefined {
  const timer = timeoutSignal(ms);
  if (!signal) return timer;
  if (!timer) return signal;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timer]) : timer;
}

// A fetch that never waits longer than `ms`, for a client library's `global.fetch` option.
export function timedFetch(ms: number): typeof fetch {
  return (input, init) => fetch(input, {...init, signal: withTimeout(init?.signal, ms)});
}
