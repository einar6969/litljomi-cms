import Link from 'next/link';
import { t } from '@/i18n/is';

export default function NotFound() {
  return (
    <main>
      <h1>{t.notFound.title}</h1>
      <p>
        <Link href="/">{t.notFound.back}</Link>
      </p>
    </main>
  );
}
