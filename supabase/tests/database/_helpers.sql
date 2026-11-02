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
-- These explicit grants are needed once Task 4 revokes PUBLIC's default EXECUTE
-- on functions; until then PUBLIC still has it, so they are redundant today.
grant execute on function
  tests.persona(text), tests.tenant(text), tests.act_as(uuid, text),
  tests.act_as_anon(), tests.act_as_service(), tests.act_as_owner()
  to anon, authenticated, service_role;
revoke execute on function tests.seed() from public;
