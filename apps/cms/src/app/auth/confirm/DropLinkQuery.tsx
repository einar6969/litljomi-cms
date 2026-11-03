'use client';

import { useEffect } from 'react';

type Place = { location: Pick<Location, 'pathname' | 'search' | 'hash'>; history: Pick<History, 'state' | 'replaceState'> };

/**
 * Takes the link's query (the token hash, type and next path) out of the address bar and the
 * browser history, keeping the path (M3-14; Task 32 security r1). The form already holds the values,
 * so the button still works; a reload shows the page without them, and the link must be opened again.
 */
export function dropLinkQuery(place: Place): void {
  if (place.location.search === '') return;
  place.history.replaceState(place.history.state, '', place.location.pathname + place.location.hash);
}

/** Runs dropLinkQuery once the confirm page has loaded. Renders nothing. */
export function DropLinkQuery() {
  useEffect(() => dropLinkQuery(window), []);
  return null;
}
