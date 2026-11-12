// The local Supabase mailbox (Mailpit) over its HTTP API, loopback only.
import { MAILPIT_URL, requireLoopback } from './local';

type Summary = { ID: string };
type Message = { ID: string; HTML: string; Subject: string };

const api = (path: string) => requireLoopback(`${MAILPIT_URL}/api/v1${path}`);

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(api(path), { redirect: 'error' });
  if (!response.ok) throw new Error(`Mailpit: GET ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** The IDs of the messages addressed to `email`. */
export async function messageIds(email: string): Promise<Set<string>> {
  const query = encodeURIComponent(`to:"${email}"`);
  const { messages } = await getJson<{ messages?: Summary[] }>(`/search?query=${query}&limit=200`);
  return new Set((messages ?? []).map((m) => m.ID));
}

/** Waits up to `timeoutMs` for a message to `email` whose ID is not in `seen`; null if none came. */
export async function waitForNewMessage(email: string, seen: Set<string>, timeoutMs = 10_000): Promise<Message | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const id of await messageIds(email)) {
      if (!seen.has(id)) return getJson<Message>(`/message/${encodeURIComponent(id)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * The emailed link: the CMS's own `/auth/confirm` page with the token hash (the invite and
 * email-change templates, decision 41.1; the sign-in email has none, decision 72.1), which must be
 * on the local CMS. It relies on the mail template keeping exactly one `href` to `/auth/confirm`; a
 * template change that adds or renames links must update this.
 */
export function confirmLinkOf(message: Message): URL {
  const hrefs = [...message.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'));
  const links = hrefs.filter((href) => URL.canParse(href) && new URL(href).pathname === '/auth/confirm');
  if (links.length !== 1) throw new Error(`expected one /auth/confirm link in the mail "${message.Subject}", found ${links.length}`);
  return requireLoopback(links[0]!);
}
