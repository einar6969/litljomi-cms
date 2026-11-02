import tseslint from 'typescript-eslint';

const CODE = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

const PRIVILEGED_MESSAGE = 'The admin client may only be imported under apps/cms/src/privileged/**.';
const MODULE_MESSAGE = 'Modules are imported only by apps/cms/src/modules/registry.ts.';
const APPS_MESSAGE = 'packages and modules must not import from apps.';
const SECRET_MESSAGE = 'SUPABASE_SECRET_KEY may only be read under apps/cms/src/privileged/** and tools/cli.';

// Each entry is a path regex (source string) with its message, and feeds both the static
// `no-restricted-imports` patterns and the dynamic `import()` / `require()` selectors.
const privilegedPaths = [{ regex: '(^#?|/)privileged(/|$)', message: PRIVILEGED_MESSAGE }];
// Alias forms covered: `@/`, `~/`, `#` (subpath imports), relative and bare specifiers.
// The registry is exempt only when `registry` (optionally with an extension) is the last segment,
// so `registry.x/../labak`, `registry/..` or any `..` after `modules/` is still forbidden.
const modulePaths = [
  { regex: '^@litljomi/module-', message: MODULE_MESSAGE },
  { regex: '^(([@~]|\\.{1,2})/(.*/)?|#)?modules/(?!registry(\\.[^/]*)?$)', message: MODULE_MESSAGE },
];
// Only the CMS app may import the Tiptap editor entry (decision 23).
const EDITOR_MESSAGE = 'The rich-text editor entry (@litljomi/rich-text/editor) may only be imported by apps/cms.';
const editorPaths = [{ regex: '^@litljomi/rich-text/editor(/|$)|(^|/)rich-text/src/tiptap(\\.[^/]*)?$', message: EDITOR_MESSAGE }];
// A module reaches other code only through @litljomi/cms-schema, never another module (spec §3.1).
const MODULE_TO_MODULE_MESSAGE = 'A module must not import another module.';
const otherModulePaths = [
  { regex: '^@litljomi/module-', message: MODULE_TO_MODULE_MESSAGE },
  { regex: '(^|/)modules/', message: MODULE_TO_MODULE_MESSAGE },
];
const appPaths = [{ regex: '(^|/)apps/', message: APPS_MESSAGE }];

// esquery regex literals cannot contain "/", so it is rewritten as the escape \x2f, which also
// works inside a character class such as [^/].
const esqueryRegex = (regex) => `/${regex.replaceAll('/', '\\x2f')}/`;

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
// reported once; a name written twice (`{ KEY: KEY }`) is reported twice.
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

const privilegedSyntax = dynamicSyntax(privilegedPaths);
const moduleSyntax = dynamicSyntax(modulePaths);
const appSyntax = dynamicSyntax(appPaths);
const editorSyntax = dynamicSyntax(editorPaths);
const otherModuleSyntax = dynamicSyntax(otherModulePaths);

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
    rules: { ...imports(privilegedPaths), ...syntax(secretSyntax, privilegedSyntax) },
  },
  // This file defines the secret-key rule, so it names the key.
  {
    files: ['eslint.config.mjs'],
    rules: { ...syntax(privilegedSyntax) },
  },
  {
    files: ['apps/**'],
    rules: { ...imports(privilegedPaths, modulePaths), ...syntax(secretSyntax, privilegedSyntax, moduleSyntax) },
  },
  {
    files: ['packages/**'],
    rules: {
      ...imports(privilegedPaths, modulePaths, appPaths, editorPaths),
      ...syntax(secretSyntax, privilegedSyntax, moduleSyntax, appSyntax, editorSyntax),
    },
  },
  {
    files: ['modules/**'],
    rules: {
      ...imports(privilegedPaths, appPaths, editorPaths, otherModulePaths),
      ...syntax(secretSyntax, privilegedSyntax, appSyntax, editorSyntax, otherModuleSyntax),
    },
  },
  // Same rules as the base block: undoes the apps/** module restriction for the registry only.
  {
    files: ['apps/cms/src/modules/registry.ts'],
    rules: { ...imports(privilegedPaths), ...syntax(secretSyntax, privilegedSyntax) },
  },
  // The secret key is allowed here, but module imports (static and dynamic) are not.
  {
    files: ['apps/cms/src/privileged/**'],
    rules: { ...imports(modulePaths), ...syntax(moduleSyntax) },
  },
  // The secret key is allowed here, but the admin client and other privileged/ code are not.
  {
    files: ['tools/cli/**'],
    rules: { ...imports(privilegedPaths), ...syntax(privilegedSyntax) },
  },
);
