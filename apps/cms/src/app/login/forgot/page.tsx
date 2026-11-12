import { t } from '@/i18n/is';
import { AuthFrame } from '@/ui/AuthFrame';
import { ForgotPasswordForm } from './ForgotPasswordForm';

/** "Gleymt lykilorð?" (PW-03): reachable without a session (lib/auth/routing.ts). */
export default function ForgotPasswordPage() {
  return (
    <AuthFrame>
      <h1>{t.forgot.title}</h1>
      <p className="lede">{t.forgot.intro}</p>
      <ForgotPasswordForm />
      <p>
        <a href="/login">{t.forgot.back}</a>
      </p>
    </AuthFrame>
  );
}
