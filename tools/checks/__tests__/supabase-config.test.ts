import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, '..', '..', '..', 'supabase', 'config.toml');
const config: Record<string, unknown> = parse(readFileSync(configPath, 'utf8'));

/** Schemas the Data API must never expose (spec §4.2; `public` per decision 17). */
const NEVER_EXPOSED = ['public', 'cms', 'private'];

/** The value at a dotted path such as `auth.email.enable_signup`; throws if any part is missing. */
function setting(path: string): unknown {
  let node: unknown = config;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, key)) {
      throw new Error(`supabase/config.toml: missing ${path}`);
    }
    node = Reflect.get(node, key);
  }
  return node;
}

describe('supabase/config.toml security settings', () => {
  it.each([
    ['auth.enable_signup', false, 'self-registration off'],
    ['auth.email.enable_signup', true, 'email provider on (decision 17)'],
    ['auth.email.enable_confirmations', true, 'confirmations required (decision 19)'],
    ['auth.email.double_confirm_changes', true, 'both addresses confirm an email change (decision 19)'],
    ['auth.email.secure_password_change', true, 'decision 21'],
    ['auth.mfa.totp.enroll_enabled', true, 'TOTP enrolment'],
    ['auth.mfa.totp.verify_enabled', true, 'TOTP verification'],
    ['auth.hook.custom_access_token.enabled', true, 'passwordless hook on (decision 18)'],
    [
      'auth.hook.custom_access_token.uri',
      'pg-functions://postgres/private/passwordless_access_token',
      'passwordless hook function (decision 18)',
    ],
  ])('%s is %j (%s)', (path, expected, reason) => {
    expect(setting(path), `${path}: ${reason}`).toBe(expected);
  });

  it('[api] schemas is a non-empty list (empty falls back to public) that exposes none of public, cms, private', () => {
    const schemas = setting('api.schemas');
    expect(schemas, 'api.schemas must be a list').toBeInstanceOf(Array);
    expect(schemas).not.toHaveLength(0);
    for (const forbidden of NEVER_EXPOSED) {
      expect(schemas, `api.schemas must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('[api] schemas is exactly ["api"] (decision 16)', () => {
    expect(setting('api.schemas')).toEqual(['api']);
  });

  it('has no [remotes.*] block (config push would apply it to a hosted project)', () => {
    expect(Object.hasOwn(config, 'remotes'), 'supabase/config.toml must not contain [remotes.*]').toBe(false);
  });
});
