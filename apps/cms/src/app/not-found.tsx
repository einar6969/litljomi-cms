import Link from 'next/link';
import { t } from '@/i18n/is';
import { buttonClasses } from '@/ui/Button';

export default function NotFound() {
  return (
    <main>
      <h1>{t.notFound.title}</h1>
      <p className="mt-6">
        <Link href="/" className={`${buttonClasses('secondary')} no-underline hover:bg-recessed`}>
          {t.notFound.back}
        </Link>
      </p>
    </main>
  );
}
