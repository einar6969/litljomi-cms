-- supabase/tests/database/118_manual_order.test.sql
-- A12: manual ordering of a type's entries (20261112230000_manual_order.sql; spec §4.3, §4.5, §4.6,
-- §4.7, §5.1, §7.2):
--   1. cms.entries.order_key: nullable, no default, one check; authenticated may update it and
--      nothing else new.
--   2. api.move_entry: the catalog, the persona matrix and the truth table of its refusals, each of
--      which changes nothing.
--   3. The order: newest first until moved; a move writes the moved entry only; to the front, to
--      the end, already in place, many moves into one space, entries created in one transaction;
--      a new entry comes first after any move.
--   4. The audit event entry.moved.
--   5. api.entry_list.order_position and api.worker_release_snapshot's order_rank agree.
-- The same function over real HTTP and through a release build is in
-- apps/cms/src/privileged/worker/__tests__/manual-order.integration.test.ts.
--
-- Fixtures (owner context; tests.entry('cxxx')):
--   labak project  c181 (1 day old), c182 (2 days), c183 (3 days), c184 (4 days), all published;
--                  c185 (5 days) archived
--   labak news     c186, published
--   demo  project  c187
--   labak pair     c188, c189: created in this transaction, so with the same created_at
begin;
\ir _helpers.sql
select plan(73);

-- A move as the current role: 'ok' or the refusal as 'SQLSTATE message'.
create function tests.move_cell(p_entry uuid, p_target uuid, p_place text) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform api.move_entry(p_entry, p_target, p_place);
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
-- The live entries of a tenant's type in list order, as the editor's list reads them.
create function tests.order_of(p_tenant text, p_type text) returns uuid[]
language sql
set search_path = ''
as $$
  select array(select l.id from api.entry_list l
               where l.tenant_id = tests.tenant(p_tenant) and l.type = p_type and l.archived_at is null
               order by l.order_position, l.id)
$$;
-- The number of entry.moved events.
create function tests.moves() returns int
language sql
set search_path = ''
as $$ select count(*)::int from cms.audit_log where action = 'entry.moved' $$;
-- The order keys of the four labak projects, as text (null when never moved).
create function tests.keys() returns text
language sql
set search_path = ''
as $$
  select pg_catalog.string_agg(coalesce(e.order_key::text, '-'), ',' order by e.id)
  from cms.entries e
  where e.id in (tests.entry('c181'), tests.entry('c182'), tests.entry('c183'), tests.entry('c184'), tests.entry('c185'))
$$;
-- p_times moves of a labak project, each one read afresh: the last one to the front ('front'), or
-- the last one just after the first ('second'). Returns how many landed where they were sent.
create function tests.repeat_moves(p_kind text, p_times int) returns int
language plpgsql
set search_path = ''
as $$
declare
  v_order uuid[];
  v_moved uuid;
  v_landed int := 0;
begin
  for i in 1 .. p_times loop
    v_order := tests.order_of('labak', 'project');
    v_moved := v_order[pg_catalog.array_length(v_order, 1)];
    if p_kind = 'front' then
      if tests.move_cell(v_moved, v_order[1], 'before') = 'ok' and (tests.order_of('labak', 'project'))[1] = v_moved then
        v_landed := v_landed + 1;
      end if;
    else
      if tests.move_cell(v_moved, v_order[1], 'after') = 'ok' and (tests.order_of('labak', 'project'))[2] = v_moved then
        v_landed := v_landed + 1;
      end if;
    end if;
  end loop;
  return v_landed;
end;
$$;
grant execute on function tests.move_cell(uuid, uuid, text), tests.order_of(text, text), tests.repeat_moves(text, int)
  to anon, authenticated, service_role;

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by, created_at, archived_at) values
  (tests.entry('c181'), tests.tenant('labak'), 'project', 'a', tests.persona('editor_labak'), now() - interval '1 day', null),
  (tests.entry('c182'), tests.tenant('labak'), 'project', 'b', tests.persona('editor_labak'), now() - interval '2 days', null),
  (tests.entry('c183'), tests.tenant('labak'), 'project', 'c', tests.persona('editor_labak'), now() - interval '3 days', null),
  (tests.entry('c184'), tests.tenant('labak'), 'project', 'd', tests.persona('editor_labak'), now() - interval '4 days', null),
  (tests.entry('c185'), tests.tenant('labak'), 'project', 'e', tests.persona('editor_labak'), now() - interval '5 days', now()),
  (tests.entry('c186'), tests.tenant('labak'), 'news', 'f', tests.persona('editor_labak'), now() - interval '1 day', null),
  (tests.entry('c187'), tests.tenant('demo'), 'project', 'g', tests.persona('editor_demo'), now() - interval '1 day', null),
  (tests.entry('c188'), tests.tenant('labak'), 'pair', 'h', tests.persona('editor_labak'), now(), null),
  (tests.entry('c189'), tests.tenant('labak'), 'pair', 'i', tests.persona('editor_labak'), now(), null);
