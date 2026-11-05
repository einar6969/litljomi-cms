import { StatusBadge } from '@/ui/StatusBadge';
import { statusText } from '@/console/format';

const TONES = { delivered: 'ok', failed: 'error', building: 'pending' } as const;

/** A release's status in words, with the stable error fields when it failed. */
export function ReleaseStatus({ status, code, step }: { status: string; code?: string | null; step?: string | null }) {
  const tone = TONES[status as keyof typeof TONES] ?? 'neutral';
  const detail = [code, step].filter(Boolean).join(' at ');
  return (
    <span className="flex flex-col gap-1">
      <StatusBadge as="span" tone={tone}>
        {statusText(status)}
      </StatusBadge>
      {detail ? <span className="text-muted">{detail}</span> : null}
    </span>
  );
}
