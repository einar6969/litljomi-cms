import { t } from '@/i18n/is';

/** "Litljómi vefumsjón": the name in the display face, with an accent mark (a fill) before it. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight">
      <span aria-hidden="true" className="size-3 rounded-full bg-accent ring-1 ring-ink" />
      {t.app.title}
    </span>
  );
}
