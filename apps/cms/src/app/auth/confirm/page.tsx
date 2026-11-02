import type { Metadata } from 'next';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
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
 * action checks them.
 */
export default async function ConfirmPage({ searchParams }: Props) {
  const { token_hash, type, next } = await searchParams;
  return (
    <main className="flex max-w-[480px] flex-col gap-6 pt-12 md:pt-24">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <h1>{t.confirm.title}</h1>
        <p className="text-muted">{t.confirm.intro}</p>
      </div>
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
