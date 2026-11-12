import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/**
 * True once the component is hydrated, false on the server and during hydration. The sign-in,
 * reset and set-password forms keep their submit button disabled until then: before hydration a
 * native submit would send the fields to the CMS instead of straight to Auth.
 */
export const useHydrated = (): boolean => useSyncExternalStore(noSubscription, () => true, () => false);
