import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SearchShortcut } from '@/editor/SearchShortcut';
import { AssetDetail } from '@/editor/media/AssetDetail';
import { LibraryFiles, type LibraryFile } from '@/editor/media/LibraryFiles';
import { isLibraryFiltered, libraryHref, LIBRARY_PAGE_SIZE, LIBRARY_SORTS, MAX_LIBRARY_PAGE, parseLibraryState, type LibraryFilter, type LibraryState } from '@/editor/media/library-filter';
import { filesLine, formatBytes, formatUploadDate, unusedLine } from '@/editor/media/library-format';
import { LibraryUpload, UploadTrigger } from '@/editor/media/LibraryUpload';
import { assetUse, loadLibraryFile, loadLibraryFiles, loadLibrarySummary, loadUsageCounts } from '@/editor/server/library';
import { MAX_QUERY_LENGTH } from '@/editor/entry-list-filter';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getType } from '@/modules/registry';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { TopBar } from '@/ui/TopBar';
import { Cloud } from '@/ui/Wordmark';

type Props = {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTER_LABELS: Record<LibraryFilter, string> = { 'missing-alt': t.library.filter.missingAlt, unused: t.library.filter.unused };

// The media library (docs/plans/media-library.md section 6, slices L4 and L5): all of a tenant's
// files, newest first, in a grid or a table, with a search, two quick filters, a sort and a page
// of 60 at a time; a file's details in a panel beside them (`?file=`), and an upload of several
// files at once. Rendered on the server with the state in the URL, like the entry list, so a view
// can be reloaded and shared and the search works before JavaScript loads. The tenant is resolved
// through api.my_tenants; every read uses the editor's session and names the tenant, so RLS
// decides what is listed (editor/server/library.ts). Rendering never writes: thumbnails a file
// lacks are asked for from the browser. `assets` is a static segment beside [type], so no content
// type may be named "assets" (the module registry's tests check this).
export default async function LibraryPage({ params, searchParams }: Props) {
  const { tenant: slug } = await params;
  const state = parseLibraryState(await searchParams);
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const client = await createEditorClient();
  const tenantPath = `/t/${encodeURIComponent(tenant.slug)}`;
  const base = `${tenantPath}/assets`;
  const href = (change: Partial<LibraryState>) => libraryHref(base, state, change);

  const [summary, listed, detail] = await Promise.all([
    loadLibrarySummary(client, tenant.id),
    loadLibraryFiles(client, tenant.id, state),
    state.file === null ? null : loadLibraryFile(client, tenant.id, state.file),
  ]);
  const usageCounts = state.view === 'list' ? await loadUsageCounts(client, tenant.id, listed.files.map((f) => f.id)) : null;
  const files: LibraryFile[] = listed.files.map((f) => ({
    id: f.id,
    href: href({ file: f.id }),
    filename: f.filename,
    mime: f.mime,
    kind: f.kind,
    alt: f.default_alt?.trim() ? f.default_alt : null,
    width: f.width,
    height: f.height,
    bytes: f.bytes,
    createdAt: f.created_at,
    uploaded: formatUploadDate(f.created_at),
    thumbUrl: f.thumb_path === null ? null : (listed.thumbUrls.get(f.thumb_path) ?? null),
    usage: usageCounts?.get(f.id) ?? null,
  }));

  const empty = summary.files === 0;
  const filtered = isLibraryFiltered(state);
  const openFile = detail === null ? null : state.file;
  const closeHref = href({ file: null });

  return (
    <>
      <TopBar title={tenant.name} crumbs={[{ label: tenant.name, href: tenantPath }, { label: t.library.title }]} />
      <main className={detail ? 'page page-lib has-file' : 'page page-lib'}>
        <SearchShortcut inputId="library-search" />
        <div className="head">
          <div className="lib-h">
            <h1>{t.library.title}</h1>
            {empty ? null : (
              <p className="help" data-testid="library-summary">
                {filesLine(summary.files)} · {formatBytes(summary.bytes)}
                {summary.unused > 0 ? (
                  <>
                    {' · '}
                    <Link href={libraryHref(base, { ...state, filter: 'unused', page: 1, file: null })}>{unusedLine(summary.unused)}</Link>
                  </>
                ) : null}
              </p>
            )}
          </div>
          <LibraryUpload tenantId={tenant.id} tenantSlug={tenant.slug} newestHref={libraryHref(base, { ...state, q: '', filter: null, sort: 'newest', page: 1, file: null })} showButton={!empty} />
        </div>
        {empty ? null : (
          <div className="lib-tools">
            <form role="search" aria-label={t.entries.filter.label} method="get" action={base} className="tools">
              <div className="search">
                <label htmlFor="library-search" className="sr-only">
                  {t.library.search}
                </label>
                <Icon name="search" />
                <input id="library-search" name="q" type="search" placeholder={t.library.search} maxLength={MAX_QUERY_LENGTH} defaultValue={state.q} />
                <span className="kbd" aria-hidden="true">
                  /
                </span>
              </div>
              {state.filter ? <input type="hidden" name="filter" value={state.filter} /> : null}
              {state.view !== 'grid' ? <input type="hidden" name="view" value={state.view} /> : null}
              <label htmlFor="library-sort" className="sr-only">
                {t.library.sort.label}
              </label>
              <select id="library-sort" name="sort" defaultValue={state.sort}>
                {LIBRARY_SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {t.library.sort[sort]}
                  </option>
                ))}
              </select>
              <Button type="submit">{t.entries.filter.submit}</Button>
            </form>
            <div className="lib-chips">
              {(['missing-alt', 'unused'] as const).map((filter) => (
                <Link
                  key={filter}
                  href={href({ filter: state.filter === filter ? null : filter, page: 1, file: null })}
                  className="chip"
                  aria-current={state.filter === filter ? 'true' : undefined}
                >
                  {state.filter === filter ? <Icon name="check" /> : null}
                  {FILTER_LABELS[filter]}
                </Link>
              ))}
              {filtered ? (
                <Link href={libraryHref(base, { ...state, q: '', filter: null, page: 1, file: null })} className="inline-flex min-h-[44px] items-center px-2 text-sm">
                  {t.entries.filter.clear}
                </Link>
              ) : null}
              <span className="lib-views">
                <Link href={href({ view: 'grid' })} className="icbtn" aria-label={t.library.view.grid} aria-current={state.view === 'grid' ? 'true' : undefined}>
                  <Icon name="grid" />
                </Link>
                <Link href={href({ view: 'list' })} className="icbtn" aria-label={t.library.view.list} aria-current={state.view === 'list' ? 'true' : undefined}>
                  <Icon name="bulletList" />
                </Link>
              </span>
            </div>
          </div>
        )}
        <div className={detail ? 'lib has-panel' : 'lib'}>
          <div className="lib-main">
            {empty ? (
              <div className="card empty">
                <Cloud />
                <p>
                  <strong>{t.library.empty}</strong> {t.library.emptyBody}
                </p>
                <UploadTrigger />
              </div>
            ) : files.length === 0 ? (
              <div className="card empty">
                <p>{t.library.none}</p>
                <Link href={libraryHref(base, { ...state, q: '', filter: null, page: 1, file: null })} className="inline-flex min-h-[44px] items-center px-2">
                  {t.entries.filter.clear}
                </Link>
              </div>
            ) : (
              <>
                <LibraryFiles view={state.view} files={files} activeId={openFile} />
                {listed.hasMore && state.page < MAX_LIBRARY_PAGE ? (
                  <Link href={href({ page: state.page + 1, file: null })} className="btn btn-line lib-more" scroll={false}>
                    {t.library.more}
                  </Link>
                ) : listed.hasMore ? (
                  <Notice tone="info">{t.library.capped.replace('{n}', String(MAX_LIBRARY_PAGE * LIBRARY_PAGE_SIZE))}</Notice>
                ) : null}
              </>
            )}
          </div>
          {detail ? (
            <AssetDetail
              key={detail.file.id}
              file={detail.file}
              url={detail.url}
              usage={detail.usage.map((row) => assetUse(row, tenantPath, (type) => getType(tenant.slug, type)?.label, detail.proof))}
              originalHref={`${base}/${detail.file.id}/original`}
              closeHref={closeHref}
            />
          ) : null}
        </div>
      </main>
    </>
  );
}
