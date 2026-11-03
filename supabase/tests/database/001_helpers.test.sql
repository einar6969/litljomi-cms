-- supabase/tests/database/001_helpers.test.sql
-- Covers every helper in _helpers.sql (000_harness.test.sql covers the main path).
begin;
\ir _helpers.sql
select plan(51);

-- persona(): one UUID per name, and the unknown-name exception
select is(tests.persona('editor_labak'),   '00000000-0000-4000-8000-00000000b001'::uuid, 'persona editor_labak');
select is(tests.persona('editor_demo'),    '00000000-0000-4000-8000-00000000b002'::uuid, 'persona editor_demo');
select is(tests.persona('outsider'),       '00000000-0000-4000-8000-00000000b003'::uuid, 'persona outsider');
select is(tests.persona('revoked'),        '00000000-0000-4000-8000-00000000b004'::uuid, 'persona revoked');
select is(tests.persona('platform_admin'), '00000000-0000-4000-8000-00000000b005'::uuid, 'persona platform_admin');
select throws_ok($$select tests.persona('nobody')$$, 'P0001', 'unknown persona: nobody', 'persona rejects an unknown name');

-- tenant()
select is(tests.tenant('labak'), '00000000-0000-4000-8000-00000000a001'::uuid, 'tenant labak');
select is(tests.tenant('demo'),  '00000000-0000-4000-8000-00000000a002'::uuid, 'tenant demo');
select throws_ok($$select tests.tenant('nope')$$, 'P0001', 'unknown tenant: nope', 'tenant rejects an unknown slug');

-- entry() and revision(): fixture UUIDs by key
select is(tests.entry('c001'), '00000000-0000-4000-8000-00000000c001'::uuid, 'entry c001');
select is(tests.entry('c0af'), '00000000-0000-4000-8000-00000000c0af'::uuid, 'entry keys are hex');
select throws_ok($$select tests.entry('d001')$$, 'P0001', 'unknown entry key: d001', 'entry rejects a revision key');
select throws_ok($$select tests.entry(null)$$, 'P0001', 'unknown entry key: <null>', 'entry rejects null');
select is(tests.revision('d002'), '00000000-0000-4000-8000-00000000d002'::uuid, 'revision d002');
select throws_ok($$select tests.revision('c001')$$, 'P0001', 'unknown revision key: c001', 'revision rejects an entry key');

-- column_privs(): table-level and per-column INSERT/UPDATE/REFERENCES
select is_empty($$ select * from tests.column_privs('authenticated', 'cms.memberships') $$,
  'column_privs: nothing for a select-only grant');
-- service_role holds table-level INSERT and, since decision 33 (Task 19),
-- UPDATE on (name, status) only.
select set_eq($$ select * from tests.column_privs('service_role', 'cms.tenants') $$,
  $$ select a.attname::text, 'INSERT' from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.tenants'::regclass and a.attnum > 0 and not a.attisdropped
     union all values ('name', 'UPDATE'), ('status', 'UPDATE') $$,
  'column_privs: a table-level insert expands to every column; a column grant lists only its columns');

-- probe_set_column() and probe_keep_column(): BEFORE-trigger probes
create table tests.probe_target (id int primary key, n int, s text);
create trigger zz_probe_set before insert on tests.probe_target
  for each row execute function tests.probe_set_column('s', 'probe');
create trigger zz_probe_keep before update on tests.probe_target
  for each row execute function tests.probe_keep_column('n');
insert into tests.probe_target values (1, 7, 'given');
select is((select s from tests.probe_target), 'probe', 'probe_set_column sets the named column');
update tests.probe_target set n = 8, s = 'changed';
select is((select n from tests.probe_target), 7, 'probe_keep_column restores the old value');
select is((select s from tests.probe_target), 'changed', 'probe_keep_column leaves other columns alone');
drop trigger zz_probe_set on tests.probe_target;
create trigger zz_probe_set_int before insert on tests.probe_target
  for each row execute function tests.probe_set_column('n', '42');
insert into tests.probe_target (id, n) values (2, 1);
select is((select n from tests.probe_target where id = 2), 42, 'probe_set_column converts the text value to the column type');
drop table tests.probe_target;
select ok(not has_function_privilege('authenticated', 'tests.column_privs(text, regclass)', 'execute'),
  'column_privs is for the owner context only');
