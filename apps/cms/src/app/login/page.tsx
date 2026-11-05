import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { Wordmark } from '@/ui/Wordmark';
import { requestMagicLink } from './actions';

type Props = { searchParams: Promise<{ sent?: string | string[]; error?: string | string[]; emailChange?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const { sent, error, emailChange } = await searchParams;
  return (
    <main className="flex max-w-[480px] flex-col gap-6 pt-12 md:pt-24">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <h1>{t.login.title}</h1>
        <p className="text-muted">{t.login.intro}</p>
      </div>
      {error === 'link' ? (
        <Notice tone="error" role="alert">
          {t.login.linkInvalid}
        </Notice>
      ) : null}
      {emailChange === 'waiting' ? (
        <Notice tone="success" role="status">
          {t.login.emailChangeWaiting}
        </Notice>
      ) : null}
      <form action={requestMagicLink} className="flex flex-col gap-4">
        <Field label={t.login.emailLabel} htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
        </Field>
        <Button type="submit" variant="primary">
          {t.login.submit}
        </Button>
      </form>
      {sent === '1' ? (
        <Notice tone="success" role="status">
          {t.login.sent}
        </Notice>
      ) : null}
    </main>
  );
}
