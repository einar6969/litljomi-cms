import type { ReactNode } from 'react';
import { t } from '@/i18n/is';
import { Cloud, Wordmark } from './Wordmark';

/** The sign-in and confirm pages: the form on the left, the ink panel on the right. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-l">
        <Wordmark />
        <div className="auth-f">{children}</div>
      </main>
      <aside className="auth-r" aria-hidden="true">
        <Cloud className="cloud big" />
        <Wordmark />
        <p className="say">
          {t.login.panelLead}
          <em>{t.login.panelRest}</em>
        </p>
      </aside>
    </div>
  );
}
