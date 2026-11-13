import { cms } from '../../lib/cms';
import { EventSummary, type EventItem } from './event';
import { EventsIntro, type EventsPageItem } from './events-page';

export default async function EventsPage() {
  const client = cms();
  const [events, [page]] = await Promise.all([client.getEntries<EventItem['data']>('event'), client.getEntries<EventsPageItem['data']>('events-page')]);
  return (
    <main>
      <h1>Viðburðir</h1>
      {page ? <EventsIntro page={page} /> : null}
      {events.map((event) => (
        <EventSummary key={event.id} event={event} />
      ))}
    </main>
  );
}
