import { notFound } from 'next/navigation';
import { cms, publishedCms } from '../../../lib/cms';
import { EventDetail, type EventItem } from '../event';

// Built from the published release: no request (and so no draft mode) exists at build time.
export async function generateStaticParams() {
  const events = await publishedCms().getEntries<EventItem['data']>('event');
  return events.flatMap((e) => (e.slug === null ? [] : [{ slug: e.slug }]));
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await cms().getEntry<EventItem['data']>('event', slug);
  if (event === null) notFound();
  return (
    <main>
      <EventDetail event={event} />
    </main>
  );
}
