/**
 * The fetch of every server-side client with the publishable key (server.ts, proxy.ts; R7): it
 * refuses a session refresh without calling Auth, and passes every other request on unchanged.
 *
 * Auth limits refreshes per address (`token_refresh`, about 150 per 5 minutes on GoTrue v2.197.0),
 * and password sign-in shares that limit (decision 72.4). A refresh sent from the CMS server would
 * count against the server's address, shared by every editor, and auth-js sends one for any
 * expired session cookie, a forged one with a junk refresh token included. So the browser refreshes
 * (KeepSessionFresh, /auth/refresh), from the editor's own address, and the server never does.
 *
 * The answer is Auth's own for a refresh token it does not know, so auth-js treats it as final (not
 * a network failure to retry): it keeps a session whose access token is still good, and removes
 * one that has expired, which then counts as signed out.
 */
export const fetchWithoutRefresh: typeof fetch = async (input, init) => {
  if (isRefresh(input)) return refusal();
  return fetch(input, init);
};

/** A token request for a refresh (`POST /auth/v1/token?grant_type=refresh_token`), however it is given. */
function isRefresh(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(url).searchParams.get('grant_type') === 'refresh_token';
}

const REFUSAL_CODE = 'refresh_token_not_found';

/** GoTrue v2.197.0's answer to an unknown refresh token, for a client on API version 2024-01-01. */
function refusal(): Response {
  return new Response(JSON.stringify({ code: REFUSAL_CODE, message: 'Invalid Refresh Token: Refresh Token Not Found' }), {
    status: 400,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01', 'x-sb-error-code': REFUSAL_CODE },
  });
}
