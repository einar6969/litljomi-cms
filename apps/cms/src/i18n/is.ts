// The editor's interface text, in Icelandic for every tenant in v1 (spec §3.2). Later tasks add keys.
export const is = {
  app: {
    title: 'Litljómi vefumsjón',
    signOut: 'Skrá út',
    help: 'Hjálp',
    helpEmail: 'hello@litljomi.is',
    breadcrumbs: 'Brauðmolar',
    menu: 'Valmynd',
    closeMenu: 'Loka valmynd',
  },
  login: {
    title: 'Innskráning',
    emailLabel: 'Netfang',
    passwordLabel: 'Lykilorð',
    submit: 'Skrá inn',
    // One neutral message for every failed sign-in but a rate limit: a wrong password, an unknown
    // address and a network error alike, so it never shows whether an account exists (spec §4.4).
    failed: 'Innskráning tókst ekki. Athugaðu netfang og lykilorð og reyndu aftur.',
    // Auth's per-address limit (spec §4.4).
    rateLimited: 'Of margar tilraunir í bili. Reyndu aftur eftir nokkrar mínútur.',
    // After a failed invitation, reset or email-change link. A reset serves an invitee too (PW-03).
    linkInvalid: 'Hlekkurinn er ógildur eða útrunninn. Veldu „Gleymt lykilorð?“ til að fá nýjan.',
    forgotLink: 'Gleymt lykilorð?',
    // After the first of an email change's two links (spec §4.4).
    emailChangeWaiting: 'Netfangið er staðfest. Breytingin tekur gildi þegar hitt netfangið hefur líka verið staðfest.',
    // The ink panel's line; the second part is set in the accent.
    panelLead: 'Þitt efni, ',
    panelRest: 'á þínum vef.',
  },
  // "Gleymt lykilorð?" (PW-03): the same confirmation whatever Auth answers, so it never shows
  // whether an account exists.
  forgot: {
    title: 'Gleymt lykilorð',
    intro: 'Sláðu inn netfangið þitt og við sendum þér hlekk til að velja nýtt lykilorð.',
    submit: 'Senda hlekk',
    sent: 'Ef netfangið er skráð færðu póst með hlekk innan skamms. Ef enginn póstur berst skaltu athuga netfangið og reyna aftur.',
    back: 'Til baka í innskráningu',
  },
  // The set-password page after an invitation or a reset link (PW-03). Auth's own minimum of 6 is
  // the only rule (spec §4.4).
  password: {
    title: 'Veldu lykilorð',
    account: 'Þú ert skráð/ur inn sem',
    intro: 'Veldu lykilorð til að halda áfram. Framvegis skráir þú þig inn með netfanginu og lykilorðinu.',
    label: 'Nýtt lykilorð',
    help: 'Að minnsta kosti 6 stafir.',
    submit: 'Vista lykilorð',
    tooShort: 'Lykilorðið þarf að vera að minnsta kosti 6 stafir.',
    same: 'Veldu annað lykilorð en það sem þú ert með núna.',
    // Auth's reauthentication refusal: the link's session is more than a day old.
    stale: 'Of langt er liðið frá því að hlekkurinn var opnaður. Biddu um nýjan með „Gleymt lykilorð?“.',
    failed: 'Ekki tókst að vista lykilorðið. Reyndu aftur.',
    // An account with a verified TOTP factor (a platform admin, §4.4) gives its code first: Auth
    // sets such an account's password only from an aal2 session. The console's code step in Icelandic.
    codeIntro: 'Aðgangurinn þinn er varinn með auðkenningarappi. Sláðu inn sex stafa kóðann sem appið sýnir áður en þú velur lykilorð.',
    codeLabel: 'Sex stafa kóði',
    codeSubmit: 'Staðfesta',
    codeRefused: 'Kóðinn virkaði ekki. Reyndu aftur.',
  },
  // The landing page of the invitation, reset and email-change links (decision 41.1): only its
  // button uses the link.
  confirm: {
    title: 'Ljúka innskráningu',
    intro: 'Smelltu á hnappinn til að skrá þig inn í Litljómi vefumsjón.',
    submit: 'Halda áfram',
    signedIn: 'Þú ert þegar skráð/ur inn',
    // M3-14: the question asked before a link replaces the visitor's session.
    signedInDetail: 'Áður en skipt er um aðgang sérðu hvaða aðgangi hlekkurinn tilheyrir.',
    replaceTitle: 'Skipta um aðgang?',
    replaceAccount: 'Þessi hlekkur skráir inn sem',
    replaceDetail: 'Ef þú skiptir verður þú skráð/ur út af aðganginum sem er innskráður núna.',
    replace: 'Skipta um aðgang',
    keep: 'Hætta við',
    emailChangeTitle: 'Staðfestu breytingu á netfangi',
    emailChangeIntro: 'Smelltu á hnappinn til að staðfesta breytinguna. Hún tekur gildi þegar bæði gamla og nýja netfangið hafa staðfest hana.',
  },
  tenants: {
    title: 'Vefirnir þínir',
    none: 'Þú hefur ekki aðgang að neinum vef.',
  },
  tenant: {
    inactive: 'Vefur óvirkur',
    inactiveBody: 'Ekki er hægt að breyta efni þessa vefs eins og er.',
    contentTypes: 'Efnisflokkar',
    navigation: 'Efni vefsins',
    greeting: 'Góðan daginn.',
  },
  // The tenant home's overview. `{n}` and `{d}` are numbers; which of the two words applies is
  // decided in editor/overview.ts (singular when n ends in 1 but not in 11).
  overview: {
    viewSite: 'Skoða vef',
    live: 'Í loftinu',
    viewChanges: 'Skoða breytingar',
    lastPublished: 'Síðast birt',
    recent: 'Nýlegar breytingar',
    pages: 'Síður',
    upToDate: 'Vefurinn þinn er uppfærður.',
    nothingPublished: 'Ekkert hefur verið birt enn.',
    nothingOnSite: 'Ekkert er á vefnum eins og er.',
    today: 'í dag',
    yesterday: 'í gær',
    waitingOne: '{n} breyting bíður birtingar.',
    waitingMany: '{n} breytingar bíða birtingar.',
    entriesOne: '{n} færsla',
    entriesMany: '{n} færslur',
    drafts: ', {d} uppkast',
  },
  singleton: {
    opening: 'Opna…',
    openFailed: 'Ekki tókst að opna færsluna. Reyndu aftur.',
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
    back: 'Til baka í lista',
    backHome: 'Til baka í efnisflokka',
    statuses: {
      draft: 'Uppkast',
      published: 'Birt',
      changed: 'Breytt eftir birtingu',
      archived: 'Í skjalasafni',
    },
    // M2-10: the list's title search and status filter.
    filter: {
      label: 'Leit og sía',
      search: 'Leita í titlum',
      status: 'Staða',
      all: 'Allar nema í skjalasafni',
      // Published once and then taken off the site; the same words as the publication badge.
      unpublished: 'Tekið af vef',
      submit: 'Sía',
      clear: 'Hreinsa síu',
      none: 'Engar færslur passa við leitina.',
    },
  },
  editor: {
    saving: 'Vistar…',
    saved: 'Vistað',
    notSaved: 'Ekki vistað',
    conflict: 'Annar notandi breytti færslunni',
    conflictBody: 'Breytingarnar þínar eru enn á skjánum en hafa ekki verið vistaðar. Berðu saman útgáfurnar og veldu hvora þú vilt halda.',
    reload: 'Hlaða aftur',
    // Conflict resolution (spec §5.5, M2-11).
    resolve: {
      loading: 'Sæki nýju útgáfuna…',
      loadError: 'Ekki tókst að sækja nýju útgáfuna. Breytingarnar þínar eru enn á skjánum.',
      changed: 'Reitir sem eru ólíkir',
      same: 'Allir reitir eru eins í báðum útgáfum.',
      theirs: 'Nýja útgáfan',
      mine: 'Þín útgáfa',
      reloadTheirs: 'Hlaða nýju útgáfunni',
      reloadTheirsHint: 'Breytingarnar þínar hverfa og nýja útgáfan birtist í forminu.',
      keepMine: 'Halda minni útgáfu',
      keepMineHint: 'Þín útgáfa er vistuð ofan á nýju útgáfuna og kemur í stað hennar í reitunum sem eru ólíkir.',
      empty: '(tómt)',
      yes: 'Já',
      no: 'Nei',
      image: 'Mynd',
      entry: 'Færsla',
      video: 'Myndband',
    },
    signedOut: 'Innskráningin er útrunnin',
    signedOutBody: 'Breytingarnar þínar eru geymdar í þessum flipa. Skráðu þig inn aftur í nýjum flipa; þær vistast sjálfkrafa þegar þú kemur aftur hingað.',
    signIn: 'Skrá inn',
    restoredCopy: 'Óvistaðar breytingar sóttar',
    restoredCopyBody: 'Þessi flipi geymdi breytingar sem höfðu ekki verið vistaðar og þær eru nú komnar í formið. Þær vistast ekki fyrr en þú velur að vista þær.',
    restoredCopySave: 'Vista breytingarnar',
    restoredCopyDiscard: 'Henda þeim og opna vistuðu útgáfuna',
    retry: 'Reyna aftur',
    error: 'Ekki tókst að vista. Breytingarnar þínar eru enn á skjánum.',
    unsupportedField: 'Þennan reit er ekki hægt að breyta hér ennþá. Gildi hans helst óbreytt.',
    entryLink: 'Tengill á aðra færslu. Honum er ekki breytt hér og hann helst óbreyttur.',
    invalidUrl: 'Ógild vefslóð (https://, http:// eða mailto:). Ekki vistað.',
    // M2-07: a stored value of the wrong type (written outside this form) is shown, never silently replaced.
    invalidStored: 'Vistaða gildið passar ekki við þennan reit. Veldu eða sláðu inn nýtt gildi.',
    // M2-07: the scalar kinds' inputs. `{min}`, `{max}`, `{value}` and `{zone}` are filled in by the field.
    number: {
      integer: 'Heil tala',
      decimal: 'Tala, aukastafir á eftir kommu',
      range: 'frá {min} til {max}',
      atLeast: 'minnst {min}',
      atMost: 'mest {max}',
      invalid: 'Ógild tala. Ekki vistað.',
    },
    boolean: {
      yes: 'Já',
      no: 'Nei',
      unset: 'Ekki tilgreint',
    },
    select: {
      placeholder: 'Veldu…',
      unknown: 'Gildið „{value}“ er ekki lengur í boði. Veldu annað.',
    },
    datetime: {
      help: 'Tími í tímabelti tölvunnar þinnar ({zone}).',
    },
    // M2-15: the list input. `{label}`, `{n}`, `{total}`, `{min}` and `{max}` are filled in by the field.
    list: {
      item: '{label} {n}',
      add: 'Bæta við',
      remove: 'Fjarlægja {item}',
      moveUp: 'Færa {item} upp',
      moveDown: 'Færa {item} niður',
      handle: 'Færa {item}: dragðu, eða notaðu örvalyklana upp og niður',
      moved: '{item} er nú í sæti {n} af {total}.',
      removed: '{item} var fjarlægt.',
      empty: 'Engin atriði enn.',
      range: 'Minnst {min} og mest {max} atriði.',
      atLeast: 'Minnst {min} atriði.',
      atMost: 'Mest {max} atriði.',
      // Media library L6, DRAFT: a list of images takes several files from the library at once.
      addFromLibrary: 'Bæta við úr safni',
      noRoom: 'Aðeins var pláss fyrir {n} í viðbót. Hinum var sleppt.',
    },
    outdated: {
      title: 'Uppkastið er á eldri útgáfu efnisflokksins',
      body: 'Efnisflokki þessarar færslu hefur verið breytt síðan uppkastið var vistað. Uppfærðu uppkastið til að geta breytt því og birt það. Efnið er fært á nýja sniðið; það sem er nú birt á vefnum breytist ekki.',
      update: 'Uppfæra uppkast',
      updating: 'Uppfærir…',
      failed: 'Ekki tókst að uppfæra uppkastið. Reyndu aftur.',
      cannotUpdate: 'Ekki er hægt að uppfæra þetta uppkast sjálfkrafa. Hafðu samband við kerfisstjóra.',
    },
    // Revision history and restore (spec §5.5, M2-16).
    history: {
      title: 'Fyrri birtingar',
      empty: 'Færslan hefur ekki verið birt.',
      publishedAt: 'Birt',
      byMe: 'af þér',
      byOther: 'af öðrum ritstjóra',
      current: 'Á vefnum núna',
      restore: 'Endurheimta',
      confirm: 'Efni þessarar birtingar kemur í stað uppkastsins. Það sem er á vefnum breytist ekki fyrr en þú birtir.',
      confirmRestore: 'Já, endurheimta',
      cancel: 'Hætta við',
      restoring: 'Endurheimtir…',
      unsaved: 'Bíddu þar til breytingarnar þínar hafa vistast og reyndu síðan aftur.',
      restored: 'Eldri birting var endurheimt í uppkastið. Birtu til að setja hana á vefinn.',
      failed: 'Ekki tókst að endurheimta. Reyndu aftur.',
      cannot: 'Ekki er hægt að endurheimta þessa birtingu sjálfkrafa. Hafðu samband við kerfisstjóra.',
    },
    image: {
      // Media library L6, DRAFT: changes the approved "Velja mynd", so the two buttons read apart.
      choose: 'Hlaða upp mynd',
      // Media library L6, DRAFT.
      fromLibrary: 'Velja úr safni',
      replace: 'Skipta um mynd',
      remove: 'Fjarlægja mynd',
      uploading: 'Hleð upp mynd…',
      type: 'Aðeins er hægt að nota JPEG-, PNG- eða WebP-myndir.',
      size: 'Myndin má ekki vera stærri en 20 MB.',
      uploadError: 'Ekki tókst að hlaða myndinni upp. Reyndu aftur.',
      previewError: 'Ekki tókst að sýna myndina.',
      alt: 'Alt-texti (lýsing myndarinnar hér)',
      saveDefaultAlt: 'Nota sem sjálfgefinn alt-texta myndarinnar',
      defaultAltSaved: 'Sjálfgefinn alt-texti vistaður',
      focal: 'Smelltu á myndina til að velja þungamiðju',
      focalLabel: 'Þungamiðja myndarinnar',
      focalHelp: 'Smelltu á myndina eða færðu þungamiðjuna með örvatökkunum (með Shift í minni skrefum). Vefurinn sker myndina þannig að þungamiðjan sjáist.',
      focalAt: 'Þungamiðja: {x} % frá vinstri, {y} % ofan frá.',
      focalNone: 'Engin þungamiðja valin: myndin er skorin um miðjuna.',
      clearFocal: 'Fjarlægja þungamiðju',
      focalSaved: 'Þungamiðja vistuð',
      details: 'Upplýsingar um myndina (opnast í nýjum flipa)',
      updateError: 'Ekki tókst að vista. Reyndu aftur.',
    },
    // A11: the video input. `{provider}` and `{id}` are filled in by the field.
    video: {
      url: 'Slóð myndbandsins',
      help: 'Límdu inn slóð myndbands á YouTube eða Vimeo.',
      recognised: 'Myndband á {provider}: {id}',
      unknown: 'Þetta er ekki slóð myndbands á YouTube eða Vimeo.',
      title: 'Titill myndbandsins',
      still: 'Kyrrmynd',
      providers: {
        youtube: 'YouTube',
        vimeo: 'Vimeo',
      },
    },
    reference: {
      none: '— Engin færsla valin —',
      loading: 'Sæki færslur…',
      missing: 'Valin færsla finnst ekki (henni hefur verið eytt eða hún sett í skjalasafn)',
      loadError: 'Ekki tókst að sækja færslurnar.',
      truncated: 'Aðeins fyrstu 200 færslurnar eru sýndar.',
      notListed: 'Valin færsla (ekki meðal þeirra sem sýndar eru)',
      unpublished: 'Þessi færsla er ekki birt. Birta þarf hana áður en hægt er að birta færsluna sem vísar í hana.',
    },
    richText: {
      toolbar: 'Sniðmótun',
      bold: 'Feitletrað',
      italic: 'Skáletrað',
      heading2: 'Fyrirsögn',
      heading3: 'Millifyrirsögn',
      bulletList: 'Punktalisti',
      orderedList: 'Númeraður listi',
      blockquote: 'Tilvitnun',
      hardBreak: 'Línuskil',
      link: 'Tengill',
      linkUrl: 'Vefslóð',
      setLink: 'Setja tengil',
      removeLink: 'Fjarlægja tengil',
      invalid: 'Textinn inniheldur eitthvað sem ekki er hægt að vista. Síðasta gilda útgáfan er vistuð.',
      unreadable: 'Ekki er hægt að opna þennan texta hér. Gildi hans helst óbreytt.',
    },
    // Named when a publish finds no slug; nobody sets one by hand.
    slug: {
      label: 'Slóð',
    },
  },
  // Publication (spec §7.4; plan Task 25, decision 37.8). The labels are the spec's; no text may
  // promise removal from CDN, browser or search-engine caches ("Withdrawal and failure visibility").
  publish: {
    heading: 'Birting',
    publish: 'Birta',
    unpublish: 'Taka af vef',
    none: 'Ekki birt',
    inProgress: 'Í birtingu…',
    revalidated: 'Bíður eftir vefnum',
    live: 'Birt á vef ✓',
    removed: 'Tekið af vef',
    removedDetail: 'Færslan sést ekki lengur á þeim síðum vefsins sem voru athugaðar. Eldri afrit geta enn verið til um tíma í skyndiminni vafra, leitarvéla og annarra.',
    invalid: 'Ekki hægt að birta:',
    invalidGeneric: 'efnið stenst ekki kröfur efnisflokksins',
    invalidDetail: 'Lagaðu reitina og birtu aftur.',
    outdated: 'uppkastið er á eldri útgáfu efnisflokksins',
    outdatedDetail: 'Uppfærðu uppkastið og birtu síðan aftur.',
    missingImage: 'mynd sem fannst ekki',
    missingImageDetail: 'Myndin fannst ekki í myndasafninu. Hladdu henni upp aftur og birtu síðan.',
    superseded: 'Færslunni var breytt eftir að þú ýttir á Birta. Birtu aftur.',
    rejected: 'Ekki heimilt að birta',
    failed: 'Birting mistókst. Reyndu aftur síðar.',
    deliveryFailed: 'Birting á vef mistókst',
    deliveryFailedDetail: 'Kerfisstjóra hefur verið gert viðvart.',
    notConfirmed: 'Ekki staðfest á vef',
    notConfirmedDetail: 'Færslan var send á vefinn en ekki tókst að staðfesta að hún birtist þar.',
    // Thread E: the same, for an unpublish (the entry must be gone, not shown).
    notConfirmedUnpublishDetail: 'Beiðnin var send á vefinn en ekki tókst að staðfesta að færslan sé horfin þaðan.',
    // M3-03: "live not confirmed, retrying", while the sweep retries the live check.
    notConfirmedRetrying: 'Ekki enn staðfest á vef, reynt aftur…',
    notConfirmedRetryingDetail: 'Færslan var send á vefinn en hefur ekki enn sést þar. Kerfið reynir aftur sjálfkrafa.',
    // Approved by Einar 2026-11-04 (not a draft): the same, for an unpublish (the entry must leave the site).
    notConfirmedRetryingUnpublishDetail: 'Beiðnin var send á vefinn en færslan hefur ekki enn horfið þaðan. Kerfið reynir aftur sjálfkrafa.',
    noSite: 'Enginn vefur tengdur',
    requestFailed: 'Ekki tókst að senda beiðnina. Reyndu aftur.',
    // M5-01 (draft): a second unpublish from a stale panel, in the action's response only. It says nothing about what the site shows.
    notPublished: 'Ekkert var gert því færslan er ekki birt.',
    // M5-01 (draft): a publish that a newer unpublish cancelled. It says nothing about what the site shows.
    cancelled: 'Hætt var við birtinguna vegna beiðni um að taka færsluna af vef.',
    statusUnavailable: 'Ekki tókst að sækja stöðu birtingar.',
  },
  // M3-12: the editor's preview button and its failures.
  preview: {
    open: 'Forskoða',
    opening: 'Opnar forskoðun…',
    unsaved: 'Breytingar eru enn að vistast. Reyndu aftur eftir augnablik.',
    unavailable: 'Forskoðun er ekki í boði fyrir þennan vef.',
    failed: 'Ekki tókst að opna forskoðun. Reyndu aftur.',
  },
  asset: {
    title: 'Mynd',
    filename: 'Skráarheiti',
    // M2-19: `{width}` and `{height}` are the image's size in pixels.
    dimensions: '{width} × {height} px',
  },
  // Media library L4 (docs/plans/media-library.md section 10), DRAFT. `{n}`, `{u}`, `{width}`,
  // `{height}` and `{size}` are filled in by the code; which of a pair of words applies is decided
  // in editor/media/library-format.ts (singular when n ends in 1 but not in 11).
  library: {
    title: 'Myndasafn',
    filesOne: '{n} skrá',
    filesMany: '{n} skrár',
    unusedOne: '{u} ónotuð',
    unusedMany: '{u} ónotaðar',
    upload: 'Hlaða upp',
    search: 'Leita eftir heiti, alt-texta, myndatexta eða ljósmyndara…',
    sort: {
      // The sort menu's name, read by screen readers only. Not in the plan's list.
      label: 'Röðun',
      newest: 'Nýjast fyrst',
      oldest: 'Elst fyrst',
      name: 'Heiti A–Ö',
      largest: 'Stærst fyrst',
    },
    view: {
      grid: 'Sýna sem reiti',
      list: 'Sýna sem lista',
    },
    filter: {
      missingAlt: 'Vantar alt-texta',
      unused: 'Ónotaðar',
    },
    meta: '{width}×{height} · {size}',
    col: {
      file: 'Skrá',
      type: 'Tegund',
      size: 'Stærð',
      dimensions: 'Mál',
      uploaded: 'Hlaðið upp',
      usage: 'Notkun',
    },
    more: 'Sýna fleiri',
    // The list's last page reached PostgREST's row limit. Not in the plan's list.
    capped: 'Aðeins fyrstu {n} skrárnar eru sýndar. Leitaðu til að finna aðrar.',
    empty: 'Engar skrár enn.',
    emptyBody: 'Hladdu upp myndum til að nota þær í efni vefsins.',
    none: 'Engar skrár passa við leitina.',
    detail: {
      title: 'Upplýsingar um skrá',
      close: 'Loka',
      back: 'Til baka í safnið',
      alt: 'Alt-texti',
      altHelp: 'Lýsing á myndinni fyrir þá sem sjá hana ekki. Hún fylgir myndinni þegar hún er valin í efni. Þar sem myndin er þegar í notkun gildir textinn sem þar er skráður.',
      caption: 'Myndatexti',
      captionHelp: 'Birtist með myndinni þar sem vefurinn sýnir myndatexta.',
      credit: 'Ljósmyndari / heimild',
      creditHelp: 'Til dæmis nafn ljósmyndara. Birtist með myndinni þar sem vefurinn sýnir það.',
      save: 'Vista breytingar',
      saved: 'Breytingar vistaðar',
      // Only for a file used on the site, until a changed file goes live by itself (L8).
      nextPublish: 'Breytingar á myndatexta, ljósmyndara og þungamiðju birtast á vefnum næst þegar eitthvað er birt.',
      original: 'Opna upprunalegu skrána (í nýjum flipa)',
    },
    usage: {
      title: 'Notkun',
      none: 'Þessi skrá er hvergi í notkun.',
      live: 'Á vefnum',
      draft: 'Í uppkasti',
    },
  },
  // Media library L5: several files per upload, DRAFT. `{p}`, `{done}`, `{total}`, `{n}`, `{f}` and
  // `{max}` are filled in by the code.
  upload: {
    title: 'Hlaða upp skrám',
    drop: 'eða dragðu skrár hingað',
    waiting: 'Í bið',
    uploading: 'Hleð upp… {p} %',
    processing: 'Vinn úr skránni…',
    done: 'Lokið',
    failed: 'Ekki tókst að hlaða skránni upp.',
    remove: 'Fjarlægja af lista',
    progress: 'Búið að hlaða upp {done} af {total} skrám.',
    resultOne: '{n} skrá er komin í safnið.',
    resultMany: '{n} skrár eru komnar í safnið.',
    failedOne: 'Ekki tókst að hlaða upp {f} skrá.',
    failedMany: 'Ekki tókst að hlaða upp {f} skrám.',
    tooMany: 'Mest er hægt að hlaða upp {max} skrám í einu. Þeim sem voru umfram var sleppt.',
  },
  // Media library L6: the library picker in forms, DRAFT. `{n}` is filled in by the code; which of
  // a pair of words applies is decided in editor/media/picker-selection.ts.
  picker: {
    titleOne: 'Velja mynd úr safni',
    titleMany: 'Velja myndir úr safni',
    confirmOne: 'Velja mynd',
    confirmMany: 'Velja {n} myndir',
    selectedOne: '{n} mynd valin',
    selectedMany: '{n} myndir valdar',
    empty: 'Engar myndir í safninu enn. Hladdu upp mynd til að byrja.',
    // The picker's files failed to load. Not in the plan's list.
    loadError: 'Ekki tókst að sækja myndirnar. Reyndu aftur.',
  },
  notFound: {
    title: 'Síðan fannst ekki',
    back: 'Á forsíðu',
  },
  // M2-19: the page shown when a page fails to load, instead of the framework's English one.
  error: {
    title: 'Eitthvað fór úrskeiðis',
    body: 'Ekki tókst að sýna síðuna. Breytingar sem höfðu verið vistaðar eru óhultar. Reyndu aftur eftir augnablik.',
    retry: 'Reyna aftur',
  },
} as const;

export const t: typeof is = is;
