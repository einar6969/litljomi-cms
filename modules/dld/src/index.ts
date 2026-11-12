import {
  date,
  defineModule,
  defineType,
  group,
  image,
  link,
  list,
  reference,
  richText,
  select,
  text,
  video,
  type LiveCheck,
  type SiteEntry,
} from '@litljomi/cms-schema';

// The DLD tenant module, as approved in docs/clients/dld/content-model.md (sections 1 to 3).
// Type names, field keys, kinds, limits and required flags are final; labels are DRAFT.

/** How many news entries the home page lists (the site shows the three newest). */
export const HOME_LATEST_COUNT = 3;

/** DLD's seven project categories, stored value and label, in today's order. Never rename a value. */
export const CATEGORIES = [
  { value: 'fraedsluefni', label: 'Fræðsluefni' },
  { value: 'honnun', label: 'Hönnun' },
  { value: 'samkeppnir', label: 'Samkeppnir' },
  { value: 'skipulag-utivist', label: 'Skipulag / útivist' },
  { value: 'voruhonnun', label: 'Vöruhönnun' },
  { value: 'thatttokuhonnun', label: 'Þátttökuhönnun' },
  { value: 'throunarverkefni', label: 'Þróunarverkefni, sýningar og innsetningar' },
] as const;

const projectType = defineType({
  name: 'project',
  version: 1,
  label: 'Verk',
  fields: {
    title: text({ label: 'Titill', required: true, max: 120 }),
    categories: list(select({ label: 'Flokkur', options: CATEGORIES }), { label: 'Flokkar', max: 7 }),
    images: list(image({ label: 'Mynd' }), { label: 'Myndir (sú fyrsta er aðalmynd)', required: true, min: 1, max: 40 }),
    body: richText({ label: 'Texti' }),
    facts: group({
      label: 'Staðreyndir',
      fields: {
        client: text({ label: 'Verkkaupi', max: 300 }),
        year: text({ label: 'Framkvæmt (ár)', max: 300 }),
        contractors: text({ label: 'Verktakar', max: 300 }),
        collaborators: text({ label: 'Samstarf', max: 300 }),
        location: text({ label: 'Staðsetning', max: 300 }),
        role: text({ label: 'Hlutverk DLD', max: 300 }),
        award: text({ label: 'Viðurkenning', max: 300 }),
      },
    }),
    videos: list(video({ label: 'Myndband', still: 'required' }), { label: 'Myndbönd', max: 6 }),
  },
  preview: { title: 'title' },
  // No sort date: the order is set by dragging (A12, not built). `orderBy` names a text field,
  // which fills no sort column.
  orderBy: 'title',
});

/**
 * A tenant type, not an extension of the shared library `news` type: `title`, `date`, `image` and
 * `body` are identical to the library type, but `excerpt` and `source` are left out because DLD's
 * site shows neither.
 */
const newsType = defineType({
  name: 'news',
  version: 1,
  label: 'Frétt',
  fields: {
    title: text({ label: 'Titill', required: true, max: 200 }),
    date: date({ label: 'Dagsetning', required: true }),
    kind: select({
      label: 'Tegund',
      required: true,
      options: [
        { value: 'frett', label: 'Frétt eða verkefnapistill' },
        { value: 'jolakvedja', label: 'Jólakveðja' },
      ],
    }),
    image: image({ label: 'Aðalmynd', required: true }),
    gallery: list(image({ label: 'Mynd' }), { label: 'Fleiri myndir', max: 20 }),
    body: richText({ label: 'Texti' }),
    relatedProject: reference({ label: 'Tengt verk', to: ['project'] }),
    videos: list(video({ label: 'Myndband', still: 'required' }), { label: 'Myndbönd', max: 6 }),
  },
  preview: { title: 'title' },
  orderBy: 'date',
});

const personType = defineType({
  name: 'person',
  version: 1,
  label: 'Starfsmaður',
  fields: {
    name: text({ label: 'Nafn', required: true, max: 120 }),
    jobTitle: text({ label: 'Starfsheiti', required: true, max: 120 }),
    role: text({ label: 'Hlutverk hjá DLD', max: 200 }),
    email: text({ label: 'Netfang', max: 200 }),
    portrait: image({ label: 'Mynd', required: true }),
    bio: list(
      group({
        label: 'Hluti',
        fields: {
          heading: text({ label: 'Fyrirsögn', required: true, max: 80 }),
          items: list(text({ label: 'Atriði', max: 300 }), { label: 'Atriði', max: 20 }),
        },
      }),
      { label: 'Menntun og ferill', max: 6 },
    ),
  },
  preview: { title: 'name' },
  // Order is set by dragging (A12, not built).
  orderBy: 'name',
});

