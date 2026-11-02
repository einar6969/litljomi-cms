-- Shared pgTAP helpers. Included with `\ir _helpers.sql` inside each test's
-- transaction, so everything here is rolled back with it. Never a migration.
-- UUIDs must agree with tests/integration/src/fixtures.ts.

-- Guard: SAVEPOINT errors outside a transaction block, so a plain run cannot
-- commit schema tests. The savepoint is deliberately never released.
savepoint tests_helpers;

create schema tests;

create function tests.persona(p_name text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  case p_name
    when 'editor_labak'   then return '00000000-0000-4000-8000-00000000b001'::uuid;
    when 'editor_demo'    then return '00000000-0000-4000-8000-00000000b002'::uuid;
    when 'outsider'       then return '00000000-0000-4000-8000-00000000b003'::uuid;
    when 'revoked'        then return '00000000-0000-4000-8000-00000000b004'::uuid;
    when 'platform_admin' then return '00000000-0000-4000-8000-00000000b005'::uuid;
    else raise exception 'unknown persona: %', p_name;
  end case;
end;
$$;

create function tests.tenant(p_slug text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_slug = 'labak' then
    return '00000000-0000-4000-8000-00000000a001'::uuid;
  elsif p_slug = 'demo' then
    return '00000000-0000-4000-8000-00000000a002'::uuid;
  end if;
  raise exception 'unknown tenant: %', p_slug;
end;
$$;

-- Fixture rows that a test file inserts itself: entries are 'c' and revisions 'd'
-- followed by three hex digits, e.g. tests.entry('c001') =
-- 00000000-0000-4000-8000-00000000c001. Usable inside the $$ strings pgTAP
-- executes, where psql variables are not expanded.
create function tests.entry(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^c[0-9a-f]{3}$' then
    raise exception 'unknown entry key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;

create function tests.revision(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^d[0-9a-f]{3}$' then
    raise exception 'unknown revision key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;

-- Column privileges: every (column, privilege) pair a role holds for INSERT,
-- UPDATE or REFERENCES, whether granted per column or for the whole table.
-- Owner context only.
create function tests.column_privs(p_role text, p_table regclass)
returns table (col text, priv text)
language sql
set search_path = ''
as $$
  select a.attname::text, p.priv
  from pg_catalog.pg_attribute a
  cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) as p(priv)
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
    and pg_catalog.has_column_privilege(p_role, a.attrelid, a.attnum, p.priv)
$$;

-- Trigger-order probes. A test attaches one as a BEFORE trigger whose name sorts
-- after the triggers under test (zz_...), to prove that a protection does not
-- depend on BEFORE-trigger name order, then drops it.
--   probe_set_column(column, value): sets NEW.column to the text value.
--   probe_keep_column(column): sets NEW.column back to OLD.column (UPDATE only).
create function tests.probe_set_column() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  return pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object(tg_argv[0], tg_argv[1]));
end;
$$;

create function tests.probe_keep_column() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  return pg_catalog.jsonb_populate_record(new,
    pg_catalog.jsonb_build_object(tg_argv[0], pg_catalog.to_jsonb(old) -> tg_argv[0]));
end;
$$;

-- The fixed test identities (plan, "Fixed test identities"): five users, tenants
-- labak and demo, one editor membership each, revoked's membership in labak
-- deleted after seeding, platform_admin in cms.platform_admins only. Owner context.
create function tests.seed() returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select tests.persona(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e,
         pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  from (values
    ('editor_labak', 'editor-labak@test.local'),
    ('editor_demo', 'editor-demo@test.local'),
    ('outsider', 'outsider@test.local'),
    ('revoked', 'revoked@test.local'),
    ('platform_admin', 'admin@test.local')
  ) as v(n, e);

  insert into cms.tenants (id, slug, name) values
    (tests.tenant('labak'), 'labak', 'Landssamband bakarameistara'),
    (tests.tenant('demo'), 'demo', 'Demo');

  insert into cms.memberships (tenant_id, user_id) values
    (tests.tenant('labak'), tests.persona('editor_labak')),
    (tests.tenant('demo'), tests.persona('editor_demo')),
    (tests.tenant('labak'), tests.persona('revoked'));
  delete from cms.memberships where user_id = tests.persona('revoked');

  insert into cms.platform_admins (user_id) values (tests.persona('platform_admin'));
end;
$$;

create function tests.act_as(p_user uuid, p_aal text default 'aal1') returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_user is null then
    raise exception 'tests.act_as: p_user must not be null';
  end if;
  if p_aal is null or p_aal not in ('aal1', 'aal2') then
    raise exception 'tests.act_as: p_aal must be aal1 or aal2, got %', coalesce(p_aal, '<null>');
  end if;
  set local role authenticated;
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
end;
$$;

create function tests.act_as_anon() returns void
language plpgsql
set search_path = ''
as $$
begin
  set local role anon;
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('role', 'anon')::text, true);
end;
$$;

create function tests.act_as_service() returns void
language plpgsql
set search_path = ''
as $$
begin
  set local role service_role;
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('role', 'service_role')::text, true);
end;
$$;

create function tests.act_as_owner() returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  perform pg_catalog.set_config('request.jwt.claims', '', true);
end;
$$;

grant usage on schema tests to anon, authenticated, service_role;
-- Not seed(): it is for the owner context only.
-- These explicit grants are required: Task 4's global default privileges revoke
-- EXECUTE from PUBLIC on every function postgres creates, these included.
grant execute on function
  tests.persona(text), tests.tenant(text), tests.entry(text), tests.revision(text), tests.act_as(uuid, text),
  tests.act_as_anon(), tests.act_as_service(), tests.act_as_owner()
  to anon, authenticated, service_role;
revoke execute on function tests.seed() from public;
-- column_privs() is for the owner context; the probe trigger functions need no
-- EXECUTE grant (triggers fire without an EXECUTE check).
