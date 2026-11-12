import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
    ['auth.email.secure_password_change', true, 'a password change needs a recent sign-in (decision 21, spec §4.4)'],
    ['auth.minimum_password_length', 6, "no password rules beyond Auth's minimum (spec §4.4, decision 72)"],
    ['auth.password_requirements', '', 'no character requirements (spec §4.4, decision 72)'],
    ['auth.email.otp_expiry', 3600, 'an emailed link is valid one hour (hosted: Email OTP Expiration, decision 43)'],
    [
      'auth.email.otp_length',
      10,
      "every emailed code, and every token-hash link built from one, is 10 digits, the longest Auth allows (spec §4.4, decision 72.3)",
    ],
    ['auth.mfa.totp.enroll_enabled', true, 'TOTP enrolment'],
    ['auth.mfa.totp.verify_enabled', true, 'TOTP verification'],
    ['auth.hook.custom_access_token.enabled', true, 'sign-in hook on (spec §4.4, PW-01)'],
    [
      'auth.hook.custom_access_token.uri',
      'pg-functions://postgres/private/sign_in_access_token',
      'sign-in hook function: password, otp, totp and refresh only (spec §4.4, PW-01)',
    ],
  ])('%s is %j (%s)', (path, expected, reason) => {
    expect(setting(path), `${path}: ${reason}`).toBe(expected);
  });

  // The leaked-password check stays off (spec §4.4, decision 72). The local Auth has no setting for
  // it in config.toml and leaves it off; any [auth] key that names it is a change to review.
  it('has no setting that turns on the leaked-password check', () => {
    expect(readFileSync(configPath, 'utf8')).not.toMatch(/^\s*[a-z_]*(hibp|leaked|pwned)[a-z_]*\s*=/im);
  });

  // The hook the URI names is the one the migrations create, and the one it replaced is dropped, so
  // a reset database has exactly the function Auth calls (spec §4.5 "Auth hook grant").
  it('the hook function is created by a migration, and the passwordless hook it replaced is dropped', () => {
    const dir = join(repoRoot, 'supabase', 'migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/create function private\.sign_in_access_token\(event jsonb\)/);
    expect(sql).toMatch(/grant execute on function private\.sign_in_access_token\(jsonb\) to supabase_auth_admin;/);
    expect(sql).toMatch(/drop function private\.passwordless_access_token\(jsonb\);/);
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
  // Invitations and both addresses' email-change links go to the CMS's own /auth/confirm page
  // with the token hash, which verifies it on the server only when the editor presses its button,
  // so the link works in any browser (decision 41.1) and a mail scanner opening it confirms nothing
  // (M5 finding 9); `{{ .SiteURL }}` is the Auth Site URL, the CMS host. The magic-link and sign-up
  // confirmation mails have no link at all: they name the CMS address in their text (decisions 72.1,
  // 72.3).
  const INVITE_LINK = '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite';
  const EMAIL_CHANGE_LINK = '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change';
  describe.each([
    ['magic_link', ['{{ .SiteURL }}'], []],
    ['confirmation', ['{{ .SiteURL }}'], []],
    ['invite', [INVITE_LINK], [INVITE_LINK]],
    ['email_change', [EMAIL_CHANGE_LINK, '{{ .Email }}', '{{ .NewEmail }}'], [EMAIL_CHANGE_LINK]],
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

  // `{{ .ConfirmationURL }}` is Auth's own GET /verify, which a mail scanner's open would use up.
  it.each(['magic_link', 'confirmation', 'invite', 'email_change'])('[auth.email.template.%s] has no link Auth consumes on GET', (name) => {
    expect(readFileSync(join(repoRoot, `supabase/templates/${name}.html`), 'utf8')).not.toContain('.ConfirmationURL');
  });

  // Decisions 72.1 and 72.3 (spec §4.4): Auth sends the magic-link mail for magic-link and code
  // sign-in requests, and the confirmation mail when anyone asks it to resend a pending invitee's
  // sign-up confirmation. Every link Auth verifies by token hash counts as `otp`, which the sign-in
  // hook allows, so these mails are what stop magic-link and code sign-in. An allowlist, not a list
  // of forbidden variables: Go templates reach every value in other ways too (`{{ . }}`,
  // `{{ index . "Token" }}`, `{{ printf "%s" .TokenHash }}`).
  const SIGNS_NO_ONE_IN = ['magic_link', 'confirmation'];
  const ALLOWED_ACTION = '{{ .SiteURL }}';

  /** Every template action in `html` other than exactly `{{ .SiteURL }}`, unterminated ones included. */
  function actionsBeyondSiteUrl(html: string): string[] {
    const rest = html.split(ALLOWED_ACTION).join('');
    return [...rest.matchAll(/\{\{(?:(?!\}\})[\s\S])*(?:\}\}|$)/g)].map((m) => m[0]);
  }

  it.each([
    ['{{ . }}'],
    ['{{ index . "Token" }}'],
    ['{{ .ConfirmationURL }}'],
    ['{{ .Token }}'],
    ['{{ .TokenHash }}'],
    ['{{.Token}}'],
    ['{{- .TokenHash -}}'],
    ['{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}'],
    ['{{ .SiteURL | printf "%s" }}'],
    ['{{ printf "%s" .TokenHash }}'],
    ['{{ with .Token }}x{{ end }}'],
    ['{{/* a comment */}}'],
    ['{{ .Token'],
  ])('the allowlist check rejects %s', (action) => {
    expect(actionsBeyondSiteUrl(`<p>Sign in at {{ .SiteURL }}. ${action}</p>`)).not.toEqual([]);
  });

  it('the allowlist check accepts text whose only actions are {{ .SiteURL }}', () => {
    expect(actionsBeyondSiteUrl('<p>{{ .SiteURL }} and again {{ .SiteURL }}; a lone } or { is text.</p>')).toEqual([]);
  });

  it.each(SIGNS_NO_ONE_IN)('[auth.email.template.%s] has no template action other than {{ .SiteURL }}', (name) => {
    const html = readFileSync(join(repoRoot, `supabase/templates/${name}.html`), 'utf8');
    expect(actionsBeyondSiteUrl(html), `${name}.html may use only ${ALLOWED_ACTION}`).toEqual([]);
  });

  // Decision 42.2 (Q3), kept by decisions 72.1 and 72.3: no one-time code in these mails.
  it.each(SIGNS_NO_ONE_IN)('[auth.email.template.%s] has no one-time code', (name) => {
    const html = readFileSync(join(repoRoot, `supabase/templates/${name}.html`), 'utf8');
    // "kóð" is the stem of kóði (code) in every form; a later wording that needs the word for
    // something else must narrow this check, not drop it.
    expect(html).not.toMatch(/kóð/i);
  });

  // Decision 72.3: the confirmation mail is the sign-in mail's twin, with its subject, heading and
  // the text Einar approved in decision 72.2.
  it.each(SIGNS_NO_ONE_IN)('[auth.email.template.%s] has the approved sign-in subject, heading and text (decision 72.2)', (name) => {
    expect(setting(`auth.email.template.${name}.subject`)).toBe('Innskráning í Litljómi vefumsjón');
    const html = readFileSync(join(repoRoot, `supabase/templates/${name}.html`), 'utf8');
    expect(html).toContain('<h1 style="margin:0 0 16px 0;font-size:20px;">Innskráning í Litljómi vefumsjón</h1>');
    expect(html).toContain('Innskráning í Litljómi vefumsjón er með netfangi og lykilorði á {{ .SiteURL }}.');
    expect(html).toContain('Ef þú baðst ekki um innskráningu geturðu hunsað þennan póst.');
  });

  it('has no [remotes.*] block (config push would apply it to a hosted project)', () => {
    expect(Object.hasOwn(config, 'remotes'), 'supabase/config.toml must not contain [remotes.*]').toBe(false);
  });
});
