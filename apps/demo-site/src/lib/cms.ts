import { createCmsClient, type CmsClient } from '@litljomi/cms-sdk';

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
};

export function cms(): CmsClient {
  return createCmsClient({ deliveryBaseUrl: env.CMS_DELIVERY_BASE_URL, tenant: env.CMS_TENANT });
}
