import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, '..', '..', '..', 'supabase', 'config.toml');

type Section = Record<string, unknown>;
const config = parse(readFileSync(configPath, 'utf8')) as {
  api: Section;
  auth: Section & { email: Section; mfa: { totp: Section } };
};

describe('supabase/config.toml security settings', () => {
  it('[auth] enable_signup is false (self-registration off)', () => {
    expect(config.auth.enable_signup).toBe(false);
  });

  it('[auth.email] keeps the provider on and requires confirmations (decisions 17, 19)', () => {
    expect(config.auth.email.enable_signup).toBe(true);
    expect(config.auth.email.enable_confirmations).toBe(true);
  });

  it('[auth.email] double_confirm_changes is true (decision 19)', () => {
    expect(config.auth.email.double_confirm_changes).toBe(true);
  });

  it('[auth.mfa.totp] enroll_enabled and verify_enabled are true', () => {
    expect(config.auth.mfa.totp.enroll_enabled).toBe(true);
    expect(config.auth.mfa.totp.verify_enabled).toBe(true);
  });

  it('[api] schemas is non-empty (empty falls back to public) and exposes none of public, cms, private', () => {
    const schemas = config.api.schemas as string[];
    expect(Array.isArray(schemas)).toBe(true);
    expect(schemas.length).toBeGreaterThan(0);
    for (const forbidden of ['public', 'cms', 'private']) {
      expect(schemas).not.toContain(forbidden);
    }
  });
});
