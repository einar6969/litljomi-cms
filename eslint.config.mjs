import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const CODE = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

const PRIVILEGED_MESSAGE = 'The admin client may only be imported under apps/cms/src/privileged/**.';
const PIPELINE_ONLY_MESSAGE =
  'The worker and cron routes may import only privileged/worker/pipeline and privileged/internal-auth from privileged/.';
const MODULE_MESSAGE = 'Modules are imported only by apps/cms/src/modules/registry.ts.';
const APPS_MESSAGE = 'packages and modules must not import from apps.';
const SECRET_MESSAGE = 'SUPABASE_SECRET_KEY may only be read under apps/cms/src/privileged/** and tools/cli.';

// A path separator in an import specifier: `/`, or `\`, which Node and TypeScript also resolve (N1).
const SEP = '[/\\\\]';
const NOT_SEP = '[^/\\\\]';

// Each entry is a path regex (source string) with its message, and feeds both the static
// `no-restricted-imports` patterns and the dynamic `import()` / `require()` selectors.
const privilegedPaths = [{ regex: `(^#?|${SEP})privileged(${SEP}|$)`, message: PRIVILEGED_MESSAGE }];
// Decision 35: the worker and cron route handlers may import their job from
// `privileged/worker/pipeline` and their secret check from `privileged/internal-auth` (optionally
// `.ts`), written with `/` and as the last segments; a backslash after `privileged` is always
// forbidden. Anything else under privileged/ (the admin client above all), including a path that
// continues after either, is still forbidden.
const privilegedExceptPipelinePaths = [
  { regex: `(^#?|${SEP})privileged($|\\\\|/(?!(worker/pipeline|internal-auth)(\\.ts)?$))`, message: PIPELINE_ONLY_MESSAGE },
];
// M3-10 (spec §7.5): the preview token route handler may import only its entry,
// `privileged/preview/token-route`, under the same rules.
const PREVIEW_TOKEN_ONLY_MESSAGE = 'The preview token route may import only privileged/preview/token-route from privileged/.';
const privilegedExceptPreviewTokenPaths = [
  { regex: `(^#?|${SEP})privileged($|\\\\|/(?!preview/token-route(\\.ts)?$))`, message: PREVIEW_TOKEN_ONLY_MESSAGE },
];
// Alias forms covered: `@/`, `~/`, `#` (subpath imports), relative and bare specifiers.
// The registry is exempt only when `registry` (optionally with an extension) is the last segment,
// so `registry.x/../labak`, `registry/..` or any `..` after `modules/` is still forbidden.
const modulePaths = [
  { regex: '^@litljomi/module-', message: MODULE_MESSAGE },
  { regex: `^(([@~]|\\.{1,2})${SEP}(.*${SEP})?|#)?modules${SEP}(?!registry(\\.${NOT_SEP}*)?$)`, message: MODULE_MESSAGE },
];
// Only the CMS app may import the Tiptap editor entry (decision 23). A deep path is matched by its
// `rich-text` and last `tiptap` segments, so `./` or `..` segments between them do not hide it.
const EDITOR_MESSAGE = 'The rich-text editor entry (@litljomi/rich-text/editor) may only be imported by apps/cms.';
const editorPaths = [
  {
    regex: `^@litljomi/rich-text${SEP}(\\.${SEP})*editor(${SEP}|$)|(^|${SEP})rich-text${SEP}(.*${SEP})?tiptap(\\.${NOT_SEP}*)?$`,
    message: EDITOR_MESSAGE,
  },
];
// Only the editor entry loads Tiptap and ProseMirror (Task 14 review), so sites never do.
const TIPTAP_MESSAGE = 'Tiptap and ProseMirror may only be imported by packages/rich-text/src/tiptap.ts (and apps/cms).';
const tiptapPaths = [{ regex: `^@tiptap(${SEP}|$)|^prosemirror-`, message: TIPTAP_MESSAGE }];
// Spec §3.1: a module depends only on the schema package and core extension-point types; this also
// covers the editor entry.
const RICH_TEXT_MESSAGE = 'A module must not import @litljomi/rich-text; use @litljomi/cms-schema.';
const richTextPaths = [{ regex: `^@litljomi/rich-text(${SEP}|$)|(^|${SEP})rich-text(${SEP}|$)`, message: RICH_TEXT_MESSAGE }];
// A module reaches other code only through @litljomi/cms-schema, never another module (spec §3.1).
// Limits: the rule reads specifiers, not resolved paths. It catches the package names, any path with
// a `modules` segment (so a module's own `./modules/x` folder is forbidden too) and, per module
// below, a relative path with a sibling module's folder name as a segment (a folder of that name
// inside the module is forbidden too). It does not catch a path that reaches a sibling without
// naming it: an absolute path, one built at run time, or one through a link with another name.
const MODULE_TO_MODULE_MESSAGE = 'A module must not import another module.';
const otherModulePaths = [
  { regex: '^@litljomi/module-', message: MODULE_TO_MODULE_MESSAGE },
  { regex: `(^|${SEP})modules${SEP}`, message: MODULE_TO_MODULE_MESSAGE },
];
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const siblingModulePaths = (siblings) => [
  {
    regex: `^\\.{1,2}${SEP}(?!(.*${SEP})?modules${SEP})(.*${SEP})?(${siblings.map(escapeRegex).join('|')})(${SEP}|$)`,
    message: MODULE_TO_MODULE_MESSAGE,
  },
];
// The module folders (tenant slugs), read here so that no slug is written in this file.
const modulesDir = fileURLToPath(new URL('./modules', import.meta.url));
const moduleNames = existsSync(modulesDir)
  ? readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => entry.name)
  : [];