/** A singleton. `preview` and `orderBy` name a field only because a type needs them. */
const homeType = defineType({
  name: 'home',
  version: 1,
  label: 'Forsíða',
  fields: {
    slides: list(image({ label: 'Mynd' }), { label: 'Myndir efst á forsíðu', min: 1, max: 8 }),
    featured: list(reference({ label: 'Verk', to: ['project'] }), { label: 'Verk á forsíðu', max: 6 }),
    slogans: list(text({ label: 'Slagorð', max: 120 }), { label: 'Slagorð á forsíðu', max: 12 }),
  },
  preview: { title: 'slogans' },
  orderBy: 'slogans',
});

/** A singleton. `preview` and `orderBy` name a field only because a type needs them. */
const contactType = defineType({
  name: 'contact',
  version: 1,
  label: 'Tengiliðaupplýsingar',
  fields: {
    email: text({ label: 'Netfang', required: true, max: 200 }),
    phone: text({ label: 'Sími', max: 40 }),
    address: group({
      label: 'Heimilisfang',
      fields: {
        line1: text({ label: 'Lína 1', required: true, max: 120 }),
        line2: text({ label: 'Lína 2', max: 120 }),
      },
    }),
    mapUrl: link({ label: 'Hlekkur á Google Maps' }),
    socials: list(
      group({
        label: 'Samfélagsmiðill',
        fields: {
          label: text({ label: 'Heiti', required: true, max: 40 }),
          url: link({ label: 'Hlekkur', required: true }),
        },
      }),
      { label: 'Samfélagsmiðlar', max: 8 },
    ),
    footerText: text({ label: 'Texti í fæti vefsins', max: 200 }),
  },
  preview: { title: 'email' },
  orderBy: 'email',
});

const slugOf = (e: SiteEntry): string => {
  if (e.slug === null) throw new Error(`${e.type} entry ${e.id} has no slug`);
  return e.slug;
};
const projectPath = (e: SiteEntry): string => '/verk/' + slugOf(e);
const newsPath = (e: SiteEntry): string => '/frettir/' + slugOf(e);

const has = (entries: SiteEntry[], e: SiteEntry): boolean => entries.some((x) => x.id === e.id);

/**
 * Newest first, then slug ascending, as the site sorts. The release view orders by `sortAt`
 * descending only and does not break ties, so the module sorts again. An entry without a date goes last.
 */
const newsOrder = (entries: SiteEntry[]): SiteEntry[] =>
  [...entries].sort((a, b) => {
    if (a.sortAt !== b.sortAt) {
      if (a.sortAt === null) return 1;
      if (b.sortAt === null) return -1;
      return a.sortAt < b.sortAt ? 1 : -1;
    }
    const sa = a.slug ?? '';
    const sb = b.slug ?? '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

const positionIn = (entries: SiteEntry[], e: SiteEntry): number => entries.findIndex((x) => x.id === e.id);

export default defineModule({
  tenant: 'dld',
  locale: 'is',
  branding: { name: 'Dagný Land Design' },
  types: [projectType, newsType, personType, homeType, contactType],
  structure: [
    { type: 'project', label: 'Verk' },
    { type: 'news', label: 'Fréttir' },
    { type: 'person', label: 'Starfsfólk' },
    { type: 'home', label: 'Forsíða', singleton: true },
    { type: 'contact', label: 'Tengiliðaupplýsingar', singleton: true },
  ],
  site: {
    project: {
      path: projectPath,
      checks(e, release) {
        const expect: LiveCheck['expect'] = has(release.entries('project'), e) ? 'present' : 'absent';
        return [
          { path: projectPath(e), expect },
          { path: '/verk', expect },
        ];
      },
    },
    news: {
      path: newsPath,
      checks(e, release, previous) {
        const current = newsOrder(release.entries('news'));
        const present = has(current, e);
        const expect: LiveCheck['expect'] = present ? 'present' : 'absent';
        // The home page lists the three newest. The release decides while the entry is published;
        // once it is gone, the previous release says whether it was listed.
        const position = positionIn(present ? current : newsOrder(previous?.entries('news') ?? []), e);
        const onHome = position !== -1 && position < HOME_LATEST_COUNT;
        return [
          { path: newsPath(e), expect },
          { path: '/frettir', expect },
          ...(onHome ? [{ path: '/', expect }] : []),
        ];
      },
    },
    // TODO(A7): person, home and contact have no page of their own, so they have no site entry until
    // enhancement A7 (live confirmation for content with no page of its own) is built. Intended pages:
    //   person  -> /um-okkur
    //   home    -> /
    //   contact -> / and /hafdu-samband
    // Manual ordering (A12) is not built either; nothing here depends on it.
  },
});
