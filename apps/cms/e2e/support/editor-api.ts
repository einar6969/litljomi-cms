// The local Supabase API as the signed-in editor sees it, loopback only. The headers are the ones
// the editor's own browser sent (its publishable key and session token), captured from one of its
// requests, so these reads go through exactly the editor's RLS and grants: no other key is used.
import type { Request } from '@playwright/test';
import { requireLoopback, SUPABASE_URL } from './local';

export type EditorHeaders = { apikey: string; authorization: string };

/** The editor's API headers from a request its browser made to the local Supabase API. */
export async function editorHeadersOf(request: Request): Promise<EditorHeaders> {
  requireLoopback(request.url());
  const headers = await request.allHeaders();
  if (!headers.apikey || !headers.authorization?.startsWith('Bearer ')) throw new Error('the request carried no editor session');
  return { apikey: headers.apikey, authorization: headers.authorization };
}

/** GET on the local Supabase API (a path under SUPABASE_URL); no redirects. */
export function supabaseGet(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(requireLoopback(`${SUPABASE_URL}${path}`), { headers, redirect: 'error' });
}

/** Rows of an `api` view, read with the editor's session. */
export async function apiRows<T>(editor: EditorHeaders, query: string): Promise<T[]> {
  const response = await supabaseGet(`/rest/v1/${query}`, { ...editor, 'accept-profile': 'api' });
  if (!response.ok) throw new Error(`GET /rest/v1/${query} answered ${response.status}`);
  return (await response.json()) as T[];
}
