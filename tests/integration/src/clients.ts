// Data API, Storage and Auth clients for the integration tests (plan Task 12).
// anonClient: the publishable key, no session. secretClient: the secret key,
// as the worker and CLI use it (local stack only, see env.ts). editorClient:
// a persona signed in through the real OTP path, Auth's admin generate_link
// then POST /verify with the hashed token, so every token passes the
// passwordless hook (decision 18). Sessions are cached per persona for the run
// (Auth limits verifications to 30 per 5 minutes) and renewed near expiry.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.ts';
import { PERSONAS, type PersonaName } from './fixtures.ts';

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export const anonClient = (): SupabaseClient => createClient(env.apiUrl, env.publishableKey, options);
export const secretClient = (): SupabaseClient => createClient(env.apiUrl, env.secretKey, options);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries an Auth call that answered 429 (rate limit), waiting between tries. */
export async function retryRateLimited<T extends { error: { status?: number } | null }>(fn: () => Promise<T>, tries = 40): Promise<T> {
  for (let i = 1; ; i++) {
    const r = await fn();
    if (r.error?.status !== 429 || i >= tries) return r;
    await sleep(5000);
  }
}

type Session = { client: SupabaseClient; accessToken: string; expiresAt: number };
const sessions = new Map<PersonaName, Session>();

async function signIn(persona: PersonaName): Promise<Session> {
  const { email } = PERSONAS[persona];
  const link = await secretClient().auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw new Error(`generateLink for ${persona}: ${link.error.message}`);
  const client = anonClient();
  const verified = await retryRateLimited(() =>
    client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token }),
  );
  const session = verified.data.session;
  if (verified.error || !session) throw new Error(`verifyOtp for ${persona}: ${verified.error?.message ?? 'no session'}`);
  return { client, accessToken: session.access_token, expiresAt: (session.expires_at ?? 0) * 1000 };
}

async function session(persona: PersonaName): Promise<Session> {
  const cached = sessions.get(persona);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached;
  const fresh = await signIn(persona);
  sessions.set(persona, fresh);
  return fresh;
}

export const editorClient = async (persona: PersonaName): Promise<SupabaseClient> => (await session(persona)).client;
export const accessToken = async (persona: PersonaName): Promise<string> => (await session(persona)).accessToken;

/** Headers for a raw fetch to the gateway, as a persona or as anon. */
export const authHeaders = async (persona: PersonaName | 'anon'): Promise<Record<string, string>> =>
  persona === 'anon'
    ? { apikey: env.publishableKey }
    : { apikey: env.publishableKey, authorization: `Bearer ${await accessToken(persona)}` };

/** The public object URL of a bucket path (public buckets only answer 200). */
export const publicUrl = (bucket: string, path: string) =>
  `${env.apiUrl}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
