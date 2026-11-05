import Link from 'next/link';
import { t } from '@/i18n/is';
import { linkButtonClasses } from '@/ui/Button';
import { Wordmark } from '@/ui/Wordmark';

export default function NotFound() {
  return (
    <div className="msg">
      <Wordmark />
      <main className="msg-b">
        <h1>{t.notFound.title}</h1>
        <Link href="/" className={linkButtonClasses('secondary')}>
          {t.notFound.back}
        </Link>
      </main>
    </div>
  );
}
