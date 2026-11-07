declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    BUCKET?: R2Bucket;
    // Where the USA Wrestling card lookup goes (issue #202). Unset in production: it defaults to usawmembership.com.
    // Tests point it at a local stand-in.
    USAW_LOOKUP_BASE?: string;
  }
}
