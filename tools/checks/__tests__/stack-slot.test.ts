// The local stack slot (CMS_STACK_SLOT, tools/stack/slot.ts): slot 1 is supabase/config.toml's
// stack exactly, slot 2 shares no project id, port or inbox with it, and every Supabase CLI call
// through tools/stack/supabase.ts carries the slot's overrides.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cliEnv, refusal } from '../../stack/supabase.ts';
import { MANAGED_CLI_VARIABLES, slotOf, stackSlot, supabaseCliEnv, type StackSlot } from '../../stack/slot.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const config = parse(readFileSync(join(repoRoot, 'supabase', 'config.toml'), 'utf8')) as Record<string, unknown>;

/** The config.toml value at a dotted path, or undefined. */
function at(path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), config);
}

/** Every host port config.toml sets: keys named `port` or `*_port`, by dotted path. */
function configPorts(node: unknown = config, prefix = ''): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'number' && (key === 'port' || key.endsWith('_port'))) return [path];
    return configPorts(value, path);
  });
}

/** The CLI variable of each config.toml key a slot overrides (viper: SUPABASE_ + path, `.` as `_`). */
const VARIABLE_OF: Record<string, (typeof MANAGED_CLI_VARIABLES)[number]> = {
  project_id: 'SUPABASE_PROJECT_ID',
  'api.port': 'SUPABASE_API_PORT',
  'db.port': 'SUPABASE_DB_PORT',
  'db.shadow_port': 'SUPABASE_DB_SHADOW_PORT',
  'db.pooler.port': 'SUPABASE_DB_POOLER_PORT',
  'studio.port': 'SUPABASE_STUDIO_PORT',
  'local_smtp.port': 'SUPABASE_LOCAL_SMTP_PORT',
  'local_smtp.smtp_port': 'SUPABASE_LOCAL_SMTP_SMTP_PORT',
  'analytics.port': 'SUPABASE_ANALYTICS_PORT',
  'edge_runtime.inspector_port': 'SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT',
  'auth.site_url': 'SUPABASE_AUTH_SITE_URL',
  'auth.additional_redirect_urls': 'SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS',
};

/** The slot's port for each config.toml port key. */
const portOf = (s: StackSlot): Record<string, number> => ({
  'api.port': s.ports.api,
  'db.port': s.ports.db,
  'db.shadow_port': s.ports.shadow,
  'db.pooler.port': s.ports.pooler,
  'studio.port': s.ports.studio,
  'local_smtp.port': s.ports.mailpit,
  'local_smtp.smtp_port': s.ports.smtp,
  'analytics.port': s.ports.analytics,
  'edge_runtime.inspector_port': s.ports.inspector,
});

const slot1 = stackSlot({});
const slot2 = stackSlot({ CMS_STACK_SLOT: '2' });

describe('slotOf', () => {
  it.each([undefined, '', '1'])('reads %j as slot 1', (value) => {
    expect(slotOf(value === undefined ? {} : { CMS_STACK_SLOT: value })).toBe(1);
  });
  it('reads 2 as slot 2', () => expect(slotOf({ CMS_STACK_SLOT: '2' })).toBe(2));
  it.each(['0', '3', ' 2', '2 ', 'two', '02'])('refuses %j', (value) => {
    expect(() => slotOf({ CMS_STACK_SLOT: value })).toThrow('CMS_STACK_SLOT must be unset, 1 or 2');
  });
});

