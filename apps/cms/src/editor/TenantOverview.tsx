import type { StructureNode } from '@litljomi/cms-schema';
import Link from 'next/link';
import { t } from '@/i18n/is';
import { linkButtonClasses } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { StatusBadge } from '@/ui/StatusBadge';
import { entryPill, formatOverviewTime, type OverviewEntry, type Read, type StatusSummary } from './overview';
import type { TenantOverviewData } from './server/tenant-overview';
import { StructureNav } from './StructureNav';

type Props = {
  tenantSlug: string;
  tenantName: string;
  structure: StructureNode[];
  /** What to call a content type, resolved by the page. Without a label a row shows none, never the key. */
  typeLabel: (type: string) => string | undefined;
  overview: TenantOverviewData;
  /** The moment "í dag" and "í gær" are counted from. */
  now: Date;
};

const Pill = ({ entry, status }: { entry: Pick<OverviewEntry, 'id' | 'status'>; status: Read<StatusSummary> }) => {
  const { label, tone } = entryPill(entry, status);
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
};

function Time({ iso, now, className = '' }: { iso: string; now: Date; className?: string }) {
  return (
    <time dateTime={iso} className={`mono ${className}`.trim()}>
      {formatOverviewTime(iso, now)}
    </time>
  );
}

function RecentTable({ rows, base, typeLabel, status, now }: { rows: OverviewEntry[]; base: string; typeLabel: Props['typeLabel']; status: Read<StatusSummary>; now: Date }) {
  return (
    // Below 768 px the table is stacked (globals.css), so its roles are stated, as in the entry list.
    <table role="table" className="tbl entry-table">
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader">{t.entries.title}</th>
          <th role="columnheader" className="w-status">
            {t.entries.status}
          </th>
          <th role="columnheader" className="w-time">
            {t.entries.updated}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => {
          const label = typeLabel(row.type);
          return (
            <tr key={row.id} role="row">
              <td role="cell">
                <Link href={`${base}/${encodeURIComponent(row.type)}/${encodeURIComponent(row.id)}`} className={row.title ? 't' : 't text-muted'}>
                  {row.title ?? t.entries.untitled}
                </Link>
                {label ? <span className="ov-type">{label}</span> : null}
              </td>
              <td role="cell">
                <Pill entry={row} status={status} />
              </td>
              <td role="cell">
                <Time iso={row.updated_at} now={now} className="text-muted" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The tenant home: the site's state over the content types, the recent changes and the singletons'
 * pages (the Síður card). What it says comes from `loadTenantOverview` and editor/overview.ts; this
 * file only lays it out.
 */
export function TenantOverview({ tenantSlug, tenantName, structure, typeLabel, overview, now }: Props) {
  const { band, counts, recent, showingWaiting, pages, pagesFailed, status } = overview;
  const base = `/t/${encodeURIComponent(tenantSlug)}`;
  return (
    <>
      <div className="head head-home">
        <div className="hello">
          <h1>{tenantName}</h1>
          <p>{t.tenant.greeting}</p>
        </div>
        {band.siteUrl ? (
          <a href={band.siteUrl} target="_blank" rel="noopener noreferrer" className={linkButtonClasses('secondary')}>
            <span>{t.overview.viewSite}</span>
            <Icon name="arrowUpRight" />
          </a>
        ) : null}
      </div>

      <section className="band" aria-labelledby="site-state">
        <div className="band-t">
          {band.tag ? <span className="tag-go">{t.overview.live}</span> : null}
          <h2 id="site-state">{band.heading}</h2>
          {band.lastPublished ? (
            <p className="text-sm text-muted">
              <span>{t.overview.lastPublished}</span> <Time iso={band.lastPublished} now={now} />
            </p>
          ) : null}
        </div>
        {band.viewChanges ? (
          <Link href={`${base}?breytingar=1#recent`} className={linkButtonClasses('ink')}>
            {t.overview.viewChanges}
          </Link>
        ) : null}
      </section>

      <StructureNav tenantSlug={tenantSlug} structure={structure} counts={counts} />

      <div className={pages.length > 0 ? 'ov' : 'ov ov-one'}>
        <section className="card tbl-w" aria-labelledby="recent">
          <div className="ov-top">
            <h2 className="ov-h" id="recent">
              {t.overview.recent}
            </h2>
            {showingWaiting ? (
              <Link href={base} className="ov-clear">
                {t.entries.filter.clear}
              </Link>
            ) : null}
          </div>
          {!recent.ok ? (
            <div className="ov-note">
              <Notice tone="error">{t.editor.reference.loadError}</Notice>
            </div>
          ) : recent.value.length === 0 ? (
            <div className="empty">
              <p>{t.entries.empty}</p>
            </div>
          ) : (
            <RecentTable rows={recent.value} base={base} typeLabel={typeLabel} status={status} now={now} />
          )}
        </section>
        {pages.length > 0 ? (
          <section className="card tbl-w" aria-labelledby="pages-h">
            <h2 className="ov-h" id="pages-h">
              {t.overview.pages}
            </h2>
            {pagesFailed ? (
              <div className="ov-note">
                <Notice tone="error">{t.editor.reference.loadError}</Notice>
              </div>
            ) : null}
            {pages.map(({ type, label, entry }) => (
              <Link key={type} href={`${base}/${encodeURIComponent(type)}`} className="pg-row">
                <span>{label}</span>
                {entry ? <Pill entry={entry} status={status} /> : null}
              </Link>
            ))}
          </section>
        ) : null}
      </div>
    </>
  );
}
