// The platform_admin persona's steps for apps/cms/e2e/console.spec.ts, on the LOCAL stack only
// (env.ts refuses any host that is not loopback). They need the secret key, which the browser tests
// never hold, so the spec starts this file with `node`. Each step prints one line of JSON and no
// secret:
//   reset             removes the persona's MFA factors and sessions, so a rerun enrols from nothing;
//   factors           counts its verified and unverified factors;
//   password-sign-in  gives it a random password, tries it on Auth and reports the answer.
import { randomBytes } from 'node:crypto';
import { adminAuth, auth } from '../src/auth-api.ts';
import { PERSONAS } from '../src/fixtures.ts';
import { closeAll, ownerQuery } from '../src/sql.ts';

const { id, email } = PERSONAS.platform_admin;

type Factor = { id: string; status: string };

async function listFactors(): Promise<Factor[]> {
  const user = await adminAuth(`/admin/users/${id}`, { method: 'GET' });
  if (user.status !== 200) throw new Error(`reading the admin answered ${user.status}`);
  return (user.json.factors ?? []) as Factor[];
}

const steps: Record<string, () => Promise<unknown>> = {
  async reset() {
    for (const factor of await listFactors()) {
      const removed = await adminAuth(`/admin/users/${id}/factors/${factor.id}`, { method: 'DELETE' });
      if (removed.status !== 200) throw new Error(`removing a factor answered ${removed.status}`);
    }
    await ownerQuery('delete from auth.sessions where user_id = $1', [id]);
    return { reset: true };
  },

  async factors() {
    const factors = await listFactors();
    const verified = factors.filter((factor) => factor.status === 'verified').length;
    return { verified, unverified: factors.length - verified };
  },

  async 'password-sign-in'() {
    const password = randomBytes(24).toString('hex');
    const set = await adminAuth(`/admin/users/${id}`, { method: 'PUT', body: { password } });
    if (set.status !== 200) throw new Error(`setting the password answered ${set.status}`);
    const attempt = await auth('/token?grant_type=password', { body: { email, password } });
    return { status: attempt.status, signedIn: typeof attempt.json.access_token === 'string' };
  },
};

try {
  const step = steps[process.argv[2] ?? ''];
  if (!step) throw new Error(`unknown step: ${process.argv[2]}`);
  console.log(JSON.stringify(await step()));
} catch (error) {
  console.error('console-admin failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeAll();
}