insert into cms.drafts (entry_id, tenant_id, schema_version, updated_by)
select e.id, e.tenant_id, 1, e.created_by from cms.entries e
where e.id in (tests.entry('c181'), tests.entry('c182'), tests.entry('c183'), tests.entry('c184'), tests.entry('c185'),
               tests.entry('c186'), tests.entry('c187'), tests.entry('c188'), tests.entry('c189'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
select tests.revision('d' || pg_catalog.right(e.id::text, 3)), e.tenant_id, e.id, 1, 1, '{}', e.slug, e.created_by
from cms.entries e
where e.id in (tests.entry('c181'), tests.entry('c182'), tests.entry('c183'), tests.entry('c184'), tests.entry('c186'));
update cms.entries e set published_rev_id = tests.revision('d' || pg_catalog.right(e.id::text, 3)), published_draft_version = 1,
  first_published_at = now(), last_published_at = now()
where e.id in (tests.entry('c181'), tests.entry('c182'), tests.entry('c183'), tests.entry('c184'), tests.entry('c186'));

-- ---------------------------------------------------------------------------
-- 1. The column, its check and its grant.
select col_type_is('cms', 'entries', 'order_key', 'numeric', 'entries.order_key is numeric');
select ok((select not a.attnotnull and not a.atthasdef from pg_catalog.pg_attribute a
           where a.attrelid = 'cms.entries'::regclass and a.attname = 'order_key'),
  'order_key is nullable and has no default');
select is((select convalidated from pg_catalog.pg_constraint
           where conrelid = 'cms.entries'::regclass and conname = 'entries_order_key_range'),
  true, 'the check entries_order_key_range exists and is validated');
select is((select count(*)::int from cms.entries where order_key is not null), 0, 'no entry has a key before any move');
select throws_ok($$ update cms.entries set order_key = 'NaN' where id = tests.entry('c181') $$, '23514', null,
  'the check refuses NaN, even for the owner');
select throws_ok($$ update cms.entries set order_key = 'Infinity' where id = tests.entry('c181') $$, '23514', null,
  'the check refuses an infinity');
select throws_ok($$ update cms.entries set order_key = -1e15 where id = tests.entry('c181') $$, '23514', null,
  'the check refuses a key out of range');
select throws_ok($$ update cms.entries set order_key = round(1, 1001) where id = tests.entry('c181') $$, '23514', null,
  'the check refuses a key with more than 1,000 decimal places');
select lives_ok($$ update cms.entries set order_key = null where id = tests.entry('c181') $$, 'null passes the check');

-- §4.5: one more UPDATE column for authenticated, nothing new on INSERT (030 pins the same list).
select set_eq($$ select * from tests.column_privs('authenticated', 'cms.entries') $$,
  $$ values ('tenant_id', 'INSERT'), ('type', 'INSERT'), ('slug', 'INSERT'), ('created_by', 'INSERT'), ('singleton', 'INSERT'),
            ('slug', 'UPDATE'), ('archived_at', 'UPDATE'), ('order_key', 'UPDATE') $$,
  'authenticated: update (slug, archived_at, order_key) on entries, insert unchanged');
select ok(not has_column_privilege('service_role', 'cms.entries', 'order_key', 'update')
          and not has_column_privilege('anon', 'cms.entries', 'order_key', 'select'),
  'service_role cannot set order_key; anon cannot read it');

-- ---------------------------------------------------------------------------
-- 2. api.move_entry: catalog.
select is(pg_catalog.pg_get_function_result('api.move_entry(uuid,uuid,text)'::regprocedure), 'void', 'move_entry returns void');
select is(pg_catalog.pg_get_function_arguments('api.move_entry(uuid,uuid,text)'::regprocedure),
  'p_entry_id uuid, p_target_id uuid, p_place text', 'move_entry: its arguments');
select ok((select not p.prosecdef and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
           where p.oid = 'api.move_entry(uuid,uuid,text)'::regprocedure),
  'move_entry is SECURITY INVOKER with search_path = ''''');
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'api.move_entry(uuid,uuid,text)'::regprocedure $$,
  $$ values ('postgres', 'EXECUTE'), ('authenticated', 'EXECUTE') $$,
  'move_entry: EXECUTE for the owner and authenticated only');
select is((select count(*)::int from pg_catalog.pg_proc p
           where p.oid in ('api.worker_release_snapshot(uuid)'::regprocedure, 'private.audit_entries()'::regprocedure)
             and not p.prosecdef and p.proconfig = array['search_path=""']), 2,
  'the replaced functions stay SECURITY INVOKER with search_path = ''''');
select ok(has_function_privilege('service_role', 'api.worker_release_snapshot(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'api.worker_release_snapshot(uuid)', 'execute'),
  'worker_release_snapshot keeps its grants');

-- ---------------------------------------------------------------------------
-- 3. The order before any move: newest first, archived left out.
select is(tests.order_of('labak', 'project'), array[tests.entry('c181'), tests.entry('c182'), tests.entry('c183'), tests.entry('c184')],
  'unmoved entries are listed newest first; the archived one is not listed');
select isnt((select order_position from api.entry_list where id = tests.entry('c188')),
            (select order_position from api.entry_list where id = tests.entry('c189')),
  'two entries created in one transaction still have different positions');

-- ---------------------------------------------------------------------------
-- 2. The persona matrix and the truth table. Every refusal leaves keys, order and audit alone.
select tests.act_as(tests.persona('editor_demo'));
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), 'P0001 not_found',
  'editor_demo cannot move a labak entry: not_found');
select tests.act_as(tests.persona('outsider'));
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), 'P0001 not_found', 'outsider: not_found');
select tests.act_as(tests.persona('revoked'));
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), 'P0001 not_found', 'a revoked member: not_found');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), 'P0001 not_found',
  'a platform admin at aal2 has no content access: not_found');
