/** The Supabase project URL (public). Read by its literal name so that Next.js inlines it in browser code. */
export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return url;
}

/**
 * The Supabase URL and publishable key. Both are public (they reach the browser; RLS and grants
 * protect the data). Each is read by its literal name so that Next.js inlines it in browser code.
 */
export function supabasePublicEnv(): { url: string; publishableKey: string } {
  const url = supabaseUrl();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set');
  return { url, publishableKey };
}
