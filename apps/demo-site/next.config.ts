import type { NextConfig } from 'next';

// The only remote image host is the public media bucket's host (spec §7.3, step 4).
const mediaHost = process.env['CMS_MEDIA_HOST'];
if (!mediaHost) throw new Error('CMS_MEDIA_HOST is not set');

const config: NextConfig = {
  transpilePackages: ['@litljomi/cms-sdk', '@litljomi/rich-text'],
  images: { remotePatterns: [{ protocol: 'https', hostname: mediaHost }] },
};

export default config;
