import { cookies, draftMode } from 'next/headers';
import { createCmsClient, readPreviewToken, type CmsClient } from '@litljomi/cms-sdk';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Read on use, so a missing variable fails the request that needs it with a clear message. */
export const env = {
  get CMS_DELIVERY_BASE_URL() {
    return required('CMS_DELIVERY_BASE_URL');
  },
  get CMS_TENANT() {
    return required('CMS_TENANT');
  },
  get CMS_WEBHOOK_SECRETS() {
    return required('CMS_WEBHOOK_SECRETS');
  },
  /** The site's preview secrets (spec §7.5), comma-separated; only the preview route reads them. */
  get CMS_PREVIEW_SECRETS() {
    return required('CMS_PREVIEW_SECRETS');
  },
  /** The CMS's origin, for its preview endpoint; read only in draft mode. */
  get CMS_PREVIEW_BASE_URL() {
    return required('CMS_PREVIEW_BASE_URL');
  },
};

/** The published release only: for code that runs outside a request, such as generateStaticParams. */
export function publishedCms(): CmsClient {
  return createCmsClient({ deliveryBaseUrl: env.CMS_DELIVERY_BASE_URL, tenant: env.CMS_TENANT });
}

/**
 * The published release, or in draft mode (after the preview route accepted a token) the CMS
 * preview endpoint's content with the editor's draft (spec §7.5). Outside draft mode no cookie is
 * read, so pages stay static.
 */
export function cms(): CmsClient {
  return createCmsClient({
    deliveryBaseUrl: env.CMS_DELIVERY_BASE_URL,
    tenant: env.CMS_TENANT,
    preview: {
      get cmsBaseUrl() {
        return env.CMS_PREVIEW_BASE_URL;
      },
      token: () => readPreviewToken({ draftMode, cookies }),
    },
  });
}
