'use client';

import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Wordmark } from '@/ui/Wordmark';

/**
 * Shown in place of a page whose server or client code failed (M2-19): without it the editor
 * would see the framework's own English error page. The error itself is logged where it happened
 * and is not shown, since its message is for the platform, not the editor.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="msg">
      <Wordmark />
      <main className="msg-b">
        <h1>{t.error.title}</h1>
        <p className="text-muted" role="alert">
          {t.error.body}
        </p>
        <Button variant="ink" onClick={() => reset()}>
          {t.error.retry}
        </Button>
      </main>
    </div>
  );
}
