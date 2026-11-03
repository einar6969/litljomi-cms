import { boolean, date, datetime, defineModule, defineType, link, number, richText, select, text, type SiteEntry } from '@litljomi/cms-schema';

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
  },
  preview: { title: 'title' },
  orderBy: 'startDate',
});

/**
 * A test type for schema evolution (M2-05; spec §5.3). Version 1 had one text field, `heading`;
 * version 2 renamed it to `title` and added `body`, so it ships the transform 1 → 2. It has no
 * site pages and is not in the editor's structure.
 */
const noticeType = defineType({
  name: 'notice',
  version: 2,
  label: 'Notice',
  fields: {
    title: text({ label: 'Title', required: true }),
    body: text({ label: 'Body', multiline: true }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
  transforms: {
    1: (data) => {
      const { heading, ...rest } = data as Record<string, unknown>;
      return { ...rest, title: heading };
    },
  },
});

const eventPath = (e: SiteEntry): string => {
  if (e.slug === null) throw new Error(`event entry ${e.id} has no slug`);
  return '/events/' + e.slug;
};

export default defineModule({
  tenant: 'demo',
  locale: 'is',
  branding: { name: 'Demo' },
  types: [eventType, noticeType],
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
