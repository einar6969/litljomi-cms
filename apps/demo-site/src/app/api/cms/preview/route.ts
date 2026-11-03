import { draftMode } from 'next/headers';
import { createPreviewHandler, parsePreviewSecrets } from '@litljomi/cms-sdk';
import { env } from '../../../../lib/cms';

// The preview route (spec §7.5, plan M3-12): the editor's "Forskoða" lands here with a token. The
// SDK verifies it with the site's preview secret, then draft mode is enabled and the editor is
// sent to the entry's path, where the pages read the draft from the CMS preview endpoint.
export const dynamic = 'force-dynamic';

export const GET = createPreviewHandler({
  get tenant() {
    return env.CMS_TENANT;
  },
  secrets: () => parsePreviewSecrets(env.CMS_PREVIEW_SECRETS),
  enableDraftMode: async () => (await draftMode()).enable(),
});
