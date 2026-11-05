'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createEntryAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { Button, type ButtonSize, type ButtonVariant } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';

type Props = { tenantSlug: string; type: string; variant?: ButtonVariant; size?: ButtonSize };

/** Creates an empty entry of the type and opens it. */
export function NewEntryButton({ tenantSlug, type, variant = 'ink', size = 'default' }: Props) {
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
    <div className="flex flex-col gap-2 max-sm:w-full">
      <Button variant={variant} size={size} disabled={state === 'creating'} onClick={() => void create()}>
        {state === 'creating' ? <span className="spin" /> : <Icon name="plus" />}
        {state === 'creating' ? t.entries.creating : t.entries.new}
      </Button>
      {state === 'failed' ? (
        <Notice tone="error" role="alert">
          {t.entries.createFailed}
        </Notice>
      ) : null}
    </div>
  );
}