// Apps by folder and by workspace package name (S6). The names are the apps' package.json names.
const appPaths = [
  { regex: `(^|${SEP})apps${SEP}`, message: APPS_MESSAGE },
  { regex: `^(cms|demo-site)(${SEP}|$)`, message: APPS_MESSAGE },
];
// C-S2b: in apps/cms, Supabase clients are created only in src/lib/supabase (the editor clients,
// publishable key) and src/privileged (the admin client, secret key); other app code receives a
// client from those files. Packages, modules and sites never use Supabase (spec §8.1).
const SUPABASE_MESSAGE = 'Supabase libraries may only be imported under apps/cms/src/lib/supabase/** and apps/cms/src/privileged/**.';
const supabasePaths = [{ regex: `^@supabase(${SEP}|$)`, message: SUPABASE_MESSAGE }];
// Task 12 note (row 91): tests/integration holds the local stack's secret key at run time
// (secretClient(), read from `supabase status`), under no variable name the secret-key rule could
// match. App code may therefore reach those helpers only from test files.
const INTEGRATION_MESSAGE = 'tests/integration helpers may only be imported by test files.';
// Spec §3.1 (Task 26 security r1 F3; Task 17 security r1): a site imports only the SDK, the
// rich-text main entry (exact names, no subpaths) and its own generated types, never other
// @litljomi packages (the schema package, the editor entry, modules) and never the CMS app, by
// package name, through an `apps` segment, or by climbing out of the site (`../` segments then
// `cms`); nor modules or packages by path. Limit, as for modules: specifiers are read, not
// resolved paths.
const SITE_MESSAGE = 'A site may import only @litljomi/cms-sdk, @litljomi/rich-text and its own files (spec §3.1).';
const sitePaths = [
  { regex: `^@litljomi${SEP}(?!(cms-sdk|rich-text)$)`, message: SITE_MESSAGE },
  { regex: `^(\\.\\.${SEP})+cms(${SEP}|$)|(^|${SEP})(apps|modules|packages)${SEP}|^cms(${SEP}|$)`, message: SITE_MESSAGE },
];
const integrationTestPaths = [
  { regex: `(^|${SEP})tests${SEP}integration(${SEP}|$)|^@litljomi/integration-tests(${SEP}|$)`, message: INTEGRATION_MESSAGE },
];

// esquery regex literals cannot contain "/", so it is rewritten as the escape \x2f, which also
// works inside a character class such as [^/]. The `i` flag matches the way no-restricted-imports
// compares (case-insensitive), so `import('@/Privileged/x')` is caught too (Task 17 security r1).
const esqueryRegex = (regex) => `/${regex.replaceAll('/', '\\x2f')}/i`;

