import tseslint from 'typescript-eslint';

const CODE = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

const PRIVILEGED_MESSAGE = 'The admin client may only be imported under apps/cms/src/privileged/**.';
const MODULE_MESSAGE = 'Modules are imported only by apps/cms/src/modules/registry.ts.';
const APPS_MESSAGE = 'packages and modules must not import from apps.';
const SECRET_MESSAGE = 'SUPABASE_SECRET_KEY may only be read under apps/cms/src/privileged/** and tools/cli.';

// Each entry is a path regex (source string) with its message. They feed both the static
// `no-restricted-imports` patterns and the dynamic `import()` / `require()` selectors.
const privilegedPaths = [{ regex: '(^|/)privileged(/|$)', message: PRIVILEGED_MESSAGE }];
const modulePaths = [
  { regex: '^@litljomi/module-', message: MODULE_MESSAGE },
  { regex: '^(@|\\.{1,2})/(.*/)?modules/(?!registry(\\.|$))', message: MODULE_MESSAGE },
];
const appPaths = [{ regex: '(^|/)apps/', message: APPS_MESSAGE }];

// esquery regex literals cannot contain "/", so it is rewritten as the class [/].
const esqueryRegex = (regex) => `/${regex.replaceAll('/', '[/]')}/`;

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
const secretSyntax = [
  // process.env.KEY, process['env'].KEY, process.env['KEY'], process['env']['KEY']
  ...names('object.property', 'env').flatMap((env) =>
    names('property', KEY).map((key) => `MemberExpression[object.object.name='process'][${env}][${key}]`),
  ),
  // const { KEY } = process.env, const { KEY: k } = process['env'], ...
  ...names('init.property', 'env').flatMap((env) =>
    names('key', KEY).map(
      (key) => `VariableDeclarator[init.object.name='process'][${env}] > ObjectPattern > Property[${key}]`,
    ),
  ),
].map((selector) => ({ selector, message: SECRET_MESSAGE }));

const imports = (...groups) => ({ 'no-restricted-imports': ['error', { patterns: groups.flat() }] });
const syntax = (...entries) => ({ 'no-restricted-syntax': ['error', ...entries.flat()] });

const privilegedSyntax = dynamicSyntax(privilegedPaths);
const moduleSyntax = dynamicSyntax(modulePaths);
const appSyntax = dynamicSyntax(appPaths);

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '.pnpm-store/**',
      'docs/**',
      '**/__tests__/fixtures/**',
    ],
  },
  {
    files: CODE,
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: 'module' } },
    rules: { ...imports(privilegedPaths), ...syntax(secretSyntax, privilegedSyntax) },
  },
  {
    files: ['apps/**'],
    rules: { ...imports(privilegedPaths, modulePaths), ...syntax(secretSyntax, privilegedSyntax, moduleSyntax) },
  },
  {
    files: ['packages/**'],
    rules: {
      ...imports(privilegedPaths, modulePaths, appPaths),
      ...syntax(secretSyntax, privilegedSyntax, moduleSyntax, appSyntax),
    },
  },
  {
    files: ['modules/**'],
    rules: { ...imports(privilegedPaths, appPaths), ...syntax(secretSyntax, privilegedSyntax, appSyntax) },
  },
  {
    files: ['apps/cms/src/modules/registry.ts'],
    rules: { ...imports(privilegedPaths), ...syntax(secretSyntax, privilegedSyntax) },
  },
  // The secret key is allowed here, but module imports (static and dynamic) are not.
  {
    files: ['apps/cms/src/privileged/**'],
    rules: { ...imports(modulePaths), ...syntax(moduleSyntax) },
  },
  { files: ['tools/cli/**'], rules: { ...imports(), 'no-restricted-syntax': 'off' } },
);
