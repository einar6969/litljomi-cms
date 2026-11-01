-- supabase/tests/database/000_harness.test.sql
begin;
\ir _helpers.sql
select plan(3);
select tests.seed();
select tests.act_as(tests.persona('editor_labak'));
select is(auth.uid(), tests.persona('editor_labak'), 'act_as sets auth.uid()');
select is(current_user::text, 'authenticated', 'act_as switches role');
select tests.act_as_owner();
select isnt(current_user::text, 'authenticated', 'act_as_owner resets role');
select * from finish();
rollback;
