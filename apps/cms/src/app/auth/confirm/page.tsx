import type { Metadata } from 'next';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Wordmark } from '@/ui/Wordmark';
import { confirmSignIn } from './actions';

// The URL carries the token hash: no Referer header passes it on.
export const metadata = { referrer: 'no-referrer' } satisfies Metadata;

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ token_hash?: Param; type?: Param; next?: Param }> };

const first = (value: Param): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * The magic link's landing page (spec §4.4; decision 41.1). Opening it verifies nothing (email
 * security scanners open links automatically): it shows one "Halda áfram" button, and only that
 * button's POST (confirmSignIn) uses the link. The link's values go to the action unchecked; the
 * action checks them. A visitor who already has a session is told so (decision 42.2, Q1), without
 * naming either account; that session is replaced only when the button is pressed.
 */
export default async function ConfirmPage({ searchParams }: Props) {
  const { token_hash, type, next } = await searchParams;
  const signedIn = await hasSession();
  return (
    <main className="flex max-w-[480px] flex-col gap-6 pt-12 md:pt-24">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <h1>{t.confirm.title}</h1>
        <p className="text-muted">{t.confirm.intro}</p>
      </div>
      {signedIn ? (
        <Notice tone="info" role="status">
          {t.confirm.signedIn}
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

/** Whether Auth verifies the visitor's session; anything that fails counts as no session. */
async function hasSession(): Promise<boolean> {
  try {
    const { data, error } = await (await createEditorClient()).auth.getUser();
    return !error && data.user !== null && data.user !== undefined;
  } catch {
    return false;
  }
}
