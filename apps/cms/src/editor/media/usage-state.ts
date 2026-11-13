// The pill of a file's use (docs/architecture.md section 7.4), with no I/O. Its own module, not
// library-format's: it reads the overview's proof, which the file panel's bundle has no use for.
import { t } from '@/i18n/is';
import type { BadgeTone } from '@/ui/StatusBadge';
import { entryPill, type Read, type StatusSummary } from '../overview';

/**
 * An entry's use of a file, as one pill (§7.4: success is never shown before its proof). "Á vefnum"
 * only where the entry's publish is proven live, the overview's `proven` set. A file the published
 * revision uses without that proof shows what the editor shows for the entry (waiting, not
 * confirmed, failed, or plain "Birt" when no request says more, and when the status could not be
 * read). Else "Í uppkasti".
 */
export function usageState(
  { entry_id, in_published }: { entry_id: string; in_draft: boolean; in_published: boolean },
  proof: Read<StatusSummary>,
): { label: string; tone: BadgeTone } {
  if (!in_published) return { label: t.library.usage.draft, tone: 'neutral' };
  if (proof.ok && proof.value.proven.has(entry_id) && !proof.value.unproven.has(entry_id)) return { label: t.library.usage.live, tone: 'ok' };
  return entryPill({ id: entry_id, status: 'published' }, proof);
}
