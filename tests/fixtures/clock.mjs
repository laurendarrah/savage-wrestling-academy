// Timestamps are saved to the millisecond, so two records written in the same millisecond share a `created_at` and the
// site then orders them by id, not by which was written first (issue #351). A test that writes something and then
// something "later", and checks the order the site returns, waits here in between so the second really is later.
export async function nextMillisecond() {
  const from = Date.now();
  while (Date.now() <= from) await new Promise(resolve => setTimeout(resolve, 1));
}
