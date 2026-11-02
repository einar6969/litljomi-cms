import { t } from '@/i18n/is';
import { requestMagicLink } from './actions';

type Props = { searchParams: Promise<{ sent?: string | string[]; error?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const { sent, error } = await searchParams;
  return (
    <main>
      <h1>{t.login.title}</h1>
      <p>{t.login.intro}</p>
      {error === 'link' ? <p role="alert">{t.login.linkInvalid}</p> : null}
      <form action={requestMagicLink}>
        <label htmlFor="email">{t.login.emailLabel}</label>
        <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
        <button type="submit">{t.login.submit}</button>
      </form>
      {sent === '1' ? <p role="status">{t.login.sent}</p> : null}
    </main>
  );
}
