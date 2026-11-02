import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { t } from '@/i18n/is';

export const metadata: Metadata = { title: t.app.title };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="is">
      <body>{children}</body>
    </html>
  );
}