describe('slot 1', () => {
  it('is supabase/config.toml’s stack', () => {
    expect(slot1.projectId).toBe(at('project_id'));
    for (const [path, port] of Object.entries(portOf(slot1))) expect(port, path).toBe(at(path));
    expect(slot1.cmsUrl).toBe(at('auth.site_url'));
    expect([`${slot1.cmsUrl}/auth/confirm`]).toEqual(at('auth.additional_redirect_urls'));
    expect(slot1.apiUrl).toBe('http://127.0.0.1:54321');
    expect(slot1.mailpitUrl).toBe('http://127.0.0.1:54324');
  });

  it('keeps the CMS, demo site and fake site ports the tests have always used', () => {
    expect(slot1.ports).toMatchObject({ cms: 3100, demoSite: 3101, labakSite: 3200, pipelineSite: 3198, rotationSite: 3193 });
    expect(slot1.demoSiteUrl).toBe('http://localhost:3101');
    expect(slot1.labakSiteUrl).toBe('http://localhost:3200');
  });

  it('sets no Supabase CLI variable, and removes any it inherited', () => {
    expect(slot1.cliEnv).toEqual({});
    const inherited = Object.fromEntries(MANAGED_CLI_VARIABLES.map((name) => [name, 'stray']));
    const env = supabaseCliEnv({ PATH: '/usr/bin', OTHER: 'kept', ...inherited });
    expect(env).toEqual({ PATH: '/usr/bin', OTHER: 'kept' });
  });
});

describe('slot 2', () => {
  it('has its own project id, so its own containers, volumes, network and Mailpit inbox', () => {
    expect(slot2.projectId).toBe('litljomi-cms-2');
    expect(slot2.cliEnv.SUPABASE_PROJECT_ID).toBe(slot2.projectId);
  });

  it('shares no port with slot 1', () => {
    const ones = new Set(Object.values(slot1.ports));
    for (const [name, port] of Object.entries(slot2.ports)) expect(ones.has(port), name).toBe(false);
    expect(new Set(Object.values(slot2.ports)).size).toBe(Object.values(slot2.ports).length);
  });

  it('moves every stack port by 10, into 54330-54339', () => {
    for (const [path, port] of Object.entries(portOf(slot2))) {
      expect(port, path).toBe((at(path) as number) + 10);
      if (path !== 'edge_runtime.inspector_port') expect(port, path).toBeGreaterThanOrEqual(54330);
      if (path !== 'edge_runtime.inspector_port') expect(port, path).toBeLessThanOrEqual(54339);
    }
    expect(slot2.apiUrl).toBe('http://127.0.0.1:54331');
    expect(slot2.mailpitUrl).toBe('http://127.0.0.1:54334');
  });

  it('runs its CMS and demo site on their own ports, and points Auth at its CMS', () => {
    expect(slot2.ports).toMatchObject({ cms: 3110, demoSite: 3111 });
    expect(slot2.cmsUrl).toBe('http://localhost:3110');
    expect(slot2.demoSiteUrl).toBe('http://localhost:3111');
    expect(slot2.cliEnv.SUPABASE_AUTH_SITE_URL).toBe(slot2.cmsUrl);
    expect(slot2.cliEnv.SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS).toBe('http://localhost:3110/auth/confirm');
  });

  it('overrides every host port in config.toml, each through a key the file sets', () => {
    // The CLI reads a SUPABASE_* variable only for a key config.toml has (viper's AutomaticEnv).
    for (const path of Object.keys(VARIABLE_OF)) expect(at(path), path).not.toBeUndefined();
    // A port added to config.toml must be given to slot 2 too.
    expect(configPorts().sort()).toEqual(Object.keys(portOf(slot2)).sort());
    const ports = portOf(slot2);
    for (const [path, port] of Object.entries(ports)) expect(slot2.cliEnv[VARIABLE_OF[path]!], path).toBe(String(port));
    expect(Object.keys(slot2.cliEnv).sort()).toEqual([...MANAGED_CLI_VARIABLES].sort());
    expect(Object.values(VARIABLE_OF).sort()).toEqual([...MANAGED_CLI_VARIABLES].sort());
  });

  it('replaces inherited values of the managed variables', () => {
    const env = supabaseCliEnv({ CMS_STACK_SLOT: '2', SUPABASE_API_PORT: '54321', SUPABASE_PROJECT_ID: 'litljomi-cms' });
    expect(env).toMatchObject({ SUPABASE_API_PORT: '54331', SUPABASE_PROJECT_ID: 'litljomi-cms-2', CMS_STACK_SLOT: '2' });
  });
});

