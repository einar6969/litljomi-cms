-- Shared pgTAP helpers. Included with `\ir _helpers.sql` inside each test's
-- transaction, so everything here is rolled back with it. Never a migration.
-- UUIDs must agree with tests/integration/src/fixtures.ts.

-- Errors outside a transaction block, so a plain run cannot commit schema tests.
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

-- Stub until Task 5: inserts the five users only.
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
end;
$$;

create function tests.act_as(p_user uuid, p_aal text default 'aal1') returns void
language plpgsql
set search_path = ''
as $$
begin
  set local role authenticated;
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text,
    true);
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
grant execute on all functions in schema tests to anon, authenticated, service_role;
