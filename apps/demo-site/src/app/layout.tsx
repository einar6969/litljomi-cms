import type { ReactNode } from 'react';
import { CmsReleaseMarker } from '@litljomi/cms-sdk';
import { cms } from '../lib/cms';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { release } = await cms().getBundle();
  return (
    <html lang="is">
      <head>
        <CmsReleaseMarker release={release} />
      </head>
      <body>{children}</body>
    </html>
  );
}
