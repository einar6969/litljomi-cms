// `--local` (enhancement A4; import decision 3): `provision` and `import` against a local Supabase
// stack, to rehearse a new tenant before production. It accepts exactly the API addresses of the two
// local stack slots (tools/stack/slot.ts: slot 1 is supabase/config.toml's, slot 2 is ten ports up),
// and nothing else: no other port, no `localhost` spelling, never a hosted project. The flag needs an
// explicit --env-file, because the default is the production env file.

/** The local stacks' API origins, slot 1 then slot 2. */
export const LOCAL_ORIGINS = ['http://127.0.0.1:54321', 'http://127.0.0.1:54331'] as const;

/** NEXT_PUBLIC_SUPABASE_URL of a --local run: one of LOCAL_ORIGINS, exactly. */
export const LOCAL_URL_RE = /^http:\/\/127\.0\.0\.1:543[23]1$/;

/** The name of a --local run's target in place of a project ref (import's ledger and report names). */
export const LOCAL_REF = 'local';

/** The host and port of an origin, for output: `127.0.0.1:54331`, `<ref>.supabase.co`. */
export const hostOf = (origin: string): string => origin.replace(/^https?:\/\//, '');
