'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openSingletonAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';

/**
 * Opens a singleton type's one entry (spec §10.1): asks the server for it, which creates it on
 * first open, and replaces this page with the entry's form. The request is a server action, not
 * part of rendering, so a prefetch of this page never creates anything.
 */
export function OpenSingleton({ tenantSlug, type }: { tenantSlug: string; type: string }) {
  // The router is read through a ref so that opening runs once per type, not on every render.
  const currentRouter = useRouter();
  const router = useRef(currentRouter);
  useEffect(() => {
    router.current = currentRouter;
  });
  const [state, setState] = useState<'opening' | 'failed' | 'auth'>('opening');
  const open = useCallback(async () => {
    setState('opening');
    const result = await openSingletonAction(tenantSlug, type).catch(() => ({ ok: false as const, code: 'error' as const }));
    if (result.ok) router.current.replace(`/t/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(type)}/${result.entryId}`);
    else setState(result.code === 'auth' ? 'auth' : 'failed');
  }, [tenantSlug, type]);
  useEffect(() => {
    void open();
  }, [open]);
  if (state === 'opening') {
    return (
      <div className="card empty">
        <span className="spin" />
        <p role="status" className="text-muted">
          {t.singleton.opening}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <Notice tone="error" role="alert" className="w-full">
        {state === 'auth' ? t.editor.signedOut : t.singleton.openFailed}
      </Notice>
      <Button size="sm" onClick={() => void open()}>
        {t.editor.retry}
      </Button>
    </div>
  );
}
