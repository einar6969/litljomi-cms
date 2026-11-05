import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { t } from '@/i18n/is';
import './globals.css';

export const metadata: Metadata = { title: t.app.title };

// Every page is rendered per request, so each gets its response's nonce: a page built ahead of time
// would have none, and the Content-Security-Policy (src/proxy.ts) would block its inline scripts.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="is">
      <body>{children}</body>
    </html>
  );
}
