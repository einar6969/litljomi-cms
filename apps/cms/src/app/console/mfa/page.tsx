import { notFound, redirect } from 'next/navigation';
import { requireUserId } from '@/lib/auth/session';
import { consoleAccess } from '@/lib/console-access';
import { createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';
import { Cloud } from '@/ui/Wordmark';
import { CodeForm } from './CodeForm';

function Mark() {
  return (
    <span className="wm">
      <Cloud />
      <span>Litljómi</span>
      <span className="wm-tag">console</span>
    </span>
  );
}

/**
 * A new TOTP factor, after removing whatever an abandoned attempt left. Its QR and secret exist only
 * in this response: Auth never returns them again, and nothing here stores or logs them.
 */
async function enrol(client: SupabaseClient, leftovers: Array<{ id: string }>) {
  for (const { id } of leftovers) {
    const { error } = await client.auth.mfa.unenroll({ factorId: id });
    if (error) throw new Error(`mfa unenroll: ${error.code}`);
  }
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Console' });
  if (error) throw new Error(`mfa enroll: ${error.code}`);
  return data.totp;
}

// The way from `aal1` to `aal2` (§4.4): a verified factor is only challenged, never joined by a
// second one; without one, the admin enrols. This page renders in parallel with the console layout,
// so it checks access itself: nobody but a platform admin at `aal1` reaches the enrolment.
export default async function ConsoleMfaPage() {
  const client = await createEditorClient();
  await requireUserId(client);
  const access = await consoleAccess();
  if (access === 'none') notFound();
  if (access === 'ok') redirect('/console');

  const { data: factors, error } = await client.auth.mfa.listFactors();
  if (error) throw new Error(`mfa factors: ${error.code}`);

  if (factors.totp.length > 0) {
    return (
      <main className="mfa">
        <div className="card mfa-c">
          <Mark />
          <div className="flex flex-col gap-1.5">
            <h1>Enter your code</h1>
            <p className="text-muted">Open your authenticator app and enter the six-digit code it shows.</p>
          </div>
          <CodeForm />
        </div>
      </main>
    );
  }

  const leftovers = factors.all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified');
  const { qr_code: qrCode, secret } = await enrol(client, leftovers);
  return (
    <main className="mfa">
      <div className="card mfa-c">
        <Mark />
        <div className="flex flex-col gap-1.5">
          <h1>Set up your authenticator</h1>
          <p className="text-muted">Scan this QR code with your authenticator app, then enter the six-digit code it shows.</p>
        </div>
        {/* The QR is a data URI from Auth, so there is nothing for next/image to optimise. */}
        <img src={qrCode} alt="QR code for your authenticator app" width={200} height={200} className="rounded-md bg-white" />
        <div className="flex flex-col gap-1">
          <p className="text-sm">Can&apos;t scan it? Enter this code in the app instead:</p>
          <code className="mono break-all">{secret}</code>
        </div>
        <CodeForm />
      </div>
    </main>
  );
}