select tests.act_as_anon();
select like(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), '42501 %', 'anon: 42501');
select tests.act_as_service();
select like(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), '42501 %', 'service_role: 42501');

select tests.act_as(tests.persona('editor_labak'));
select is(tests.move_cell(tests.entry('c184'), tests.entry('c187'), 'before'), 'P0001 not_found',
  'a target in a tenant the editor is not a member of: not_found');
select is(tests.move_cell(tests.entry('c187'), tests.entry('c184'), 'before'), 'P0001 not_found',
  'moving an entry of a tenant the editor is not a member of: not_found');
select is(tests.move_cell(gen_random_uuid(), tests.entry('c181'), 'before'), 'P0001 not_found', 'an unknown entry: not_found');
select is(tests.move_cell(tests.entry('c184'), gen_random_uuid(), 'before'), 'P0001 not_found', 'an unknown target: not_found');
select is(tests.move_cell(null, tests.entry('c181'), 'before'), 'P0001 not_found', 'a null entry: not_found');
select is(tests.move_cell(tests.entry('c184'), null, 'before'), 'P0001 not_found', 'a null target: not_found');
select is(tests.move_cell(tests.entry('c184'), tests.entry('c186'), 'before'), 'P0001 forbidden',
  'a target of another type: forbidden');
select is(tests.move_cell(tests.entry('c184'), tests.entry('c184'), 'before'), 'P0001 forbidden', 'the entry itself: forbidden');
select is(tests.move_cell(tests.entry('c185'), tests.entry('c181'), 'before'), 'P0001 forbidden', 'an archived entry: forbidden');
select is(tests.move_cell(tests.entry('c184'), tests.entry('c185'), 'after'), 'P0001 forbidden', 'an archived target: forbidden');
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'above'), '22023 p_place must be before or after',
  'a place other than before or after: 22023');
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), null), '22023 p_place must be before or after',
  'a null place: 22023');

-- A member of both tenants still cannot move across them.
select tests.act_as_owner();
insert into cms.memberships (tenant_id, user_id) values (tests.tenant('demo'), tests.persona('editor_labak'));
select tests.act_as(tests.persona('editor_labak'));
select is(tests.move_cell(tests.entry('c184'), tests.entry('c187'), 'before'), 'P0001 forbidden',
  'a member of both tenants: a target of the other tenant is forbidden');
select is(tests.move_cell(tests.entry('c187'), tests.entry('c184'), 'after'), 'P0001 forbidden',
  'a member of both tenants: an entry of the other tenant before a labak one is forbidden');
