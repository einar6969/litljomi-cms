import type { NextConfig } from 'next';
import { CMS_PAGES_SOURCE, STATIC_SECURITY_HEADERS } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // Workspace packages are TypeScript source; Next.js compiles them with the app.
  transpilePackages: ['@litljomi/cms-schema', '@litljomi/cms-sdk', '@litljomi/rich-text', '@litljomi/module-labak', '@litljomi/module-demo', '@litljomi/module-dld', '@litljomi/module-m4-probe'],
  // The Content-Security-Policy is per response, so it is sent by the proxy (src/proxy.ts).
  headers: async () => [{ source: CMS_PAGES_SOURCE, headers: STATIC_SECURITY_HEADERS }],
};

export default nextConfig;
