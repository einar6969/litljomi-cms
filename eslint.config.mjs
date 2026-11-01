import tseslint from 'typescript-eslint';

const CODE = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

const privilegedImports = [
  { regex: '^@/privileged(/|$)', message: 'The admin client may only be imported under apps/cms/src/privileged/**.' },
  { regex: '(^|/)privileged(/|$)', message: 'The admin client may only be imported under apps/cms/src/privileged/**.' },
];
const moduleImports = [
  { regex: '^@litljomi/module-', message: 'Modules are imported only by apps/cms/src/modules/registry.ts.' },
  { regex: '^(\\.\\./)+modules/(?!registry(\\.|$))', message: 'Modules are imported only by apps/cms/src/modules/registry.ts.' },
];
const appImports = [
  { regex: '(^|/)apps/', message: 'packages and modules must not import from apps.' },
];

const restrict = (...groups) => ({
  'no-restricted-imports': ['error', { patterns: groups.flat() }],
});

const SECRET = 'SUPABASE_SECRET_KEY';
const secretMessage = 'SUPABASE_SECRET_KEY may only be read under apps/cms/src/privileged/** and tools/cli.';
const secretSyntax = [
  `MemberExpression[object.object.name='process'][object.property.name='env'][property.name='${SECRET}']`,
  `MemberExpression[object.object.name='process'][object.property.name='env'][property.value='${SECRET}']`,
  `VariableDeclarator[init.object.name='process'][init.property.name='env'] > ObjectPattern > Property[key.name='${SECRET}']`,
  `VariableDeclarator[init.object.name='process'][init.property.name='env'] > ObjectPattern > Property[key.value='${SECRET}']`,
].map((selector) => ({ selector, message: secretMessage }));

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
    rules: {
      ...restrict(privilegedImports),
      'no-restricted-syntax': ['error', ...secretSyntax],
    },
  },
  { files: ['apps/**'], rules: restrict(privilegedImports, moduleImports) },
  { files: ['packages/**'], rules: restrict(privilegedImports, moduleImports, appImports) },
  { files: ['modules/**'], rules: restrict(privilegedImports, appImports) },
  { files: ['apps/cms/src/modules/registry.ts'], rules: restrict(privilegedImports) },
  { files: ['apps/cms/src/privileged/**'], rules: { ...restrict(moduleImports), 'no-restricted-syntax': 'off' } },
  { files: ['tools/cli/**'], rules: { ...restrict(), 'no-restricted-syntax': 'off' } },
);