select tests.act_as_owner();
delete from cms.memberships where tenant_id = tests.tenant('demo') and user_id = tests.persona('editor_labak');

-- A suspended tenant.
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as(tests.persona('editor_labak'));
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), 'P0001 tenant_inactive',
  'a suspended tenant: tenant_inactive');
select tests.act_as_owner();
update cms.tenants set status = 'active' where id = tests.tenant('labak');

select is(tests.keys(), '-,-,-,-,-', 'no refusal wrote a key');
select is(tests.moves(), 0, 'no refusal was audited');
select is(tests.order_of('labak', 'project'), array[tests.entry('c181'), tests.entry('c182'), tests.entry('c183'), tests.entry('c184')],
  'the order is unchanged');

-- The editor has no other way to change the order: created_at is not theirs to write.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ update cms.entries set created_at = now() where id = tests.entry('c184') $$, '42501', null,
  'an editor cannot rewrite created_at, which orders unmoved entries');

-- ---------------------------------------------------------------------------
-- 3. Moves.
select is(tests.move_cell(tests.entry('c184'), tests.entry('c181'), 'before'), 'ok', 'editor_labak moves c184 to the front');
select is(tests.order_of('labak', 'project'), array[tests.entry('c184'), tests.entry('c181'), tests.entry('c182'), tests.entry('c183')],
  'c184 is first, the rest keep their order');
select tests.act_as_owner();
select is((select array_agg(e.id order by e.id) from cms.entries e where e.order_key is not null), array[tests.entry('c184')],
  'only the moved entry has a key: no other row was written');

-- 4. Audit.
select results_eq($$ select actor_id, tenant_id, target_type, target_id, details ->> 'from', (details ->> 'to')::numeric
     from cms.audit_log where action = 'entry.moved' $$,
  $$ select tests.persona('editor_labak'), tests.tenant('labak'), 'entry'::text, tests.entry('c184'), null::text, e.order_key
     from cms.entries e where e.id = tests.entry('c184') $$,
  'entry.moved: the editor as actor, the entry, and its key from none to the new one');

select tests.act_as(tests.persona('editor_labak'));
select is(tests.move_cell(tests.entry('c181'), tests.entry('c183'), 'after'), 'ok', 'c181 moves after c183, the last');
select is(tests.order_of('labak', 'project'), array[tests.entry('c184'), tests.entry('c182'), tests.entry('c183'), tests.entry('c181')],
  'c181 is last');
select tests.act_as_owner();
select is(tests.moves(), 2, 'each move is audited');

-- Already in place: nothing is written.
select tests.act_as(tests.persona('editor_labak'));
select is(tests.move_cell(tests.entry('c182'), tests.entry('c184'), 'after'), 'ok', 'c182 asked to go where it already is');
select is(tests.move_cell(tests.entry('c182'), tests.entry('c183'), 'before'), 'ok', 'the same place, named from the other side');
select tests.act_as_owner();
select is((select order_key from cms.entries where id = tests.entry('c182')), null, 'an entry already in place keeps having no key');
select is(tests.moves(), 2, 'and nothing is audited');

-- Between two moved entries, and between a moved and an unmoved one.
select tests.act_as(tests.persona('editor_labak'));
select is(tests.move_cell(tests.entry('c183'), tests.entry('c184'), 'before'), 'ok', 'c183 to the front, before moved c184');
select is(tests.move_cell(tests.entry('c182'), tests.entry('c184'), 'before'), 'ok', 'c182 between c183 and c184, both moved');
select is(tests.order_of('labak', 'project'), array[tests.entry('c183'), tests.entry('c182'), tests.entry('c184'), tests.entry('c181')],
  'the order after four moves');

-- A new entry comes first after any move. created_at is the creating transaction's start, so a
-- later transaction is stood in for by a created_at after this moment.
select tests.act_as_owner();
insert into cms.entries (id, tenant_id, type, slug, created_by, created_at) values
  (tests.entry('c18a'), tests.tenant('labak'), 'project', 'j', tests.persona('editor_labak'), clock_timestamp() + interval '1 millisecond');
insert into cms.drafts (entry_id, tenant_id, schema_version, updated_by) values
  (tests.entry('c18a'), tests.tenant('labak'), 1, tests.persona('editor_labak'));
select is((tests.order_of('labak', 'project'))[1], tests.entry('c18a'), 'a new entry comes first, before the moved ones');