describe('tools/stack/supabase.ts', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'stack-slot-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it.each([
    [['db', 'reset', '--linked']],
    [['db', 'push', '--linked=true']],
    [['test', 'db', '--db-url', 'postgresql://x']],
    [['db', 'reset', '--db-url=postgresql://x']],
    [['stop', '--all']],
  ])('refuses %j', (args) => {
    expect(refusal(args)).toMatch(/^refusing/);
  });

  it.each([[['start']], [['stop']], [['stop', '--no-backup']], [['db', 'reset']], [['status', '-o', 'env']], [['test', 'db', 'a.test.sql']]])(
    'lets %j run',
    (args) => expect(refusal(args)).toBeNull(),
  );

  it('runs the CLI with telemetry off and the slot’s overrides', () => {
    expect(cliEnv({})).toMatchObject({ SUPABASE_TELEMETRY_DISABLED: '1' });
    expect(cliEnv({})).not.toHaveProperty('SUPABASE_PROJECT_ID');
    expect(cliEnv({ CMS_STACK_SLOT: '2' })).toMatchObject({ SUPABASE_TELEMETRY_DISABLED: '1', ...slot2.cliEnv });
  });

  /** A copy of tools/stack in a scratch repository, with a fake `supabase` that records its call. */
  function scratch(): { script: string; bin: string } {
    const stackDir = join(tmp, 'repo', 'tools', 'stack');
    mkdirSync(stackDir, { recursive: true });
    for (const f of ['slot.ts', 'supabase.ts']) copyFileSync(join(repoRoot, 'tools', 'stack', f), join(stackDir, f));
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'supabase'),
      ['#!/bin/sh', 'pwd > "$FAKE_OUT.cwd"', 'printf "%s\\n" "$@" > "$FAKE_OUT.args"', 'env > "$FAKE_OUT.env"', 'exit "${FAKE_STATUS:-0}"', ''].join('\n'),
    );
    chmodSync(join(bin, 'supabase'), 0o755);
    return { script: join(stackDir, 'supabase.ts'), bin };
  }

  function run(script: string, bin: string, args: string[], extra: Record<string, string> = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_OUT: join(tmp, 'out'), ...extra };
    if (!('CMS_STACK_SLOT' in extra)) delete env.CMS_STACK_SLOT;
    for (const name of MANAGED_CLI_VARIABLES) delete env[name];
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
  }

  const recorded = () => {
    const env: Record<string, string> = {};
    for (const line of readFileSync(join(tmp, 'out.env'), 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
    }
    return { args: readFileSync(join(tmp, 'out.args'), 'utf8').trim().split('\n'), cwd: readFileSync(join(tmp, 'out.cwd'), 'utf8').trim(), env };
  };

  it('runs `supabase <args>` from the repository root on slot 1 with no overrides', () => {
    const { script, bin } = scratch();
    const result = run(script, bin, ['db', 'reset']);
    expect(result.status, result.stderr).toBe(0);
    const call = recorded();
    expect(call.args).toEqual(['db', 'reset']);
    expect(realpathSync(call.cwd)).toBe(realpathSync(join(tmp, 'repo')));
    expect(call.env.SUPABASE_TELEMETRY_DISABLED).toBe('1');
    for (const name of MANAGED_CLI_VARIABLES) expect(call.env, name).not.toHaveProperty(name);
  });

  it('runs it on slot 2 with every override', () => {
    const { script, bin } = scratch();
    const result = run(script, bin, ['start'], { CMS_STACK_SLOT: '2' });
    expect(result.status, result.stderr).toBe(0);
    expect(recorded().env).toMatchObject(slot2.cliEnv);
  });

  it('passes the CLI’s exit status through', () => {
    const { script, bin } = scratch();
    expect(run(script, bin, ['status'], { FAKE_STATUS: '3' }).status).toBe(3);
  });

  it('refuses an invalid slot and a refused command without running the CLI', () => {
    const { script, bin } = scratch();
    const bad = run(script, bin, ['start'], { CMS_STACK_SLOT: '3' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('CMS_STACK_SLOT must be unset, 1 or 2');
    const all = run(script, bin, ['stop', '--all'], { CMS_STACK_SLOT: '2' });
    expect(all.status).toBe(1);
    expect(all.stderr).toContain('refusing stop --all');
    expect(() => readFileSync(join(tmp, 'out.args'))).toThrow();
  });
});
