// Data API, Storage and Auth clients for the integration tests (plan Task 12).
// anonClient: the publishable key, no session. secretClient: the secret key,
// as the worker and CLI use it (local stack only, see env.ts). editorClient:
// a persona signed in with its password (PERSONA_PASSWORD, set by the seed),
// the way editors sign in (spec §4.4), so every token passes the sign-in hook
// (PW-01). Sessions are cached per persona for the run (Auth limits sign-ins
// to 30 per 5 minutes per address) and renewed near expiry.
import { createClient, type Session as AuthSession, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.ts';
import { PERSONAS, PERSONA_PASSWORD, type PersonaName } from './fixtures.ts';

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

/**
 * A new session of the persona of its own, on a client of its own (one browser): a password
 * sign-in, as an editor signs in. Callers that end or expire the session use this one, never the
 * cached editorClient.
 */
export async function signInPersona(persona: PersonaName): Promise<{ client: SupabaseClient; session: AuthSession }> {
  const client = anonClient();
  const signedIn = await retryRateLimited(() =>
    client.auth.signInWithPassword({ email: PERSONAS[persona].email, password: PERSONA_PASSWORD }),
  );
  const session = signedIn.data.session;
  if (signedIn.error || !session) throw new Error(`password sign-in for ${persona}: ${signedIn.error?.message ?? 'no session'}`);
  return { client, session };
}

async function signIn(persona: PersonaName): Promise<Session> {
  const { client, session } = await signInPersona(persona);
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

/**
 * A client of the `api` schema carrying the persona's session in its headers, the way the CMS
 * app's server client sends the editor's JWT (for app code tested with a real session).
 */
export const editorApiClient = async (persona: PersonaName): Promise<SupabaseClient<any, 'api'>> =>
  createClient<any, 'api'>(env.apiUrl, env.publishableKey, {
    ...options,
    db: { schema: 'api' },
    global: { headers: { Authorization: `Bearer ${await accessToken(persona)}` } },
  });

/** Headers for a raw fetch to the gateway, as a persona or as anon. */
export const authHeaders = async (persona: PersonaName | 'anon'): Promise<Record<string, string>> =>
  persona === 'anon'
    ? { apikey: env.publishableKey }
    : { apikey: env.publishableKey, authorization: `Bearer ${await accessToken(persona)}` };

/** The public object URL of a bucket path (public buckets only answer 200). */
export const publicUrl = (bucket: string, path: string) =>
  `${env.apiUrl}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
