// Links to the academy's own Supabase project, worked out from SUPABASE_URL (issue #139).
// Never hard-code a project reference: the project can change.
export function supabaseDashboardLink(supabaseUrl: string | undefined, page = ''): string {
  let ref = '';
  try {
    const host = new URL(supabaseUrl || '').hostname;
    if (host.endsWith('.supabase.co')) ref = host.split('.')[0];
  } catch {}
  if (!/^[a-z0-9]{20}$/.test(ref)) return 'https://supabase.com/dashboard/projects';
  return `https://supabase.com/dashboard/project/${ref}${page ? '/' + page : ''}`;
}
