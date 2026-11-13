import { CmsEntryMarker, type BundleEntry } from '@litljomi/cms-sdk';
import type { EventsPageEntry } from '../../types/cms';

export type EventsPageItem = BundleEntry<EventsPageEntry>;

/**
 * The events page's own text, a singleton with no page of its own (A7): it is shown here only, so
 * its marker sits here, in the component that renders it.
 */
export function EventsIntro({ page }: { page: EventsPageItem }) {
  const featured = (page.data.featured ?? []).flatMap(({ value }) => (value?.path ? [{ id: value.id, title: value.title, path: value.path }] : []));
  return (
    <section>
      <CmsEntryMarker entry={page} />
      {page.data.intro ? <p>{page.data.intro}</p> : null}
      {featured.length > 0 ? (
        <ul>
          {featured.map((e) => (
            <li key={e.id}>
              <a href={e.path}>{e.title}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