select ok(not has_function_privilege('anon', 'tests.column_privs(text, regclass)', 'execute'),
  'anon cannot execute column_privs');

-- seed(): five users; not executable by the roles the tests switch to
select lives_ok($$select tests.seed()$$, 'seed runs');
select is((select count(*)::int from auth.users where email like '%@test.local'), 5, 'seed inserts five users');
select is((select count(distinct id)::int from auth.users
           where id in (tests.persona('editor_labak'), tests.persona('editor_demo'), tests.persona('outsider'),
                        tests.persona('revoked'), tests.persona('platform_admin'))), 5, 'seeded users carry the persona UUIDs');
select ok(not has_function_privilege('anon', 'tests.seed()', 'execute'), 'anon cannot execute seed');
select ok(not has_function_privilege('authenticated', 'tests.seed()', 'execute'), 'authenticated cannot execute seed');
select ok(not has_function_privilege('service_role', 'tests.seed()', 'execute'), 'service_role cannot execute seed');
-- Behavioural proof of the privilege checks above: as an authenticated persona, calling
-- seed() fails with the missing-EXECUTE error itself, not with any other 42501.
select tests.act_as(tests.persona('outsider'));
select throws_ok($$select tests.seed()$$, '42501', 'permission denied for function seed', 'authenticated cannot call seed');
select tests.act_as_owner();
select ok(
  (select bool_and(has_function_privilege(r, f, 'execute'))
   from unnest(array['anon', 'authenticated', 'service_role']) as r,
        unnest(array['tests.persona(text)', 'tests.tenant(text)', 'tests.entry(text)', 'tests.revision(text)',
                     'tests.act_as(uuid,text)',
                     'tests.act_as_anon()', 'tests.act_as_service()', 'tests.act_as_owner()']) as f),
  'every role can execute the helpers used after a role switch');

-- act_as(): validation (in owner context)
select throws_ok($$select tests.act_as(null)$$, 'P0001', 'tests.act_as: p_user must not be null', 'act_as rejects a null user');
select throws_ok(format($$select tests.act_as(%L::uuid, 'aal 2')$$, tests.persona('outsider')), 'P0001',
  'tests.act_as: p_aal must be aal1 or aal2, got aal 2', 'act_as rejects an unknown aal');
select throws_ok(format($$select tests.act_as(%L::uuid, null)$$, tests.persona('outsider')), 'P0001',
  'tests.act_as: p_aal must be aal1 or aal2, got <null>', 'act_as rejects a null aal');

-- act_as(): default aal1, explicit aal2
select tests.act_as(tests.persona('platform_admin'));
select is(auth.jwt() ->> 'aal', 'aal1', 'act_as defaults to aal1');
select is(auth.jwt() ->> 'role', 'authenticated', 'act_as sets the role claim');
select is(auth.uid(), tests.persona('platform_admin'), 'act_as sets sub for another persona');
select tests.act_as_owner();
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is(auth.jwt() ->> 'aal', 'aal2', 'act_as sets the aal2 claim');
select is(current_user::text, 'authenticated', 'act_as with aal2 uses authenticated');

-- act_as_owner() from authenticated
select tests.act_as_owner();
select is(current_user::text, session_user::text, 'act_as_owner returns to session_user from authenticated');

-- act_as_anon()
select tests.act_as_anon();
select is(current_user::text, 'anon', 'act_as_anon switches to anon');
select is(auth.jwt() ->> 'role', 'anon', 'act_as_anon sets the role claim');
select is(auth.uid(), null, 'act_as_anon leaves auth.uid() null');
select is(auth.jwt() ->> 'aal', null, 'act_as_anon sets no aal claim');
select is(auth.jwt() ->> 'sub', null, 'act_as_anon sets no sub claim');
select tests.act_as_owner();
select is(current_user::text, session_user::text, 'act_as_owner returns to session_user from anon');

-- act_as_service()
select tests.act_as_service();
select is(current_user::text, 'service_role', 'act_as_service switches to service_role');
select is(auth.jwt() ->> 'role', 'service_role', 'act_as_service sets the role claim');
select is(auth.uid(), null, 'act_as_service leaves auth.uid() null');
select tests.act_as_owner();
select is(current_user::text, session_user::text, 'act_as_owner returns to session_user from service_role');
select is(auth.jwt() ->> 'role', null, 'act_as_owner clears the role claim');

select * from finish();
rollback;
