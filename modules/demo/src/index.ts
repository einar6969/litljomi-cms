import { boolean, date, datetime, defineModule, defineType, group, image, link, list, number, reference, richText, select, text, video, type SiteEntry } from '@litljomi/cms-schema';

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
    // A group holding a list of references (M2-06), a list of videos (A11) and a list of images
    // (media library L6); optional, so existing events stay valid.
    program: group({
      label: 'Program',
      fields: {
        intro: text({ label: 'Introduction', multiline: true }),
        highlights: list(reference({ label: 'Event', to: ['event'] }), { label: 'Highlights', max: 10 }),
        videos: list(video({ label: 'Video' }), { label: 'Videos', max: 3 }),
        gallery: list(image({ label: 'Photo' }), { label: 'Gallery', max: 12 }),
      },
    }),
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
    // Added in M2-13, an additive change (no transform, §5.3): `orderBy` fills the `sort_at`
    // timestamp column, so it names a date field, not the title.
    date: date({ label: 'Date' }),
  },
  preview: { title: 'title' },
  orderBy: 'date',
  transforms: {
    1: (data) => {
      const { heading, ...rest } = data as Record<string, unknown>;
      return { ...rest, title: heading };
    },
  },
});

/**
 * A singleton test type (M2-09; spec §3.2, §10.1): the demo site's one "site info" entry. The
 * editor opens it directly, creating it on first open. It has no site pages.
 */
const siteInfoType = defineType({
  name: 'site-info',
  version: 1,
  label: 'Site info',
  fields: {
    title: text({ label: 'Site name', required: true }),
    tagline: text({ label: 'Tagline' }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
});

/**
 * A singleton with no page of its own (A7; spec §3.2, §7.4): the events page's introduction and
 * featured events, shown on the shared `/events` page only, as a portfolio's home-page settings
 * are. Its title field is a list, never text, so it never gets a slug, and it needs none.
 */
const eventsPageType = defineType({
  name: 'events-page',
  version: 1,
  label: 'Events page',
  fields: {
    intro: text({ label: 'Introduction', multiline: true, required: true }),
    featured: list(reference({ label: 'Event', to: ['event'] }), { label: 'Featured events', max: 3 }),
  },
  preview: { title: 'featured' },
  orderBy: 'intro',
});

/**
 * A manually ordered test type (A12; spec §5.1): editors put the partners in order in the entry
 * list, and the bundle lists them in that order. It has no site pages.
 */
const partnerType = defineType({
  name: 'partner',
  version: 1,
  label: 'Partner',
  fields: {
    title: text({ label: 'Name', required: true }),
    website: link({ label: 'Website' }),
  },
  preview: { title: 'title' },
  orderBy: 'manual',
});

const eventPath = (e: SiteEntry): string => {
  if (e.slug === null) throw new Error(`event entry ${e.id} has no slug`);
  return '/events/' + e.slug;
};

export default defineModule({
  tenant: 'demo',
  locale: 'is',
  branding: { name: 'Demo' },
  types: [eventType, noticeType, siteInfoType, eventsPageType, partnerType],
  structure: [
    {
      group: 'Content',
      items: [
        { type: 'event', label: 'Events' },
        { type: 'partner', label: 'Partners' },
      ],
    },
    { type: 'site-info', label: 'Site info', singleton: true },
    { type: 'events-page', label: 'Events page', singleton: true },
  ],
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
    // No `path`: the entry is checked where it is shown, on the shared events page (A7).
    'events-page': {
      checks(e, release) {
        const expect = release.entries('events-page').some((x) => x.id === e.id) ? 'present' : 'absent';
        return [{ path: '/events', expect }];
      },
    },
  },
});