-- Twenty moves of the last entry to the front: each lands first, and a newer entry still beats them.
select tests.act_as(tests.persona('editor_labak'));
select is(tests.repeat_moves('front', 20), 20, 'twenty moves of the last entry to the front each put it first');
select tests.act_as_owner();
insert into cms.entries (id, tenant_id, type, slug, created_by, created_at) values
  (tests.entry('c18b'), tests.tenant('labak'), 'project', 'k', tests.persona('editor_labak'), clock_timestamp() + interval '1 millisecond');
insert into cms.drafts (entry_id, tenant_id, schema_version, updated_by) values
  (tests.entry('c18b'), tests.tenant('labak'), 1, tests.persona('editor_labak'));
select is((tests.order_of('labak', 'project'))[1], tests.entry('c18b'), 'after twenty moves to the front, a new entry still comes first');

-- Forty moves into the same tightening space (the last entry, each time, just after the first):
-- each lands second, and the keys stay short.
select tests.act_as(tests.persona('editor_labak'));
select is(tests.repeat_moves('second', 40), 40, 'forty moves into one space each put the entry second');
select tests.act_as_owner();
select cmp_ok((select max(pg_catalog.scale(order_key)) from cms.entries where tenant_id = tests.tenant('labak')), '<', 40,
  'after forty moves into one space, no key has 40 decimal places');
select is((select count(distinct order_position)::int from api.entry_list where tenant_id = tests.tenant('labak') and type = 'project'),
  (select count(*)::int from api.entry_list where tenant_id = tests.tenant('labak') and type = 'project'),
  'every position of the type is distinct');

-- Entries created in one transaction can be moved past each other.
select is(tests.order_of('labak', 'pair'), array[tests.entry('c188'), tests.entry('c189')],
  'two entries created in one transaction: the one whose id ends lower first');
select tests.act_as(tests.persona('editor_labak'));
select is(tests.move_cell(tests.entry('c189'), tests.entry('c188'), 'before'), 'ok',
  'the second of two entries created in one transaction moves before the first');
select is(tests.order_of('labak', 'pair'), array[tests.entry('c189'), tests.entry('c188')], 'their order is reversed');

-- Moves of one type leave every other type and tenant alone.
select tests.act_as_owner();
select is((select count(*)::int from cms.entries where order_key is not null and (type <> 'project' and type <> 'pair')), 0,
  'no entry of another type has a key');
select is((select count(*)::int from cms.entries where order_key is not null and tenant_id = tests.tenant('demo')), 0,
  'no demo entry has a key');

-- ---------------------------------------------------------------------------
-- 5. The snapshot's order_rank agrees with the list.
create table tests.rel (id uuid);
create table tests.snap (j jsonb);
grant select on tests.rel to service_role;
grant insert, select on tests.snap to service_role;
insert into tests.rel values (gen_random_uuid());
insert into cms.releases (id, tenant_id, number, status) select r.id, tests.tenant('labak'), 9181, 'building' from tests.rel r;
select tests.act_as_service();
insert into tests.snap select api.worker_release_snapshot((select id from tests.rel));
select tests.act_as_owner();
select is(array(select (x ->> 'entry_id')::uuid from tests.snap, jsonb_array_elements(j -> 'entries') as x
                where x ->> 'type' = 'project' order by (x ->> 'order_rank')::int),
  array(select l.id from api.entry_list l
        where l.tenant_id = tests.tenant('labak') and l.type = 'project' and l.status = 'published'
        order by l.order_position, l.id),
  'the snapshot''s order_rank lists the published projects in the list''s order');
select is(array(select (x ->> 'order_rank')::int from tests.snap, jsonb_array_elements(j -> 'entries') as x
                where x ->> 'type' = 'project' order by (x ->> 'order_rank')::int),
  array[1, 2, 3, 4], 'the ranks of a type count from 1 without gaps');
select is((select (x ->> 'order_rank')::int from tests.snap, jsonb_array_elements(j -> 'entries') as x where x ->> 'type' = 'news'), 1,
  'each type is ranked on its own');
select is(array(select (x ->> 'entry_id')::uuid from tests.snap, jsonb_array_elements(j -> 'entries') as x),
  array(select (x ->> 'entry_id')::uuid from tests.snap, jsonb_array_elements(j -> 'entries') as x order by x ->> 'type', (x ->> 'entry_id')::uuid),
  'the entries array keeps its order, by type and entry id');

select * from finish();
rollback;
