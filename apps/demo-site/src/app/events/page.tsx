import { cms } from '../../lib/cms';
import { EventSummary, type EventItem } from './event';

export default async function EventsPage() {
  const events = await cms().getEntries<EventItem['data']>('event');
  return (
    <main>
      <h1>Viðburðir</h1>
      {events.map((event) => (
        <EventSummary key={event.id} event={event} />
      ))}
    </main>
  );
}
