// The local Supabase stack slot (CMS_STACK_SLOT), so two agents can run database and browser tests
// at the same time. Slot 1 (CMS_STACK_SLOT unset, empty or `1`) is the stack supabase/config.toml
// describes, unchanged: CI and every existing command use it. Slot 2 is a second stack beside it:
// its own project id (so its own containers, volumes, network and Mailpit inbox), every host port
// shifted by 10, its own CMS and demo-site ports, and its own Auth site URL.
//
// Slot 2 needs no second config file. Supabase CLI 2.121.0 reads any key of config.toml from a
// `SUPABASE_<SECTION>_<KEY>` variable (viper's AutomaticEnv, prefix SUPABASE, `.` read as `_`), and
// `supabase start`, `status`, `stop`, `db reset` and `test db` find their containers by the project
// id. So every Supabase CLI call on the local path runs with `supabaseCliEnv()` (tools/stack/supabase.ts
// for the `pnpm db:*` scripts and cms-next.sh, tests/integration/src/env.ts, tools/db/test.mjs), and
// everything that names a host port takes it from `stackSlot()`. Slot 1 sets none of the variables
// and removes any it inherited, so a slot-1 command always means the config.toml stack.
//
// Run as a script, `node tools/stack/slot.ts` prints the slot's ports and URLs, one `name=value` per
// line (no secrets: nothing here is a key).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Slot = 1 | 2;

export type StackSlot = {
  slot: Slot;
  /** config.toml `project_id`: names the stack's containers, volumes, network and Mailpit inbox. */
  projectId: string;
  /** Every host port the slot's stack, CMS, demo site and test fake sites listen on. */
  ports: {
    /** [db] shadow_port */
    shadow: number;
    /** [api] port */
    api: number;
    /** [db] port */
    db: number;
    /** [studio] port */
    studio: number;
    /** [local_smtp] port: Mailpit's web UI and API, the inbox the tests read. */
    mailpit: number;
    /** [local_smtp] smtp_port: Mailpit's SMTP port (the CMS's alert emails, M3-04). */
    smtp: number;
    /** [analytics] port */
    analytics: number;
    /** [db.pooler] port (the pooler is off; shifted so it never collides when turned on). */
    pooler: number;
    /** [edge_runtime] inspector_port */
    inspector: number;
    /** `next start` of the CMS, and the Auth site URL's port (decision 37.4). */
    cms: number;
    /** The demo site of the publish e2e and the local end to end (the seeded demo site, Task 25). */
    demoSite: number;
    /** The LABAK site `pnpm seed:labak-site` points the labak tenant at. */
    labakSite: number;
    /** The fake site of apps/cms pipeline.integration.test.ts. */
    pipelineSite: number;
    /** The fake site of apps/cms rotation.integration.test.ts. */
    rotationSite: number;
  };
  apiUrl: string;
  mailpitUrl: string;
  /** The CMS as the browser and Auth see it: the local Auth site URL. */
  cmsUrl: string;
  /** The seeded demo site's `cms.sites.base_url`. */
  demoSiteUrl: string;
  labakSiteUrl: string;
  /** The Supabase CLI config overrides of the slot (none for slot 1). */
  cliEnv: Readonly<Record<string, string>>;
};

/** The variable that chooses the slot. */
export const SLOT_VARIABLE = 'CMS_STACK_SLOT';

/** Slot 1's values: supabase/config.toml's, and the CMS and site ports the tests have always used. */
const SLOT_1_PORTS: StackSlot['ports'] = {
  shadow: 54320,
  api: 54321,
  db: 54322,
  studio: 54323,
  mailpit: 54324,
  smtp: 54325,
  analytics: 54327,
  pooler: 54329,
  inspector: 8083,
  cms: 3100,
  demoSite: 3101,
  labakSite: 3200,
  pipelineSite: 3198,
  rotationSite: 3193,
};
const SLOT_1_PROJECT_ID = 'litljomi-cms';
/** Each slot after the first moves every port by this much: slot 2's stack is 54330-54339. */
const PORT_STEP = 10;

/**
 * The Supabase CLI variables a slot sets, by config.toml key. Slot 1 removes every one of them from
 * the environment it passes on, so an inherited value cannot point a slot-1 command elsewhere.
 */
