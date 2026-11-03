'use client';

import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';

/**
 * Shown in place of a page whose server or client code failed (M2-19): without it the editor
 * would see the framework's own English error page. The error itself is logged where it happened
 * and is not shown, since its message is for the platform, not the editor.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <h1>{t.error.title}</h1>
      <p className="mt-4" role="alert">
        {t.error.body}
      </p>
      <p className="mt-6">
        <Button variant="primary" onClick={() => reset()}>
          {t.error.retry}
        </Button>
      </p>
    </main>
  );
}
