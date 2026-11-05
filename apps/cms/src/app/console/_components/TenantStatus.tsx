import { StatusBadge } from '@/ui/StatusBadge';
import { statusText } from '@/console/format';

/** A tenant's status in words; a suspended tenant is a warning. */
export function TenantStatus({ status }: { status: string }) {
  return (
    <StatusBadge as="span" tone={status === 'active' ? 'ok' : 'warning'}>
      {statusText(status)}
    </StatusBadge>
  );
}
