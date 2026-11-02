import { CmsEntryMarker, type BundleEntry } from '@litljomi/cms-sdk';
import { RichText } from '@litljomi/rich-text';
import type { EventEntry } from '../../types/cms';

export type EventItem = BundleEntry<EventEntry>;

/** The marker sits here, in the component that renders the event, so it comes from the data shown. */
export function EventSummary({ event }: { event: EventItem }) {
  return (
    <article>
      <CmsEntryMarker entry={event} />
      <h2>
        <a href={`/events/${event.slug}`}>{event.data.title}</a>
      </h2>
      <p>{event.data.startDate}</p>
    </article>
  );
}

export function EventDetail({ event }: { event: EventItem }) {
  const { data } = event;
  return (
    <article>
      <CmsEntryMarker entry={event} />
      <h1>{data.title}</h1>
      <p>
        {data.startDate}
        {data.endDate ? ` – ${data.endDate}` : null}
      </p>
      {data.location ? <p>{data.location}</p> : null}
      {data.description ? <RichText doc={data.description} /> : null}
      {data.registration && 'href' in data.registration ? <a href={data.registration.href}>Skráning</a> : null}
    </article>
  );
}
