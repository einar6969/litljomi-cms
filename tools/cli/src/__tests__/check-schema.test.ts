import { describe, expect, it } from 'vitest';
import { defineModule, defineType, moduleSnapshot, number, text, type AnyFieldKind, type ModuleManifest, type Transform } from '@litljomi/cms-schema';
import { renderSnapshot, runCheckSchema, type CheckSchemaDeps } from '../check-schema.ts';
import { runCli } from '../cli.ts';

// Fixture modules: `alpha` has one `post` type; each test changes it one way.
const post = (fields: Record<string, AnyFieldKind>, version = 1, transforms?: Record<number, Transform>) =>
  defineType<Record<string, AnyFieldKind>>({ name: 'post', version, label: 'Post', fields, preview: { title: 'title' }, orderBy: 'title', transforms });
const fixture = (fields: Record<string, AnyFieldKind>, version = 1, transforms?: Record<number, Transform>): ModuleManifest =>
  defineModule({ tenant: 'alpha', locale: 'is', branding: { name: 'Alpha' }, types: [post(fields, version, transforms)], structure: [], site: {} });
const v1 = () => ({ title: text({ label: 'Title', required: true }), views: number({ label: 'Views' }) });

function setup(modules: Record<string, ModuleManifest>, snapshots: Record<string, string>) {
  const files = { ...snapshots };
  const out: string[] = [];
  const err: string[] = [];
  const deps: CheckSchemaDeps = {
    listModules: async () => Object.keys(modules).sort(),
    loadModule: async (name) => {
      const m = modules[name];
      if (m === undefined) throw new Error(`no module ${name}`);
      return m;
    },
    readSnapshot: async (name) => files[name] ?? null,
    writeSnapshot: async (name, t) => {
      files[name] = t;
    },
  };
  const run = (args: string[] = []) => runCheckSchema(args, { log: (l) => out.push(l), error: (l) => err.push(l) }, deps);
  return { run, files, out, err };
}

const committed = renderSnapshot(moduleSnapshot(fixture(v1())));

describe('check-schema', () => {
  it('passes when the modules match their snapshots', async () => {
    const t = setup({ alpha: fixture(v1()) }, { alpha: committed });
    expect(await t.run()).toBe(0);
    expect(t.out.at(-1)).toBe('check:schema ok (alpha)');
    expect(t.err).toEqual([]);
  });

  it('passes an additive change and asks for the snapshot update', async () => {
    const t = setup({ alpha: fixture({ ...v1(), lead: text({ label: 'Lead' }) }) }, { alpha: committed });
    expect(await t.run()).toBe(0);
    expect(t.out.join('\n')).toContain('alpha: post.lead: new optional field');
    expect(t.out.join('\n')).toContain('run pnpm check:schema --update');
    expect(t.files.alpha).toBe(committed);
  });

  it('fails a breaking change without a transform, naming module, type and field', async () => {
    const t = setup({ alpha: fixture({ title: text({ label: 'Title', required: true }) }) }, { alpha: committed });
    expect(await t.run()).toBe(1);
    expect(t.err.join('\n')).toMatch(/^alpha: post\.views: field removed/m);
    expect(t.err.at(-1)).toBe('check:schema failed');
  });

  it('passes the breaking change with a version bump and transform, and --update records it', async () => {
    const t = setup({ alpha: fixture({ title: text({ label: 'Title', required: true }) }, 2, { 1: (d) => d as object }) }, { alpha: committed });
    expect(await t.run()).toBe(0);
    expect(await t.run(['--update'])).toBe(0);
    const s = JSON.parse(t.files.alpha!);
    expect(s.types.post.version).toBe(2);
    expect(s.types.post.retired).toEqual({ views: 'number' });
    expect(t.out).toContain('alpha: snapshot written');
  });

  it('--update refuses, writing nothing, while a module has a breaking change', async () => {
    const t = setup({ alpha: fixture({ title: text({ label: 'Title', required: true }) }) }, { alpha: committed });
    expect(await t.run(['--update'])).toBe(1);
    expect(t.files.alpha).toBe(committed);
    expect(t.err.at(-1)).toMatch(/--update refused/);
  });

  it('fails a module with no snapshot; --update writes it', async () => {
    const t = setup({ alpha: fixture(v1()) }, {});
    expect(await t.run()).toBe(1);
    expect(t.err[0]).toMatch(/alpha: no schema snapshot/);
    expect(await t.run(['--update'])).toBe(0);
    expect(t.files.alpha).toBe(committed);
  });

  it('fails a module that cannot load, a snapshot that is not one, and a folder that is not a module name', async () => {
    const t = setup({ alpha: fixture(v1()), beta: fixture(v1()), Bad_Name: fixture(v1()) }, { alpha: '{', beta: '[]' });
    expect(await t.run()).toBe(1);
    const err = t.err.join('\n');
    expect(err).toMatch(/alpha: cannot load/);
    expect(err).toMatch(/beta: cannot load: .*not a schema snapshot/);
    expect(err).toMatch(/Bad_Name: not a module name/);
  });

  it('refuses unknown arguments', async () => {
    const t = setup({ alpha: fixture(v1()) }, { alpha: committed });
    expect(await t.run(['--force'])).toBe(2);
  });

  it('is reachable through runCli only with file access', async () => {
    const errors: string[] = [];
    expect(await runCli(['check-schema'], { log: () => {}, error: (l) => errors.push(l) })).toBe(1);
    expect(errors[0]).toMatch(/no file access/);
  });
});
