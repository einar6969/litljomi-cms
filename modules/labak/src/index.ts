import { defineModule, extendType, image, newsType, text, type LiveCheck, type SiteEntry } from '@litljomi/cms-schema';

/** How many news entries the home page lists (the site's `allArticles.slice(0, 6)`). */
export const HOME_LATEST_COUNT = 6;

const newsPath = (e: SiteEntry): string => {
  if (e.slug === null) throw new Error(`news entry ${e.id} has no slug`);
  return '/frettir/' + e.slug;
};

const positionIn = (entries: SiteEntry[], e: SiteEntry): number => entries.findIndex((x) => x.id === e.id);

export default defineModule({
  tenant: 'labak',
  locale: 'is',
  branding: { name: 'LABAK' },
  types: [
    extendType(newsType, {
      label: 'Frétt',
      fieldOverrides: {
        title: { label: 'Titill' },
        date: { label: 'Dagsetning' },
        excerpt: { label: 'Inngangur' },
        image: { label: 'Mynd' },
        body: { label: 'Meginmál' },
        source: { label: 'Heimild' },
      },
      extraFields: {
        secondaryImage: image({ label: 'Aukamynd' }),
        // The label of the site's source button (decision 42.2, Q2); the site shows the button only
        // when an external source has a label.
        sourceLabel: text({ label: 'Texti á heimildahnappi', max: 80 }),
      },
    }),
  ],
  structure: [{ type: 'news', label: 'Fréttir' }],
  site: {
    news: {
      path: newsPath,
      checks(e, release, previous) {
        const current = release.entries('news');
        const present = positionIn(current, e) !== -1;
        const expect: LiveCheck['expect'] = present ? 'present' : 'absent';
        // The home page lists the latest HOME_LATEST_COUNT entries. The release decides while the
        // entry is published; once it is gone, the previous release says whether it was listed.
        const position = positionIn(present ? current : (previous?.entries('news') ?? []), e);
        const onHome = position !== -1 && position < HOME_LATEST_COUNT;
        return [
          { path: newsPath(e), expect },
          { path: '/frettir', expect },
          ...(onHome ? [{ path: '/', expect }] : []),
        ];
      },
    },
  },
});
