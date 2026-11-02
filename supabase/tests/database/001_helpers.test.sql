-- supabase/tests/database/001_helpers.test.sql
-- Covers every helper in _helpers.sql (000_harness.test.sql covers the main path).
begin;
\ir _helpers.sql
select plan(37);

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
        unnest(array['tests.persona(text)', 'tests.tenant(text)', 'tests.act_as(uuid,text)',
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
