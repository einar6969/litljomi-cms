import { boolean, date, datetime, defineModule, defineType, link, number, reference, richText, select, text, type SiteEntry } from '@litljomi/cms-schema';

const eventType = defineType({
  name: 'event',
  version: 1,
  label: 'Event',
  fields: {
    title: text({ label: 'Title', required: true }),
    startDate: date({ label: 'Start date', required: true }),
    endDate: date({ label: 'End date' }),
    location: text({ label: 'Location' }),
    description: richText({ label: 'Description' }),
    registration: link({ label: 'Registration' }),
    // One optional field of each scalar kind (M2-03); optional, so existing events stay valid.
    capacity: number({ label: 'Capacity', min: 0, integer: true }),
    freeEntry: boolean({ label: 'Free entry' }),
    category: select({
      label: 'Category',
      options: [
        { value: 'concert', label: 'Concert' },
        { value: 'workshop', label: 'Workshop' },
        { value: 'talk', label: 'Talk' },
      ],
    }),
    doorsOpen: datetime({ label: 'Doors open' }),
    related: reference({ label: 'Related event', to: ['event'] }),
  },
  preview: { title: 'title' },
  orderBy: 'startDate',
});

const eventPath = (e: SiteEntry): string => {
  if (e.slug === null) throw new Error(`event entry ${e.id} has no slug`);
  return '/events/' + e.slug;
};

export default defineModule({
  tenant: 'demo',
  locale: 'is',
  branding: { name: 'Demo' },
  types: [eventType],
  structure: [{ type: 'event', label: 'Events' }],
  site: {
    event: {
      path: eventPath,
      checks(e, release) {
        const expect = release.entries('event').some((x) => x.id === e.id) ? 'present' : 'absent';
        return [
          { path: eventPath(e), expect },
          { path: '/events', expect },
        ];
      },
    },
  },
});
