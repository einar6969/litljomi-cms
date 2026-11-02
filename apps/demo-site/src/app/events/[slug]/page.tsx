import { notFound } from 'next/navigation';
import { cms } from '../../../lib/cms';
import { EventDetail, type EventItem } from '../event';

export async function generateStaticParams() {
  const events = await cms().getEntries<EventItem['data']>('event');
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
