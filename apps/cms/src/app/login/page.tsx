import { t } from '@/i18n/is';
import { AuthFrame } from '@/ui/AuthFrame';
import { Notice } from '@/ui/Notice';
import { SignInForm } from './SignInForm';

type Props = { searchParams: Promise<{ next?: string | string[]; error?: string | string[]; emailChange?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next, error, emailChange } = await searchParams;
  return (
    <AuthFrame>
      <h1>{t.login.title}</h1>
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
      <SignInForm next={typeof next === 'string' ? next : undefined} />
    </AuthFrame>
  );
}
