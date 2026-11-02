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
  entries: {
    new: 'Ný færsla',
    creating: 'Bý til…',
    createFailed: 'Ekki tókst að búa til færsluna. Reyndu aftur.',
    empty: 'Engar færslur ennþá.',
    untitled: 'Án titils',
    title: 'Titill',
    status: 'Staða',
    updated: 'Breytt',
    open: 'Opna',
    back: 'Til baka í lista',
    statuses: {
      draft: 'Uppkast',
      published: 'Birt',
      changed: 'Breytt eftir birtingu',
      archived: 'Í skjalasafni',
    },
  },
  editor: {
    saving: 'Vistar…',
    saved: 'Vistað',
    unsaved: 'Óvistaðar breytingar',
    conflict: 'Annar notandi breytti færslunni',
    conflictBody: 'Breytingarnar þínar eru enn á skjánum en hafa ekki verið vistaðar. Afritaðu það sem þú vilt halda og hlaðaðu síðuna aftur.',
    reload: 'Hlaða aftur',
    signedOut: 'Innskráningin er útrunnin',
    signedOutBody: 'Breytingarnar þínar eru enn á skjánum. Skráðu þig inn aftur í nýjum flipa og reyndu síðan aftur.',
    signIn: 'Skrá inn',
    retry: 'Reyna aftur',
    error: 'Ekki tókst að vista. Breytingarnar þínar eru enn á skjánum.',
    unsupportedField: 'Þennan reit er ekki hægt að breyta hér ennþá. Gildi hans helst óbreytt.',
    entryLink: 'Tengill á aðra færslu. Honum er ekki breytt hér og hann helst óbreyttur.',
    invalidUrl: 'Ógild vefslóð (https://, http:// eða mailto:). Ekki vistað.',
    slug: {
      label: 'Slóð',
      suggestion: 'Tillaga',
      save: 'Vista slóð',
      saved: 'Slóð vistuð',
      taken: 'Slóðin er þegar í notkun',
      locked: 'Slóðinni er læst eftir fyrstu birtingu',
      invalid: 'Ógild slóð (lágstafir, tölur og bandstrik)',
      error: 'Ekki tókst að vista slóðina. Reyndu aftur.',
    },
  },
  notFound: {
    title: 'Síðan fannst ekki',
    back: 'Á forsíðu',
  },
} as const;

export const t: typeof is = is;