// Dynamic forms: import('x'), import(`x`), require('x'), require(`x`).
const dynamicSyntax = (paths) =>
  paths.flatMap(({ regex, message }) => {
    const re = esqueryRegex(regex);
    return [
      `ImportExpression[source.value=${re}]`,
      `ImportExpression[source.quasis.0.value.cooked=${re}]`,
      `CallExpression[callee.name='require'][arguments.0.value=${re}]`,
      `CallExpression[callee.name='require'][arguments.0.quasis.0.value.cooked=${re}]`,
    ].map((selector) => ({ selector, message }));
  });

const KEY = 'SUPABASE_SECRET_KEY';
const names = (path, value) => [`${path}.name='${value}'`, `${path}.value='${value}'`];
// Reads through process.env: the plan's selector and its equivalent spellings.
// process.env.KEY, process['env'].KEY, process.env['KEY'], process['env']['KEY']
const memberReads = names('object.property', 'env').flatMap((env) =>
  names('property', KEY).map((key) => `MemberExpression[object.object.name='process'][${env}][${key}]`),
);
// const { KEY } = process.env, const { KEY: k } = process['env'], ...
const destructuredReads = names('init.property', 'env').flatMap((env) =>
  names('key', KEY).map((key) => `VariableDeclarator[init.object.name='process'][${env}] > ObjectPattern > Property[${key}]`),
);
// Any other occurrence of the name (aliases of process.env, env schemas, Reflect.get, types, ...).
// Name nodes inside a read matched above are skipped, so that read is reported once: a member
// read holds the name only as its property (a direct child, hence `> *`); a destructured
// Property can hold it in its key, its value or a default (any descendant, hence ` *`).
const alreadyReported = [...memberReads.map((s) => `${s} > *`), ...destructuredReads.map((s) => `${s} *`)];
// Shorthand syntax holds one written name in two nodes at the same place; only the first is
// reported: `{ KEY }` and `{ KEY = d }` (key, then value), `import { KEY }` (imported, then
// local), `export { KEY }` (local, then exported). A renamed form names the key once and is
// reported once. A name written twice in an object pattern or literal (`{ KEY: KEY }`) is reported
// twice; `import { KEY as KEY }` and `export { KEY as KEY }` are reported once.
const secondNameNode = [
  'Property[shorthand=true] > Identifier.value',
  'Property[shorthand=true] > AssignmentPattern.value > Identifier.left',
  `ImportSpecifier[imported.name='${KEY}'] > Identifier.local`,
  `ExportSpecifier[local.name='${KEY}'] > Identifier.exported`,
];
const nameOccurrences = [
  `Identifier[name='${KEY}']`,
  `Literal[value='${KEY}']`,
  `TemplateElement[value.cooked='${KEY}']`,
].map((selector) => `${selector}:not(${[...alreadyReported, ...secondNameNode].join(', ')})`);
const secretSyntax = [...memberReads, ...destructuredReads, ...nameOccurrences].map((selector) => ({
  selector,
  message: SECRET_MESSAGE,
}));

const imports = (...groups) => ({ 'no-restricted-imports': ['error', { patterns: groups.flat() }] });
const syntax = (...entries) => ({ 'no-restricted-syntax': ['error', ...entries.flat()] });

// One boundary: its static import patterns and its dynamic-form selectors. A later config block
// replaces a rule's options entirely, so every block lists all the boundaries that apply to it.
const boundary = (paths) => ({ paths, selectors: dynamicSyntax(paths) });
const secret = { paths: [], selectors: secretSyntax };
const privileged = boundary(privilegedPaths);
const privilegedExceptPipeline = boundary(privilegedExceptPipelinePaths);
const privilegedExceptPreviewToken = boundary(privilegedExceptPreviewTokenPaths);
const modules = boundary(modulePaths);
const apps = boundary(appPaths);
const editor = boundary(editorPaths);
const tiptap = boundary(tiptapPaths);
const richText = boundary(richTextPaths);
const otherModules = boundary(otherModulePaths);
const supabase = boundary(supabasePaths);
const integrationTests = boundary(integrationTestPaths);
const site = boundary(sitePaths);
const rulesOf = (...boundaries) => ({
  ...imports(...boundaries.map((b) => b.paths)),
  ...syntax(...boundaries.map((b) => b.selectors)),
});

