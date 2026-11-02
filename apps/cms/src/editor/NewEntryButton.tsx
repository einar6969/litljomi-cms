'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createEntryAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';

/** Creates an empty entry of the type and opens it. */
export function NewEntryButton({ tenantSlug, type }: { tenantSlug: string; type: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'creating' | 'failed'>('idle');
  const create = async () => {
    setState('creating');
    try {
      const { entryId } = await createEntryAction(tenantSlug, type);
      router.push(`/t/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(type)}/${entryId}`);
    } catch {
      setState('failed');
    }
  };
  return (
    <>
      <button type="button" disabled={state === 'creating'} onClick={() => void create()}>
        {state === 'creating' ? t.entries.creating : t.entries.new}
      </button>
      {state === 'failed' ? <p role="alert">{t.entries.createFailed}</p> : null}
    </>
  );
}
