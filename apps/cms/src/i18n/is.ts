// The editor's interface text, in Icelandic for every tenant in v1 (spec §3.2). Later tasks add keys.
export const is = {
  app: {
    title: 'Litljómi vefumsjón',
    signOut: 'Skrá út',
  },
  login: {
    title: 'Innskráning',
    intro: 'Sláðu inn netfangið þitt og við sendum þér innskráningarhlekk.',
    emailLabel: 'Netfang',
    submit: 'Senda innskráningarhlekk',
    // One neutral message for success, an unknown address and a rate limit alike (decision 37.4).
    sent: 'Ef netfangið er skráð færðu tölvupóst',
    linkInvalid: 'Innskráningarhlekkurinn er ógildur eða útrunninn. Biddu um nýjan.',
  },
  tenants: {
    title: 'Vefirnir þínir',
    none: 'Þú hefur ekki aðgang að neinum vef.',
  },
  tenant: {
    inactive: 'Vefur óvirkur',
    inactiveBody: 'Ekki er hægt að breyta efni þessa vefs eins og er.',
    contentTypes: 'Efnisflokkar',
  },
  notFound: {
    title: 'Síðan fannst ekki',
    back: 'Á forsíðu',
  },
} as const;

export const t: typeof is = is;