// An apps/ zone: its source files may not import the integration-test helpers, its test files may.
const appZone = (dir, ...boundaries) => [
  { files: [`${dir}/**`], rules: rulesOf(...boundaries, integrationTests) },
  { files: [`${dir}/**/__tests__/**`, `${dir}/**/*.test.{ts,tsx}`], rules: rulesOf(...boundaries) },
];

const packageBoundaries = [secret, privileged, modules, apps, editor, supabase];
const moduleBoundaries = [secret, privileged, apps, richText, otherModules, tiptap, supabase];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '.pnpm-store/**',
      // Lane B's git worktree is linted in place and again after each merge (plan, lanes).
      '.worktrees/**',
      'docs/**',
      'tools/checks/__tests__/fixtures/**',
    ],
  },
  // No comment in a source file can disable or reconfigure a rule.
  { linterOptions: { noInlineConfig: true } },
  {
    files: CODE,
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: 'module' } },
    rules: rulesOf(secret, privileged),
  },
  // This file defines the secret-key rule, so it names the key.
  {
    files: ['eslint.config.mjs'],
    rules: rulesOf(privileged),
  },
  // Order matters below: a later block replaces an earlier block's rule options entirely (see
  // `boundary`), so each block lists every boundary that applies to its files.
  ...appZone('apps', secret, privileged, modules, supabase),
  // A site's source (the demo site; spec §3.1). Its e2e harness may use the schema package to
  // build fixtures, so only src/ is limited.
  {
    files: ['apps/demo-site/src/**'],
    rules: rulesOf(secret, privileged, supabase, tiptap, site, integrationTests),
  },
  // The editor clients (publishable key): Supabase libraries are allowed, the secret key is not.
  ...appZone('apps/cms/src/lib/supabase', secret, privileged, modules),
  // The secret key, the admin client and Supabase libraries are allowed here; module imports are not.
  ...appZone('apps/cms/src/privileged', modules),
  // The registry is the one app file that imports modules.
  {
    files: ['apps/cms/src/modules/registry.ts'],
    rules: rulesOf(secret, privileged, supabase, integrationTests),
  },
  // Decision 35: exactly these two route handlers may import the pipeline entry (and the secret
  // check) from privileged/.
  // Every other rule of apps/** still applies to them.
  {
    files: ['apps/cms/src/app/api/internal/worker/route.ts', 'apps/cms/src/app/api/cron/sweep/route.ts'],
    rules: rulesOf(secret, privilegedExceptPipeline, modules, supabase, integrationTests),
  },
  // M3-10: the preview token route handler may import its entry from privileged/ (§7.5).
  {
    files: ['apps/cms/src/app/api/preview-token/route.ts'],
    rules: rulesOf(secret, privilegedExceptPreviewToken, modules, supabase, integrationTests),
  },
  {
    files: ['packages/**'],
    rules: rulesOf(...packageBoundaries, tiptap),
  },
  // The editor entry and its tests are the only package code that loads Tiptap.
  {
    files: ['packages/rich-text/src/tiptap.ts', 'packages/rich-text/src/__tests__/**'],
    rules: rulesOf(...packageBoundaries),
  },
  {
    files: ['modules/**'],
    rules: rulesOf(...moduleBoundaries),
  },
  // Per module: a relative path naming a sibling module's folder (a path through `modules/` is
  // already reported by otherModulePaths, so it is skipped here to report it once).
  ...moduleNames.map((name) => {
    const siblings = moduleNames.filter((other) => other !== name);
    return {
      files: [`modules/${name}/**`],
      rules: rulesOf(...moduleBoundaries, ...(siblings.length > 0 ? [boundary(siblingModulePaths(siblings))] : [])),
    };
  }),
  // The secret key is allowed here, but the admin client and other privileged/ code are not.
  {
    files: ['tools/cli/**'],
    rules: rulesOf(privileged),
  },
);