export const MANAGED_CLI_VARIABLES = [
  'SUPABASE_PROJECT_ID',
  'SUPABASE_API_PORT',
  'SUPABASE_DB_PORT',
  'SUPABASE_DB_SHADOW_PORT',
  'SUPABASE_DB_POOLER_PORT',
  'SUPABASE_STUDIO_PORT',
  'SUPABASE_LOCAL_SMTP_PORT',
  'SUPABASE_LOCAL_SMTP_SMTP_PORT',
  'SUPABASE_ANALYTICS_PORT',
  'SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT',
  'SUPABASE_AUTH_SITE_URL',
  'SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS',
] as const;

/** The slot CMS_STACK_SLOT names: unset or empty is 1. Anything but 1 or 2 is an error. */
export function slotOf(env: NodeJS.ProcessEnv = process.env): Slot {
  const raw = env[SLOT_VARIABLE];
  if (raw === undefined || raw === '' || raw === '1') return 1;
  if (raw === '2') return 2;
  throw new Error(`${SLOT_VARIABLE} must be unset, 1 or 2 (got ${JSON.stringify(raw)})`);
}

/** The ports, URLs and Supabase CLI overrides of the slot CMS_STACK_SLOT names. */
export function stackSlot(env: NodeJS.ProcessEnv = process.env): StackSlot {
  const slot = slotOf(env);
  const offset = (slot - 1) * PORT_STEP;
  const ports = Object.fromEntries(Object.entries(SLOT_1_PORTS).map(([name, port]) => [name, port + offset])) as StackSlot['ports'];
  const projectId = slot === 1 ? SLOT_1_PROJECT_ID : `${SLOT_1_PROJECT_ID}-${slot}`;
  const cmsUrl = `http://localhost:${ports.cms}`;
  const cliEnv: Record<string, string> =
    slot === 1
      ? {}
      : {
          SUPABASE_PROJECT_ID: projectId,
          SUPABASE_API_PORT: String(ports.api),
          SUPABASE_DB_PORT: String(ports.db),
          SUPABASE_DB_SHADOW_PORT: String(ports.shadow),
          SUPABASE_DB_POOLER_PORT: String(ports.pooler),
          SUPABASE_STUDIO_PORT: String(ports.studio),
          SUPABASE_LOCAL_SMTP_PORT: String(ports.mailpit),
          SUPABASE_LOCAL_SMTP_SMTP_PORT: String(ports.smtp),
          SUPABASE_ANALYTICS_PORT: String(ports.analytics),
          SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT: String(ports.inspector),
          // config.toml's site_url and its one redirect URL, on the slot's CMS port.
          SUPABASE_AUTH_SITE_URL: cmsUrl,
          SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS: `${cmsUrl}/auth/confirm`,
        };
  return {
    slot,
    projectId,
    ports,
    apiUrl: `http://127.0.0.1:${ports.api}`,
    mailpitUrl: `http://127.0.0.1:${ports.mailpit}`,
    cmsUrl,
    demoSiteUrl: `http://localhost:${ports.demoSite}`,
    labakSiteUrl: `http://localhost:${ports.labakSite}`,
    cliEnv,
  };
}

/**
 * The environment for a Supabase CLI call on the slot's stack: `base` without any of the managed
 * variables, then the slot's overrides. The caller adds its own quieting variables.
 */
export function supabaseCliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { cliEnv } = stackSlot(base);
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of MANAGED_CLI_VARIABLES) delete env[name];
  return { ...env, ...cliEnv };
}

/** `name=value` lines describing the slot, for people and shell scripts. */
export function describeSlot(s: StackSlot): string {
  const lines: [string, string | number][] = [
    ['slot', s.slot],
    ['project_id', s.projectId],
    ...Object.entries(s.ports).map(([name, port]): [string, number] => [`${name}_port`, port]),
    ['api_url', s.apiUrl],
    ['mailpit_url', s.mailpitUrl],
    ['cms_url', s.cmsUrl],
    ['demo_site_url', s.demoSiteUrl],
  ];
  return lines.map(([name, value]) => `${name}=${value}`).join('\n');
}

// Run as a script (argv[1] through realpath: Node runs the resolved file, and tmpdir is a link on macOS).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    console.log(describeSlot(stackSlot()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
