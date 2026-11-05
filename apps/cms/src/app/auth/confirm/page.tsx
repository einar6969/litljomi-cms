import type { Metadata } from 'next';
import { t } from '@/i18n/is';
import { createDetachedClient, createEditorClient } from '@/lib/supabase/server';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Wordmark } from '@/ui/Wordmark';
import { confirmSignIn, keepSession, replaceSession } from './actions';
import { DropLinkQuery } from './DropLinkQuery';
import { readPending } from './pending';

// The URL carries the token hash: no Referer header passes it on.
export const metadata = { referrer: 'no-referrer' } satisfies Metadata;

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ token_hash?: Param; type?: Param; next?: Param }> };

const first = (value: Param): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * The magic link's landing page (spec §4.4; decision 41.1). Opening it verifies nothing (email
 * security scanners open links automatically): it shows one "Halda áfram" button, and only that
 * button's POST (confirmSignIn) uses the link. The link's values go to the action unchecked; the
 * action checks them. Once loaded, the page drops the link's query from the address bar (M3-14).
 *
 * A visitor who already has a session is told so, without naming either account (decision 42.2, Q1).
 * If the link turns out to be for another account, the action holds its session aside and comes back
 * here without a query: the page then names the account the link signs in to and asks before
 * replacing the visitor's session (M3-14).
 *
 * The links of an email change land here too, from both addresses (spec §4.4), with the same one
 * button in the page's own words.
 */
export default async function ConfirmPage({ searchParams }: Props) {
  const { token_hash, type, next } = await searchParams;
  if (token_hash === undefined) {
    const email = await pendingAccount();
    if (email !== null) return <ReplaceQuestion email={email} />;
  }
  const emailChange = first(type) === 'email_change';
  const signedIn = !emailChange && (await hasSession());
  return (
    <main className="flex max-w-[480px] flex-col gap-6 pt-12 md:pt-24">
      <DropLinkQuery />
      <Wordmark />
      <div className="flex flex-col gap-2">
        <h1>{emailChange ? t.confirm.emailChangeTitle : t.confirm.title}</h1>
        <p className="text-muted">{emailChange ? t.confirm.emailChangeIntro : t.confirm.intro}</p>
      </div>
      {signedIn ? (
        <Notice tone="info" role="status">
          <span className="font-semibold">{t.confirm.signedIn}</span> {t.confirm.signedInDetail}
        </Notice>
      ) : null}
      <form action={confirmSignIn} className="flex flex-col gap-4">
        <input type="hidden" name="token_hash" value={first(token_hash)} />
        <input type="hidden" name="type" value={first(type)} />
        <input type="hidden" name="next" value={first(next)} />
        <Button type="submit" variant="primary">
          {t.confirm.submit}
        </Button>
      </form>
    </main>
  );
}

/** The question before a link replaces the visitor's session: the link's account and two buttons. */
function ReplaceQuestion({ email }: { email: string }) {
  return (
    <main className="flex max-w-[480px] flex-col gap-6 pt-12 md:pt-24">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <h1>{t.confirm.replaceTitle}</h1>
        <p>
          {t.confirm.replaceAccount} <strong>{email}</strong>.
        </p>
        <p className="text-muted">{t.confirm.replaceDetail}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <form action={replaceSession}>
          <Button type="submit" variant="primary">
            {t.confirm.replace}
          </Button>
        </form>
        <form action={keepSession}>
          <Button type="submit">{t.confirm.keep}</Button>
        </form>
      </div>
    </main>
  );
}

/** The email of the account a pending link session signs in to, as Auth verifies it; else null. */
async function pendingAccount(): Promise<string | null> {
  try {
    const pending = await readPending();
    if (pending === null) return null;
    const { data, error } = await createDetachedClient().auth.getUser(pending.accessToken);
    return !error && typeof data.user?.email === 'string' && data.user.email !== '' ? data.user.email : null;
  } catch {
    return null;
  }
}

/** Whether Auth verifies the visitor's session; anything that fails counts as no session. */
async function hasSession(): Promise<boolean> {
  try {
    const { data, error } = await (await createEditorClient()).auth.getUser();
    return !error && data.user !== null && data.user !== undefined;
  } catch {
    return false;
  }
}
