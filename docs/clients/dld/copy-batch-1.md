# Copy batch 1: editor-facing strings new or changed since production

Every string below is DRAFT until Einar approves it. Strings are quoted exactly as in apps/cms/src/i18n/is.ts and are never corrected in the tables.
Built from origin/production `b8c702c` against origin/main `8676235` merged with #73 `7bff99a`, #82 `922ef79` (carries L2 and L4+L5), #76 `4ff5d03`, #79 `474dc48`, #77 `78b7ccb`, #80 `411ef5d` (#76 and #80 add no strings). Compared key by key: 114 new, 1 changed, 5 removed.

## Changes to strings already approved

| Key | Old text | New text | Where |
|---|---|---|---|
| `editor.image.choose` | Velja mynd | Hlaða upp mynd | Entry editor, image field: the button that opens the file dialog, now sitting beside the new "Velja úr safni" button (#82). The old words "Velja mynd" return as `picker.confirmOne` (a new key, in the image picker's confirm button). |

## Strings that need a decision

Suggestions are marked as such; none is in the code.

### `picker.confirmMany`

- Text: Velja {n} myndir
- Why: Used for every count except 1, so 21, 31 and 41 give "Velja 21 myndir", where Icelandic takes the singular after a number ending in 1 (not 11): "21 mynd". The sibling strings picker.selectedOne/Many already apply that rule; this one does not.
- Suggestion A: "Velja {n} mynd" for counts ending in 1 (not 11), "Velja {n} myndir" otherwise (same rule as selectedLine). Suggestion B, one string for every count: "Velja valdar myndir ({n})".

### `upload.progress`

- Text: Búið að hlaða upp {done} af {total} skrám.
- Why: "af" takes the dative and the noun agrees with {total}, but the string fixes the plural: "af 1 skrám" and "af 21 skrám" are wrong (should be "skrá").
- Suggestion A, number-neutral: "Búið að hlaða upp {done} af {total}." Suggestion B: "Skrár komnar: {done} af {total}."

### `editor.list.noRoom`

- Text: Aðeins var pláss fyrir {n} í viðbót. Hinum var sleppt.
- Why: The number has no noun, and "Hinum" (plural dative) fits neither one skipped item nor a mixed count; with {n} = 1 it reads "pláss fyrir 1 í viðbót".
- Suggestion A, no count: "Listinn er orðinn fullur. Hluta valinna mynda var ekki bætt við." Suggestion B: "Ekki var pláss fyrir allar valdar myndir. Aðeins fyrstu {n} bættust við." (still a number, but the noun is plural by design, so it only misreads at 1).

## New strings

The nine `editor.resolve.video` and `editor.video.*` keys are already on origin/main but not in production.

### Entry list, manual ordering (#77)

| Key | Text | Where |
|---|---|---|
| `entries.order.column` | Röð | Entry list for an ordered type: column header of the drag handle (#77) |
| `entries.order.help` | Færslurnar birtast á vefnum í þessari röð. Dragðu færslu á nýjan stað eða notaðu örvarnar. Ný röð birtist á vefnum næst þegar færsla er birt. | Entry list for an ordered type: help line above the table (#77) |
| `entries.order.filtered` | Aðeins færslur sem passa við leitina eru sýndar. Hinar halda sínum stað. | Entry list for an ordered type: appended to the help line while a search or filter is active (#77) |
| `entries.order.handle` | Færa „{title}“: dragðu, eða notaðu örvalyklana upp og niður | Entry list for an ordered type: label of the drag handle on each row, read by screen readers (#77) |
| `entries.order.moveUp` | Færa „{title}“ upp | Entry list for an ordered type: up-arrow button on each row, label for screen readers (#77) |
| `entries.order.moveDown` | Færa „{title}“ niður | Entry list for an ordered type: down-arrow button on each row, label for screen readers (#77) |
| `entries.order.saving` | Vistar röðina… | Entry list for an ordered type: status line under the table while the order saves (#77) |
| `entries.order.moved` | „{title}“ er nú í sæti {n} af {total}. | Entry list for an ordered type: status line after a move (#77) |
| `entries.order.failed` | Ekki tókst að færa færsluna. Röðin er óbreytt. Reyndu aftur. | Entry list for an ordered type: error line when a move fails (#77) |

### Entry editor, fields (video, images, lists, pasted text)

| Key | Text | Where |
|---|---|---|
| `editor.resolve.video` | Myndband | Entry editor, conflict screen: name of a video field when two versions differ (on main already) |
| `editor.list.addFromLibrary` | Bæta við úr safni | Entry editor, repeating list of images: button next to the add button (#82) |
| `editor.list.noRoom` | Aðeins var pláss fyrir {n} í viðbót. Hinum var sleppt. | Entry editor, repeating list: notice after picking from Myndasafn when the list is full (#82) |
| `editor.image.fromLibrary` | Velja úr safni | Entry editor, image field: button beside the upload button (#82) |
| `editor.video.url` | Slóð myndbandsins | Entry editor, video field: label of the address input (on main already) |
| `editor.video.help` | Límdu inn slóð myndbands á YouTube eða Vimeo. | Entry editor, video field: help under the address input (on main already) |
| `editor.video.recognised` | Myndband á {provider}: {id} | Entry editor, video field: line under the address once it is recognised (on main already) |
| `editor.video.unknown` | Þetta er ekki slóð myndbands á YouTube eða Vimeo. | Entry editor, video field: error under the address input (on main already) |
| `editor.video.title` | Titill myndbandsins | Entry editor, video field: label of the title input (on main already) |
| `editor.video.still` | Kyrrmynd | Entry editor, video field: label of the still-image picker (on main already) |
| `editor.video.providers.youtube` | YouTube | Entry editor, video field: provider name inside the recognised line (on main already) |
| `editor.video.providers.vimeo` | Vimeo | Entry editor, video field: provider name inside the recognised line (on main already) |
| `editor.richText.droppedImages` | Myndum var sleppt úr textanum sem var límdur inn. | Entry editor, text field: notice after pasting text that contained images (#73) |
| `editor.richText.droppedTables` | Töflum var sleppt úr textanum sem var límdur inn; texti þeirra kom inn sem málsgreinar. | Entry editor, text field: notice after pasting text that contained tables (#73) |
| `editor.richText.droppedBoth` | Myndum og töflum var sleppt úr textanum sem var límdur inn; texti taflnanna kom inn sem málsgreinar. | Entry editor, text field: notice after pasting text that contained images and tables (#73) |

### Entry editor, Skjalasafn (#73)

| Key | Text | Where |
|---|---|---|
| `editor.archive.title` | Skjalasafn | Entry editor, bottom section: heading (#73) |
| `editor.archive.hint` | Færsla sem er ekki birt má setja í skjalasafn. Hún hverfur þá úr listanum. | Entry editor, Skjalasafn section: help text (#73) |
| `editor.archive.button` | Setja í skjalasafn | Entry editor, Skjalasafn section: button (#73) |
| `editor.archive.confirm` | Viltu setja færsluna í skjalasafn? Hún hverfur úr listanum og ekki er hægt að sækja hana aftur hér. | Entry editor, Skjalasafn section: confirmation question (#73) |
| `editor.archive.confirmButton` | Já, setja í skjalasafn | Entry editor, Skjalasafn section: confirm button (#73) |
| `editor.archive.cancel` | Hætta við | Entry editor, Skjalasafn section: cancel button (#73) |
| `editor.archive.archiving` | Set í skjalasafn… | Entry editor, Skjalasafn section: confirm button while working (#73) |
| `editor.archive.published` | Færslan er birt. Taktu hana af vef áður en hún er sett í skjalasafn. | Entry editor, Skjalasafn section: message when the entry is still published (#73) |
| `editor.archive.failed` | Ekki tókst að setja færsluna í skjalasafn. Reyndu aftur. | Entry editor, Skjalasafn section: error message (#73) |

### Entry editor, publish panel (#73, #79)

| Key | Text | Where |
|---|---|---|
| `publish.liveNothingChecked` | Birt, ekki staðfest á vef | Entry editor, publish panel: status label after publishing a type with no page to check (#79) |
| `publish.liveNothingCheckedDetail` | Vefurinn tók við breytingunni, en engin síða vefsins er athuguð fyrir þessa tegund efnis. Því er ekki hægt að staðfesta að færslan sjáist þar. | Entry editor, publish panel: detail under that status (#79) |
| `publish.removedNothingChecked` | Tekið úr birtingu, ekki staðfest á vef | Entry editor, publish panel: status label after unpublishing such a type (#79) |
| `publish.removedNothingCheckedDetail` | Vefurinn tók við breytingunni, en engin síða vefsins er athuguð fyrir þessa tegund efnis. Því er ekki hægt að staðfesta að færslan sé horfin þaðan. | Entry editor, publish panel: detail under that status (#79) |
| `publish.loading` | Sæki stöðu… | Entry editor, publish panel: status label while the status loads (#73) |
| `publish.changed` | Óbirtar breytingar | Entry editor, publish panel: status label when a published entry has unpublished edits (#73) |
| `publish.changedDetail` | Á vefnum er síðasta birta útgáfan. Birtu til að setja breytingarnar þangað. | Entry editor, publish panel: detail under that status (#73) |
| `publish.reference.line` | {field}: {target} {reason} | Entry editor, publish panel: one line per refused reference, built from field, target and reason (#73) |
| `publish.reference.unpublished` | er ekki birt. | Entry editor, publish panel: reason at the end of a reference line (#73) |
| `publish.reference.archived` | er í skjalasafni. | Entry editor, publish panel: reason at the end of a reference line (#73) |
| `publish.reference.notFound` | finnst ekki. | Entry editor, publish panel: reason at the end of a reference line (#73) |
| `publish.reference.unknownEntry` | færslan sem vísað er í | Entry editor, publish panel: target of a reference line when the entry is unknown (#73) |
| `publish.reference.image` | myndin sem vísað er í | Entry editor, publish panel: target of a reference line for an image (#73) |
| `publish.reference.detail` | Birtu fyrst færslurnar sem vísað er í, eða veldu aðrar, og birtu síðan aftur. | Entry editor, publish panel: advice under the reference lines (#73) |

### Myndasafn (#82)

| Key | Text | Where |
|---|---|---|
| `library.title` | Myndasafn | Myndasafn: page heading and breadcrumb (#82) |
| `library.filesOne` | {n} skrá | Myndasafn: file count next to the heading, singular (#82) |
| `library.filesMany` | {n} skrár | Myndasafn: file count next to the heading, plural (#82) |
| `library.unusedOne` | {u} ónotuð | Myndasafn: unused count next to the file count, singular (#82) |
| `library.unusedMany` | {u} ónotaðar | Myndasafn: unused count next to the file count, plural (#82) |
| `library.upload` | Hlaða upp | Myndasafn: upload button above the grid; also in the picker (#82) |
| `library.search` | Leita eftir heiti, alt-texta, myndatexta eða ljósmyndara… | Myndasafn: placeholder and label of the search box; also in the picker (#82) |
| `library.sort.label` | Röðun | Myndasafn: label of the sort menu (#82) |
| `library.sort.newest` | Nýjast fyrst | Myndasafn: sort menu option (#82) |
| `library.sort.oldest` | Elst fyrst | Myndasafn: sort menu option (#82) |
| `library.sort.name` | Heiti A–Ö | Myndasafn: sort menu option (#82) |
| `library.sort.largest` | Stærst fyrst | Myndasafn: sort menu option (#82) |
| `library.view.grid` | Sýna sem reiti | Myndasafn: icon button, label for screen readers (#82) |
| `library.view.list` | Sýna sem lista | Myndasafn: icon button, label for screen readers (#82) |
| `library.filter.missingAlt` | Vantar alt-texta | Myndasafn: filter chip above the grid (#82) |
| `library.filter.unused` | Ónotaðar | Myndasafn: filter chip above the grid (#82) |
| `library.meta` | {width}×{height} · {size} | Myndasafn: size line under each tile (#82) |
| `library.col.file` | Skrá | Myndasafn, list view: column header (#82) |
| `library.col.type` | Tegund | Myndasafn, list view column header; file details panel (#82) |
| `library.col.size` | Stærð | Myndasafn, list view column header; file details panel (#82) |
| `library.col.dimensions` | Mál | Myndasafn, list view column header; file details panel (#82) |
| `library.col.uploaded` | Hlaðið upp | Myndasafn, list view column header; file details panel (#82) |
| `library.col.usage` | Notkun | Myndasafn, list view: column header (#82) |
| `library.more` | Sýna fleiri | Myndasafn and picker: button below the grid (#82) |
| `library.capped` | Aðeins fyrstu {n} skrárnar eru sýndar. Leitaðu til að finna aðrar. | Myndasafn: notice below the grid when the page limit is reached (#82) |
| `library.empty` | Engar skrár enn. | Myndasafn: bold line when the library is empty (#82) |
| `library.emptyBody` | Hladdu upp myndum til að nota þær í efni vefsins. | Myndasafn: text after the bold line when empty (#82) |
| `library.none` | Engar skrár passa við leitina. | Myndasafn and picker: text when a search matches nothing (#82) |
| `library.detail.title` | Upplýsingar um skrá | File details panel: heading (#82) |
| `library.detail.close` | Loka | File details panel and picker: close icon, label for screen readers (#82) |
| `library.detail.back` | Til baka í safnið | File details page: link back to the library (#82) |
| `library.detail.alt` | Alt-texti | File details panel: label of the alt-text field (#82) |
| `library.detail.altHelp` | Lýsing á myndinni fyrir þá sem sjá hana ekki. Hún fylgir myndinni þegar hún er valin í efni. Þar sem myndin er þegar í notkun gildir textinn sem þar er skráður. | File details panel: help under the alt-text field (#82) |
| `library.detail.caption` | Myndatexti | File details panel: label of the caption field (#82) |
| `library.detail.captionHelp` | Birtist með myndinni þar sem vefurinn sýnir myndatexta. | File details panel: help under the caption field (#82) |
| `library.detail.credit` | Ljósmyndari / heimild | File details panel: label of the photographer field (#82) |
| `library.detail.creditHelp` | Til dæmis nafn ljósmyndara. Birtist með myndinni þar sem vefurinn sýnir það. | File details panel: help under the photographer field (#82) |
| `library.detail.save` | Vista breytingar | File details panel: save button (#82) |
| `library.detail.saved` | Breytingar vistaðar | File details panel: confirmation after saving (#82) |
| `library.detail.nextPublish` | Breytingar á myndatexta, ljósmyndara og þungamiðju birtast á vefnum næst þegar eitthvað er birt. | File details panel: notice for a file that is live (#82) |
| `library.detail.original` | Opna upprunalegu skrána (í nýjum flipa) | File details panel: link to the original file (#82) |
| `library.usage.title` | Notkun | File details panel: heading of the usage list, with the count (#82) |
| `library.usage.none` | Þessi skrá er hvergi í notkun. | File details panel: text when the file is not used (#82) |
| `library.usage.live` | Á vefnum | File details panel and library list: badge on a use that is on the site (#82) |
| `library.usage.draft` | Í uppkasti | File details panel and library list: badge on a use that is only in a draft (#82) |

### Upload dialog (#82)

| Key | Text | Where |
|---|---|---|
| `upload.title` | Hlaða upp skrám | Myndasafn upload dialog: heading and open-button label (#82) |
| `upload.drop` | eða dragðu skrár hingað | Myndasafn, next to the upload button: drop hint (#82) |
| `upload.waiting` | Í bið | Upload dialog: status of a queued file (#82) |
| `upload.uploading` | Hleð upp… {p} % | Upload dialog: status of a file being sent (#82) |
| `upload.processing` | Vinn úr skránni… | Upload dialog: status of a file being processed (#82) |
| `upload.done` | Lokið | Upload dialog: status of a finished file (#82) |
| `upload.failed` | Ekki tókst að hlaða skránni upp. | Upload dialog: reason shown on a failed file (#82) |
| `upload.remove` | Fjarlægja af lista | Upload dialog: button on each row (#82) |
| `upload.progress` | Búið að hlaða upp {done} af {total} skrám. | Upload dialog: progress line (#82) |
| `upload.resultOne` | {n} skrá er komin í safnið. | Upload dialog: result line, singular (#82) |
| `upload.resultMany` | {n} skrár eru komnar í safnið. | Upload dialog: result line, plural (#82) |
| `upload.failedOne` | Ekki tókst að hlaða upp {f} skrá. | Upload dialog: failure line, singular (#82) |
| `upload.failedMany` | Ekki tókst að hlaða upp {f} skrám. | Upload dialog: failure line, plural (#82) |
| `upload.tooMany` | Mest er hægt að hlaða upp {max} skrám í einu. Þeim sem voru umfram var sleppt. | Upload dialog: warning when too many files were dropped (#82) |

### Image picker (#82)

| Key | Text | Where |
|---|---|---|
| `picker.titleOne` | Velja mynd úr safni | Image picker (Velja úr safni): dialog heading when one image is chosen (#82) |
| `picker.titleMany` | Velja myndir úr safni | Image picker: dialog heading when several images can be chosen (#82) |
| `picker.confirmOne` | Velja mynd | Image picker: confirm button for one image (#82) |
| `picker.confirmMany` | Velja {n} myndir | Image picker: confirm button for several images (#82) |
| `picker.selectedOne` | {n} mynd valin | Image picker: count of chosen images, singular (#82) |
| `picker.selectedMany` | {n} myndir valdar | Image picker: count of chosen images, plural (#82) |
| `picker.empty` | Engar myndir í safninu enn. Hladdu upp mynd til að byrja. | Image picker: text when the library is empty (#82) |
| `picker.loadError` | Ekki tókst að sækja myndirnar. Reyndu aftur. | Image picker: error when the images cannot be loaded (#82) |

## Removed

All five go in #82, where the old file page is replaced by the library's details panel.

| Key | Old text |
|---|---|
| `asset.back` | Á forsíðu vefsins |
| `asset.size` | Stærð |
| `asset.defaultAlt` | Sjálfgefinn alt-texti |
| `asset.defaultAltHelp` | Lýsing sem á við myndina almennt. Á vefnum gildir alt-texti hvers staðar sem myndin er notuð. |
| `asset.saveDefaultAlt` | Vista sjálfgefinn alt-texta |
