// M2-19 (spec §10.1, "Icelandic editor interface"): every user-facing string in the CMS comes
// from `i18n/is.ts`. This test reads the app's source with the TypeScript parser and fails on
// - text written straight into JSX (`<p>Vista</p>`, `{'Vista'}`, `{ok ? 'Já' : 'Nei'}`), and on
//   literals in the attributes a person reads or hears (`title`, `alt`, `placeholder`, the
//   text-carrying `aria-*` attributes);
// - a `t.…` path that names no key in `is.ts` (a missing key);
// - a key in `is.ts` that no source file under `src/` reads (an unused key).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { is } from '../is';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(SRC, '..');

/** Every .ts/.tsx file under `dir`, without tests, declaration files or the text file itself. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : sources(path);
    if (!/\.tsx?$/.test(d.name) || d.name.endsWith('.d.ts')) return [];
    return path === join(SRC, 'i18n', 'is.ts') ? [] : [path];
  });
}

function parse(path: string): ts.SourceFile {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

function where(file: ts.SourceFile, node: ts.Node): string {
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${relative(APP, file.fileName)}:${line + 1}`;
}

// ---------------------------------------------------------------------------------------------
// Hard-coded strings

/** Attributes whose value is shown to or read out for a person. */
const TEXT_ATTRIBUTES = new Set([
  'title',
  'alt',
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'aria-braillelabel',
  'aria-brailleroledescription',
]);

/** Words, not punctuation, digits or `{placeholder}` slots. */
function hasWords(text: string): boolean {
  return /\p{L}/u.test(text.replace(/\{\w+\}/g, ''));
}

/** The literal text an expression can evaluate to directly: a literal, a branch, a fallback. */
function literalTexts(node: ts.Expression): ts.Node[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isTemplateExpression(node)) return [node.head, ...node.templateSpans.map((s) => s.literal)];
  if (ts.isParenthesizedExpression(node)) return literalTexts(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(
      node.operatorToken.kind,
    )
  ) {
    return [...literalTexts(node.left), ...literalTexts(node.right)];
  }
  return [];
}

function textOf(node: ts.Node): string {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)
    ? node.text
    : node.getText();
}

