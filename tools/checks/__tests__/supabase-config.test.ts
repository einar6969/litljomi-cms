import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const configPath = join(repoRoot, 'supabase', 'config.toml');
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

  // Local only (decision 37.4): magic links land on the local CMS (`next start -p 3100`), and the
  // e2e runs' sign-ins fit under the email limit. Hosted values are set by the Task 3 runbook.
  it.each([
    ['auth.site_url', 'http://localhost:3100'],
    ['auth.rate_limit.email_sent', 60],
  ])('%s is %j (local CMS, decision 37.4)', (path, expected) => {
    expect(setting(path)).toBe(expected);
  });

  it('auth.additional_redirect_urls is exactly the local CMS sign-in landing, /auth/confirm (decisions 37.4, 41.1)', () => {
    expect(setting('auth.additional_redirect_urls')).toEqual(['http://localhost:3100/auth/confirm']);
  });

  // Two tests on purpose: the exact-value test below fails on any change (adding a schema is a
  // reviewed decision), while this one names the security reason when the change exposes a schema
  // that must never be exposed or empties the list.
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

  // Spec §4.4: Icelandic, Litljómi-branded templates for the email flows v1 uses. The Supabase CLI
  // reads `content_path` from the project root (its own scaffold's form, `./supabase/templates/…`).
  // Magic links and invitations go to the CMS's own /auth/confirm page with the token hash, which
  // verifies it on the server only when the editor presses its button, so the link works in any
  // browser (decision 41.1); `{{ .SiteURL }}` is the Auth Site URL, the CMS host.
  const MAGIC_LINK = '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email';
  const INVITE_LINK = '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite';
  describe.each([
    ['magic_link', [MAGIC_LINK, '{{ .Token }}'], [MAGIC_LINK]],
    ['invite', [INVITE_LINK], [INVITE_LINK]],
    ['email_change', ['{{ .ConfirmationURL }}', '{{ .Email }}', '{{ .NewEmail }}'], ['{{ .ConfirmationURL }}']],
    ['reauthentication', ['{{ .Token }}'], []],
  ])('[auth.email.template.%s]', (name, variables, links) => {
    const contentPath = `./supabase/templates/${name}.html`;
    const file = join(repoRoot, contentPath);

    it('has an Icelandic subject and its template file', () => {
      expect(setting(`auth.email.template.${name}.content_path`)).toBe(contentPath);
      const subject = setting(`auth.email.template.${name}.subject`);
      expect(typeof subject === 'string' && subject.trim().length > 0, 'a subject').toBe(true);
      expect(existsSync(file), `${contentPath} exists`).toBe(true);
    });

    it('is Icelandic, Litljómi-branded, and uses the Auth variables it needs', () => {
      const html = readFileSync(file, 'utf8');
      expect(html).toContain('<html lang="is">');
      expect(html).toContain('Litljómi');
      for (const variable of variables) expect(html, `${name} uses ${variable}`).toContain(variable);
    });

    it('loads nothing external and has exactly its one link (no images, fonts or tracking)', () => {
      const html = readFileSync(file, 'utf8');
      expect(html).not.toMatch(/https?:\/\/|\/\/[a-z0-9]|<img|<link|<script|<iframe|@import|url\(|\bsrc\s*=|srcset|background\s*=/i);
      const hrefs = [...html.matchAll(/href\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
      expect(hrefs).toEqual(links);
    });
  });

  it('has no [remotes.*] block (config push would apply it to a hosted project)', () => {
    expect(Object.hasOwn(config, 'remotes'), 'supabase/config.toml must not contain [remotes.*]').toBe(false);
  });
});
