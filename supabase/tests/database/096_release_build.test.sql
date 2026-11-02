-- supabase/tests/database/096_release_build.test.sql
-- Task 20's database change (spec §5.6, §7.1, §7.4; plan Task 20, decision 35; deferred Minor
-- Task 11 security r1 Minor 2): api.worker_finish_release requires a bundle path for a delivered
-- release, and a failed release links no requests and no assets. The rest of the function's rules
-- are pinned in 090_api_worker; its grants in 010_catalog and 100_escalation.
--
-- Fixtures (owner context): entry c961 (labak, draft v1), committed request e961 for it, asset
-- f961 (labak), and labak releases started through api.worker_begin_release.
begin;
\ir _helpers.sql
select plan(17);

create function tests.pub(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^e[0-9a-f]{3}$' then
    raise exception 'unknown publishing key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;
create function tests.asset(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^f[0-9a-f]{3}$' then
    raise exception 'unknown asset key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;
grant execute on function tests.pub(text), tests.asset(text) to anon, authenticated, service_role;
create table tests.ids (name text primary key, id uuid);
grant select, insert on tests.ids to service_role;

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c961'), tests.tenant('labak'), 'news', 'frett', tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, updated_by) values
  (tests.entry('c961'), tests.tenant('labak'), 1, tests.persona('editor_labak'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status)
values (tests.pub('e961'), tests.tenant('labak'), tests.entry('c961'), 'unpublish', null, tests.persona('editor_labak'), 'committed');
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by)
values (tests.asset('f961'), tests.tenant('labak'), tests.tenant('labak') || '/' || tests.asset('f961') || '/a.jpg', 'a.jpg',
        'image/jpeg', 1000, 800, 600, repeat('a', 64), tests.persona('editor_labak'));

select tests.act_as_service();
select lives_ok($$ insert into tests.ids select 'r1', r.id from api.worker_begin_release(tests.tenant('labak')) as r $$,
  'a labak release is started');

-- Delivered needs the bundle path.
select throws_ok($$ select api.worker_finish_release((select id from tests.ids where name = 'r1'), 'delivered', null, null,
                    array[tests.pub('e961')], null) $$,
  '22023', 'p_bundle_path is required for a delivered release', 'delivered with a null bundle path is refused (22023)');

-- Failed links nothing.
select throws_ok($$ select api.worker_finish_release((select id from tests.ids where name = 'r1'), 'failed', null,
                    '{"code": "build_failed"}', array[tests.pub('e961')], null) $$,
  '22023', 'a failed release links no requests and no assets', 'failed with request ids is refused (22023)');
select throws_ok($$ select api.worker_finish_release((select id from tests.ids where name = 'r1'), 'failed', null,
                    '{"code": "build_failed"}', null,
                    jsonb_build_array(jsonb_build_object('id', tests.asset('f961'),
                      'public_path', 'labak/' || tests.asset('f961') || '/a.jpg'))) $$,
  '22023', 'a failed release links no requests and no assets', 'failed with public assets is refused (22023)');
select throws_ok($$ select api.worker_finish_release((select id from tests.ids where name = 'r1'), 'failed',
                    'labak/releases/1.json', '{"code": "build_failed"}', array[tests.pub('e961')], '[]') $$,
  '22023', 'a failed release links no requests and no assets', 'also with a bundle path and an empty asset array');
select tests.act_as_owner();
select is((select row(r.status, r.bundle_path, r.error)::text from cms.releases r where r.id = (select id from tests.ids where name = 'r1')),
  row('building', null::text, null::jsonb)::text, 'the refused calls left the release building');
select is((select release_id from cms.publish_requests where id = tests.pub('e961')), null, 'and the request in no release');
select is((select public_path from cms.assets where id = tests.asset('f961')), null, 'and the asset not public');

-- A failed release with empty or null links is accepted, and the request waits for the next build.
select tests.act_as_service();
select lives_ok($$ select api.worker_finish_release((select id from tests.ids where name = 'r1'), 'failed', null,
                    '{"code": "build_failed", "step": "pointer_upload", "pointerWritten": false}', '{}', '[]') $$,
  'failed with empty request ids and assets is accepted');
select tests.act_as_owner();
select is((select row(r.status, r.bundle_path, r.delivered_at, r.error)::text from cms.releases r
           where r.id = (select id from tests.ids where name = 'r1')),
  row('failed', null::text, null::timestamptz, '{"code": "build_failed", "step": "pointer_upload", "pointerWritten": false}'::jsonb)::text,
  'the release is failed with its error');
select tests.act_as_service();
select is((select id from api.worker_previous_release(tests.tenant('labak'))), null, 'a failed release is never the previous release');
select lives_ok($$ insert into tests.ids select 'r2', r.id from api.worker_begin_release(tests.tenant('labak')) as r $$,
  'the next build starts');
select is(array(select (x ->> 'id')::uuid from jsonb_array_elements(
             api.worker_release_snapshot((select id from tests.ids where name = 'r2')) -> 'requests') as x),
  array[tests.pub('e961')], 'the request of the failed build is in the next snapshot');

-- Delivered with its bundle path links the request and the asset.
select lives_ok($$ select api.worker_finish_release((select id from tests.ids where name = 'r2'), 'delivered',
                    'labak/releases/2.json', null, array[tests.pub('e961')],
                    jsonb_build_array(jsonb_build_object('id', tests.asset('f961'),
                      'public_path', 'labak/' || tests.asset('f961') || '/a.jpg'))) $$,
  'delivered with its bundle path is accepted');
select tests.act_as_owner();
select is((select row(r.status, r.bundle_path)::text from cms.releases r where r.id = (select id from tests.ids where name = 'r2')),
  row('delivered', 'labak/releases/2.json')::text, 'the release is delivered with its bundle path');
select is((select release_id from cms.publish_requests where id = tests.pub('e961')), (select id from tests.ids where name = 'r2'),
  'the request is in the delivered release');
select is((select public_path from cms.assets where id = tests.asset('f961')), 'labak/' || tests.asset('f961') || '/a.jpg',
  'the asset has its public path');

select * from finish();
rollback;