/** Hard-coded user-facing text in one file, as `path:line "text"`. */
function hardCodedText(file: ts.SourceFile): string[] {
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    if (hasWords(text)) found.push(`${where(file, node)} ${JSON.stringify(text.trim())}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      report(node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const lit of literalTexts(node.expression)) report(lit, textOf(lit));
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(file)) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) report(init, init.text);
      else if (ts.isJsxExpression(init) && init.expression) {
        for (const lit of literalTexts(init.expression)) report(lit, textOf(lit));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Missing and unused keys

type Tree = { readonly [key: string]: Tree | string };

function leaves(node: Tree | string, key = ''): string[] {
  if (typeof node === 'string') return [key];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, key ? `${key}.${k}` : k));
}

/** Whether the file imports `t` from the text file. */
function importsText(file: ts.SourceFile): boolean {
  return file.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      /(^@\/|\/)i18n\/is$/.test(s.moduleSpecifier.text) &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === 't'),
  );
}

/** Names declared in the file, other than imports: a second `t` would hide the text tree. */
function declaredNames(file: ts.SourceFile): Map<string, ts.Node> {
  const names = new Map<string, ts.Node>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      names.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

interface KeyUse {
  /** Leaves read, or subtrees read as a whole (dynamic access or passed on). */
  used: string[];
  /** `t.…` paths that name no key, as `path:line t.a.b`. */
  missing: string[];
  /** Other `t` declarations in a file that imports `t`, and `t` read as a whole, which hides which keys are read. */
  shadowed: string[];
}

/** The keys one file reads through `t` and through aliases like `const h = t.editor.history`. */
function keyUse(file: ts.SourceFile): KeyUse {
  const result: KeyUse = { used: [], missing: [], shadowed: [] };
  if (!importsText(file)) return result;
  const declared = declaredNames(file);
  const shadow = declared.get('t');
  if (shadow) result.shadowed.push(`${where(file, shadow)} t`);

  // Roots: `t` itself, then every `const x = t.a.b` alias of a subtree, in source order.
  const roots = new Map<string, string[]>([['t', []]]);

  const visit = (node: ts.Node): void => {
    // `typeof t.a.b` in a type reads no text; its qualified name is not an expression.
    if (ts.isIdentifier(node) && roots.has(node.text) && !isDeclarationName(node) && !ts.isQualifiedName(node.parent)) {
      resolveChain(node, roots.get(node.text)!);
    }
    ts.forEachChild(node, visit);
  };

  const resolveChain = (id: ts.Identifier, base: string[]) => {
    let outer: ts.Node = id;
    const path = [...base];
    let tree: Tree | string = is;
    for (const k of base) tree = (tree as Tree)[k]!;
    while (ts.isPropertyAccessExpression(outer.parent) && outer.parent.expression === outer && typeof tree !== 'string') {
      const name = outer.parent.name.text;
      if (!(name in tree)) {
        result.missing.push(`${where(file, outer.parent)} ${['t', ...path, name].join('.')}`);
        return;
      }
      path.push(name);
      tree = tree[name]!;
      outer = outer.parent;
    }
    if (typeof tree === 'string') {
      result.used.push(path.join('.'));
      return;
    }
    // A subtree. Named as an alias: follow the alias. Otherwise it is read as a whole.
    const parent = outer.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === outer && ts.isIdentifier(parent.name)) {
      roots.set(parent.name.text, path);
      return;
    }
    if (path.length === 0) {
      result.shadowed.push(`${where(file, id)} t read as a whole`);
      return;
    }
    result.used.push(path.join('.'));
  };

  visit(file);
  return result;
}

function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    (ts.isVariableDeclaration(p) && p.name === id) ||
    ts.isImportSpecifier(p) ||
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    ts.isParameter(p) ||
    ts.isBindingElement(p)
  );
}

// ---------------------------------------------------------------------------------------------

const files = sources(SRC).map(parse);
// The platform console's copy is English (M4 plan, Global constraints): it has one reader and is
// not the editor's interface, so it adds nothing to is.ts. The key checks below still read it.
const CONSOLE = `${join(SRC, 'app', 'console')}/`;
const e2eFiles = sources(join(APP, 'e2e')).map(parse);

describe('Icelandic copy (M2-19)', () => {
  it('has no hard-coded text in JSX or in title, alt, placeholder and aria-* attributes', () => {
    const found = files.filter((f) => f.fileName.endsWith('.tsx') && !f.fileName.startsWith(CONSOLE)).flatMap(hardCodedText);
    expect(found).toEqual([]);
  });

  it('reads no key that is missing from is.ts', () => {
    const uses = [...files, ...e2eFiles].map(keyUse);
    expect(uses.flatMap((u) => u.shadowed)).toEqual([]);
    expect(uses.flatMap((u) => u.missing)).toEqual([]);
  });

  it('has no key in is.ts that the app does not read', () => {
    const used = files.flatMap((f) => keyUse(f).used);
    const unused = leaves(is).filter((leaf) => !used.some((u) => leaf === u || leaf.startsWith(`${u}.`)));
    expect(unused).toEqual([]);
  });

  it('reads the files it checks', () => {
    // A guard against a path change that would make the checks above pass on nothing.
    expect(files.filter((f) => f.fileName.endsWith('.tsx')).length).toBeGreaterThan(30);
    expect(files.filter(importsText).length).toBeGreaterThan(30);
  });
});

describe('the copy check itself', () => {
  const tsx = (source: string) => ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('finds JSX text, literal children and text attributes', () => {
    const found = hardCodedText(
      tsx(`const a = <div title="Titill" aria-label={'Merki'} aria-hidden="true" className="p-4">
        Vista
        {'Hætta'}
        {ok ? 'Já' : t.editor.boolean.no}
        {\`\${n} færslur\`}
        <span>{t.app.title} · {count}</span>
        <img alt={x ?? 'Mynd'} />
      </div>;`),
    ).map((s) => s.replace(/^\S+ /, ''));
    expect(found).toEqual(['"Titill"', '"Merki"', '"Vista"', '"Hætta"', '"Já"', '"færslur"', '"Mynd"']);
  });

  it('follows aliases and reports missing keys and other t declarations', () => {
    const source = `import { t } from '@/i18n/is';
      const h = t.editor.history;
      h.title; h.nope; t.editor.list.item.replace('{n}', '1'); t.entries.statuses[s];
      [1].map((t) => 1); type K = keyof typeof t.entries.statuses; f(t);`;
    const use = keyUse(tsx(source));
    expect(use.used).toEqual(['editor.history.title', 'editor.list.item', 'entries.statuses']);
    expect(use.missing.map((m) => m.replace(/^\S+ /, ''))).toEqual(['t.editor.history.nope']);
    expect(use.shadowed.map((m) => m.replace(/^\S+ /, ''))).toEqual(['t', 't read as a whole']);
  });
});
