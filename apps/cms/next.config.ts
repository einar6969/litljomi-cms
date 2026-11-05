import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages are TypeScript source; Next.js compiles them with the app.
  transpilePackages: ['@litljomi/cms-schema', '@litljomi/cms-sdk', '@litljomi/rich-text', '@litljomi/module-labak', '@litljomi/module-demo', '@litljomi/module-m4-probe'],
};

export default nextConfig;
