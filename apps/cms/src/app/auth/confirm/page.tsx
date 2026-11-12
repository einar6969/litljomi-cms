import type { Metadata } from 'next';
import { t } from '@/i18n/is';
import { createDetachedClient, createEditorClient } from '@/lib/supabase/server';
import { AuthFrame } from '@/ui/AuthFrame';
import { Button } from '@/ui/Button';
import { KeepSessionFresh } from '@/ui/KeepSessionFresh';
import { Notice } from '@/ui/Notice';
import { confirmSignIn, keepSession, replaceSession } from './actions';
import { DropLinkQuery } from './DropLinkQuery';
import { readPending } from './pending';

// The URL carries the token hash: no Referer header passes it on.
export const metadata = { referrer: 'no-referrer' } satisfies Metadata;

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ token_hash?: Param; type?: Param; next?: Param }> };

const first = (value: Param): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * The landing page of the invitation and password-reset links (spec §4.4; decision 41.1; PW-03).
 * Opening it verifies nothing (email security scanners open links automatically): it shows one
 * "Halda áfram" button, and only that button's POST (confirmSignIn) uses the link. The link's values
 * go to the action unchecked; the action checks them, and refuses a magic link's. Once loaded, the
 * page drops the link's query from the address bar (M3-14).
 *
 * A visitor who already has a session is told so, without naming either account (decision 42.2, Q1),
 * and the browser keeps that session fresh while the page is open (R7: the server never refreshes
 * one, so the button's POST would otherwise find it expired and ask nothing).
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
    <AuthFrame>
      <DropLinkQuery />
      <h1>{emailChange ? t.confirm.emailChangeTitle : t.confirm.title}</h1>
      <p className="lede">{emailChange ? t.confirm.emailChangeIntro : t.confirm.intro}</p>
      {signedIn ? (
        <>
          <KeepSessionFresh />
          <Notice tone="info" role="status">
            <span className="font-semibold">{t.confirm.signedIn}</span> {t.confirm.signedInDetail}
          </Notice>
        </>
      ) : null}
      <form action={confirmSignIn}>
        <input type="hidden" name="token_hash" value={first(token_hash)} />
        <input type="hidden" name="type" value={first(type)} />
        <input type="hidden" name="next" value={first(next)} />
        <Button type="submit" variant="primary" className="btn-wide">
          {t.confirm.submit}
        </Button>
      </form>
    </AuthFrame>
  );
}

/** The question before a link replaces the visitor's session: the link's account and two buttons. */
function ReplaceQuestion({ email }: { email: string }) {
  return (
    <AuthFrame>
      <KeepSessionFresh />
      <h1>{t.confirm.replaceTitle}</h1>
      <p>
        {t.confirm.replaceAccount} <strong>{email}</strong>.
      </p>
      <p className="lede">{t.confirm.replaceDetail}</p>
      <div className="acts">
        <form action={replaceSession}>
          <Button type="submit" variant="ink">
            {t.confirm.replace}
          </Button>
        </form>
        <form action={keepSession}>
          <Button type="submit">{t.confirm.keep}</Button>
        </form>
      </div>
    </AuthFrame>
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
