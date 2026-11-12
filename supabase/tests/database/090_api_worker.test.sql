-- supabase/tests/database/090_api_worker.test.sql
-- The worker's and the CLI's api functions (spec §4.3, §4.5, §4.6, §6.1–6.3,
-- §7.1, §7.4, §8.2; plan Task 11, decisions 3, 4, 5, 10, 11 and 12;
-- "Exactness: what M1 proves"; gate A9). Single-session; the concurrent cases
-- are in Task 12 (tests/integration). Who may call these functions is pinned in
-- 010_catalog and 100_escalation.
--
-- Personas and tenants come from tests.seed() (_helpers.sql): editor_labak and
-- editor_demo are members of labak and demo; revoked was a labak member and is
-- not any more; outsider is a member of nothing.
--
-- Fixture rows (owner context; tests.asset('f901'), tests.pub('e901') give
-- 00000000-0000-4000-8000-00000000f901 and ...e901):
--   asset    f901 labak a.jpg; f902 labak archived; f903 labak, archived after
--            c926 published it; f904 demo; f905 labak; f906 labak with focal
--            point, default alt and a public path (cleared after its read)
--   entry    (all news; labak unless marked demo)
--            c901, c902, c905 (demo): targets of the claim requests
--            c906  draft {pub: ->c907, unpub: ->c908, img: ->f901, old: ->f902}
--            c907  slug tilvisun, published d907 titled Birt (first/last 2020-01-01)
--            c908  never published
--            c910  draft v3 {title, link ->c907, image ->f901, list[0].x ->c907}
--            c911  draft without references, plus a forged draft_refs row (->c908)
--            c912  draft {rel ->c908}, its draft_refs rows deleted
--            c913  published d913 (first/last 2020-01-01), draft v2
--            c914  draft v3
--            c917  draft v1 (requested by revoked)
--            c918  draft {rel ->c908}; c919 draft {image ->f902}; c920 draft {self ->c920}
--            c921  demo, draft v1
--            c925  published d925, then archived
--            c926  published d926 {image ->f903}
--            c927  draft {rel ->c925}
--            c930  draft {img ->f906, other ->f904 (demo), other_entry ->c905 (demo)},
--                  the demo references written with the refs trigger disabled
--   release  e931 labak 1 delivered; e932 labak 2 failed
--   site     e941 labak (a webhook_secret_ref with no Vault secret)
--   requests e901–e905 for the claim tests; e906–e934 below, each described
--            where it is used (e930: pending, c930, for the extended read)
--            where it is used.
-- Assertions depend on earlier ones, in file order.
begin;
\ir _helpers.sql
select plan(163);

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
-- A reference object (§4.3).
create function tests.ref(p_id uuid, p_kind text) returns jsonb
language sql
set search_path = ''
as $$ select pg_catalog.jsonb_build_object('_ref', p_id, '_kind', p_kind) $$;
grant execute on function tests.asset(text), tests.pub(text), tests.ref(uuid, text)
  to anon, authenticated, service_role;

-- Ids returned by the functions under test, kept for later assertions.
create temporary table ids (name text primary key, id uuid) on commit drop;
grant select, insert on ids to service_role;

-- ---------------------------------------------------------------------------
-- Interfaces (plan Task 11): every function exists with its signature and
-- return type. Grants are pinned in 010_catalog.
select is_empty($$ select s from unnest(array[
    'api.worker_claim_requests(integer)',
    'api.worker_read_request(uuid)',
    'api.worker_commit_publish(uuid,integer,integer,text,timestamp with time zone)',
    'api.worker_commit_unpublish(uuid)',
    'api.worker_reject_request(uuid,text,jsonb)',
    'api.worker_begin_release(uuid)',
    'api.worker_release_snapshot(uuid)',
    'api.worker_finish_release(uuid,text,text,jsonb,uuid[],jsonb)',
    'api.worker_previous_release(uuid)',
    'api.worker_sites(uuid)',
    'api.worker_record_delivery(uuid,uuid,text,text,jsonb,timestamp with time zone)',
    'api.admin_create_tenant(text,text)',
    'api.admin_create_site(uuid,text,text,text,text,text)',
    'api.admin_add_membership(uuid,uuid)',
    'api.worker_claim_request(uuid)',
    'api.worker_record_alert(uuid,text,jsonb)']) as s where to_regprocedure(s) is null $$,
  'all sixteen worker and admin functions exist with the Interfaces'' signatures (Task 11, and Task 19''s two; M3-02''s p_now on worker_record_delivery; M3-10''s p_preview_secret on admin_create_site)');
select set_eq($$ select p.proname::text, pg_catalog.pg_get_function_result(p.oid) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'api' and (p.proname like 'worker\_%' or p.proname like 'admin\_%') $$,
  $$ values ('worker_claim_requests', 'SETOF cms.publish_requests'), ('worker_read_request', 'jsonb'),
            ('worker_commit_publish', 'text'), ('worker_commit_unpublish', 'text'),
            ('worker_reject_request', 'void'), ('worker_begin_release', 'cms.releases'),
            ('worker_release_snapshot', 'jsonb'), ('worker_finish_release', 'void'),
            ('worker_previous_release', 'cms.releases'),
            ('worker_sites', 'TABLE(id uuid, base_url text, revalidate_url text, webhook_secrets text[])'),
            ('worker_record_delivery', 'TABLE(notify_attempts integer, next_attempt_at timestamp with time zone, retries_exhausted boolean)'),
            ('admin_create_tenant', 'uuid'), ('admin_create_site', 'uuid'),
            ('admin_add_membership', 'void'), ('worker_claim_request', 'cms.publish_requests'),
            ('worker_record_alert', 'void'),
            -- M3-10 (103_preview_secrets).
            ('worker_preview_sites', 'TABLE(id uuid, preview_url text, preview_secret text)'),
            ('admin_set_preview_secret', 'void'),
            -- fix/preview-url (110_preview_url).
            ('admin_set_preview_url', 'void'),
            -- M3-11 (107_preview_endpoint).
            ('worker_preview_tenant', 'uuid'),
            ('worker_preview_draft', 'jsonb'),
            -- Task 21 (097_worker_sweep); its unconfirmed_* columns from Thread E (110_housekeeping_retry_hold).
            ('worker_tenants_to_release', 'TABLE(tenant_id uuid, unconfirmed_release_id uuid, unconfirmed_release_number integer, unconfirmed_site_ids uuid[])'),
            -- M3-02 (102_retry_backoff).
            ('worker_next_attempt_at', 'timestamp with time zone'),
            ('worker_release_retry', 'TABLE(status text, next_attempt_at timestamp with time zone, retries_exhausted boolean)'),
            -- notify_release_number and withdrawal from W1 (112_withdrawal_confirmation).
            ('worker_deliveries_to_retry', 'TABLE(release_id uuid, tenant_id uuid, tenant_slug text, release_number integer, bundle_path text, previous_bundle_path text, site_id uuid, notify_status text, notify_attempts integer, live_status text, requests jsonb, notify_release_number integer, withdrawal jsonb)'),
            -- Task 30 (098_worker_recovery).
            ('worker_fail_stale_releases', 'TABLE(release_id uuid, tenant_id uuid, number integer, created_at timestamp with time zone)'),
            ('worker_pointer_check', 'TABLE(building boolean, latest_delivered integer)'),
            -- M3-07 (103_asset_trust).
            ('worker_asset_metadata', 'TABLE(id uuid, original_path text, mime text, bytes bigint, width integer, height integer, sha256 text)'),
            ('worker_private_orphans', 'TABLE(name text, created_at timestamp with time zone)'),
            -- M3-06 (105_retention).
            ('worker_record_release_media', 'TABLE(asset_id uuid, copy boolean, deleting boolean)'),
            ('worker_claim_release_cleanup', 'TABLE(release_id uuid, tenant_id uuid, tenant_slug text, release_number integer, asset_id uuid, filename text)'),
            ('worker_finish_release_cleanup', 'integer'),
            -- M3-08 (107_pointer_lag).
            ('worker_record_pointer_lag', 'boolean'),
            -- M5-01 (115_withdrawal_safety).
            ('worker_entry_was_delivered', 'boolean'),
            -- M2-13 (104_draft_migration).
            ('admin_outdated_drafts', 'TABLE(entry_id uuid, version integer, schema_version integer, data jsonb)'),
            ('admin_migrate_draft', 'integer'),
            -- M3-04 (105_alert_email).
            ('worker_claim_alert_email', 'boolean'),
            -- M4-01 (113_m4_admin).
            ('admin_set_webhook_secret', 'void'),
            ('admin_set_tenant_status', 'void'),
            ('admin_remove_membership', 'void') $$,
  'worker and admin functions: return types, and no others');
select is((select pg_catalog.pg_get_function_arguments('api.worker_claim_requests(integer)'::regprocedure)),
  'p_limit integer DEFAULT 10', 'worker_claim_requests: p_limit defaults to 10');
-- The commit copies the data from cms.drafts (§6.2 step 2): no parameter carries it.
select is_empty($$ select 1 from pg_catalog.pg_proc p
     where p.oid = 'api.worker_commit_publish(uuid,integer,integer,text,timestamp with time zone)'::regprocedure
       and 'jsonb'::regtype = any (p.proargtypes::oid[]) $$,
  'worker_commit_publish takes no jsonb parameter: the committed data never comes from the caller');
-- Locking clauses (§6.2 step 1, plan Task 11). This regex is only a backstop
-- (it would also match a comment); the real test of skip locked is Task 12's
-- concurrent claim. The commit's lock modes are tested below with pgrowlocks.
select ok((select prosrc ~* 'for update skip locked' from pg_catalog.pg_proc
           where oid = 'api.worker_claim_requests(integer)'::regprocedure),
  'worker_claim_requests claims with for update skip locked');

-- ---------------------------------------------------------------------------
-- Fixtures (owner context).
-- pgrowlocks reads row lock modes for the commit's lock assertions; created in
-- this transaction, it is rolled back with it.
create extension pgrowlocks with schema extensions;
select tests.seed();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by, archived_at)
select tests.asset(k), tests.tenant(t), tests.tenant(t)::text || '/' || tests.asset(k)::text || '/' || f, f, m,
       1000, 800, 600, repeat(substr(k, 4, 1), 64), tests.persona('editor_' || t), a
from (values ('f901', 'labak', 'a.jpg', 'image/jpeg', null::timestamptz),
             ('f902', 'labak', 'b.jpg', 'image/jpeg', now()),
             ('f903', 'labak', 'c.png', 'image/png', null),
             ('f904', 'demo', 'd.jpg', 'image/jpeg', null),
             ('f905', 'labak', 'e.webp', 'image/webp', null)) as v(k, t, f, m, a);
insert into cms.entries (id, tenant_id, type, slug, created_by)
select tests.entry(k), tests.tenant(t), 'news', s, tests.persona('editor_' || t)
from (values ('c901', 'labak', null), ('c902', 'labak', null), ('c905', 'demo', null), ('c906', 'labak', null),
             ('c907', 'labak', 'tilvisun'), ('c908', 'labak', null), ('c910', 'labak', 'nakvaem'),
             ('c911', 'labak', null), ('c912', 'labak', null), ('c913', 'labak', 'eldri'), ('c914', 'labak', null),
             ('c917', 'labak', null), ('c918', 'labak', null), ('c919', 'labak', null), ('c920', 'labak', null),
             ('c921', 'demo', null), ('c925', 'labak', 'safnad'), ('c926', 'labak', 'mynd'),
             ('c927', 'labak', null)) as v(k, t, s);
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by)
select tests.entry(k), tests.tenant(t), 1, d, tests.persona('editor_' || t)
from (values
  ('c901', 'labak', '{}'::jsonb), ('c902', 'labak', '{}'), ('c905', 'demo', '{}'),
  ('c906', 'labak', jsonb_build_object('pub', tests.ref(tests.entry('c907'), 'entry'),
                                       'unpub', tests.ref(tests.entry('c908'), 'entry'),
                                       'img', tests.ref(tests.asset('f901'), 'asset'),
                                       'old', tests.ref(tests.asset('f902'), 'asset'))),
  ('c907', 'labak', '{}'), ('c908', 'labak', '{}'), ('c910', 'labak', '{}'),
  ('c911', 'labak', '{"title": "Engar tilvísanir"}'),
  ('c912', 'labak', jsonb_build_object('rel', tests.ref(tests.entry('c908'), 'entry'))),
  ('c913', 'labak', '{}'), ('c914', 'labak', '{}'), ('c917', 'labak', '{}'),
  ('c918', 'labak', jsonb_build_object('rel', tests.ref(tests.entry('c908'), 'entry'))),
  ('c919', 'labak', jsonb_build_object('image', tests.ref(tests.asset('f902'), 'asset'))),
  ('c920', 'labak', jsonb_build_object('self', tests.ref(tests.entry('c920'), 'entry'))),
  ('c921', 'demo', '{}'), ('c925', 'labak', '{}'),
  ('c926', 'labak', jsonb_build_object('image', tests.ref(tests.asset('f903'), 'asset'))),
  ('c927', 'labak', jsonb_build_object('rel', tests.ref(tests.entry('c925'), 'entry')))) as v(k, t, d);
-- c910 at version 3 with the data that will be committed.
update cms.drafts set data = '{"title": "v2"}' where entry_id = tests.entry('c910');
update cms.drafts set data = jsonb_build_object(
    'title', 'Nákvæm',
    'link', tests.ref(tests.entry('c907'), 'entry'),
    'image', tests.ref(tests.asset('f901'), 'asset') || '{"alt": "Brauð"}',
    'list', jsonb_build_array(jsonb_build_object('x', tests.ref(tests.entry('c907'), 'entry')))),
  title = 'Drög'
  where entry_id = tests.entry('c910');
-- c914 at version 3.
update cms.drafts set data = '{"n": 2}' where entry_id = tests.entry('c914');
update cms.drafts set data = '{"n": 3}' where entry_id = tests.entry('c914');
-- Published entries.
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
select tests.revision(r), tests.tenant('labak'), tests.entry(e), 1, 1, d, ti, tests.persona('editor_labak')
from (values ('d907', 'c907', '{}'::jsonb, 'Birt'), ('d913', 'c913', '{}', null), ('d925', 'c925', '{}', null),
             ('d926', 'c926', jsonb_build_object('image', tests.ref(tests.asset('f903'), 'asset')), null))
  as v(r, e, d, ti);
update cms.entries e set published_rev_id = tests.revision('d' || substr(k, 2)), published_draft_version = 1,
  first_published_at = case when k in ('c907', 'c913') then '2020-01-01 00:00:00+00'::timestamptz else now() end,
  last_published_at = case when k in ('c907', 'c913') then '2020-01-01 00:00:00+00'::timestamptz else now() end
from (values ('c907'), ('c913'), ('c925'), ('c926')) as v(k)
where e.id = tests.entry(k);
update cms.entries set archived_at = now() where id = tests.entry('c925');
update cms.assets set archived_at = now() where id = tests.asset('f903');
update cms.drafts set data = '{"title": "Ný útgáfa"}' where entry_id = tests.entry('c913');
-- Forged draft_refs (editors hold insert and delete on draft_refs, §4.5): the
-- commit must not trust them (Task 7 security r1, Minor 1).
insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id)
values (tests.tenant('labak'), tests.entry('c911'), '$."forged"', tests.entry('c908')),
       (tests.tenant('labak'), tests.entry('c906'), '$."forged"', tests.entry('c908'));
delete from cms.draft_refs where entry_id = tests.entry('c912');
insert into cms.releases (id, tenant_id, number, status, delivered_at) values
  (tests.pub('e931'), tests.tenant('labak'), 1, 'delivered', now() - interval '1 day'),
  (tests.pub('e932'), tests.tenant('labak'), 2, 'failed', null);
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref) values
  (tests.pub('e941'), tests.tenant('labak'), 'http://localhost:3100', 'http://localhost:3100/api/cms/revalidate',
   tests.pub('e9f1'));

-- ---------------------------------------------------------------------------
-- worker_claim_requests (§6.1, §6.3).
--   e902 validating, claimed 10 minutes ago (stale), requested 20 minutes ago
--   e903 validating, claimed 1 minute ago, requested 18 minutes ago
--   e901 pending, requested 15 minutes ago
--   e905 pending (demo), requested 10 minutes ago
--   e904 committed, in release e931
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  claimed_at, attempts, release_id) values
  (tests.pub('e901'), tests.tenant('labak'), tests.entry('c901'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '15 minutes', 'pending', null, 0, null),
  (tests.pub('e902'), tests.tenant('labak'), tests.entry('c902'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '20 minutes', 'validating', now() - interval '10 minutes', 1, null),
  (tests.pub('e903'), tests.tenant('labak'), tests.entry('c902'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '18 minutes', 'validating', now() - interval '1 minute', 1, null),
  (tests.pub('e904'), tests.tenant('labak'), tests.entry('c901'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '30 minutes', 'committed', now() - interval '29 minutes', 1, tests.pub('e931')),
  (tests.pub('e905'), tests.tenant('demo'), tests.entry('c905'), 'publish', 1, tests.persona('editor_demo'),
   now() - interval '10 minutes', 'pending', null, 0, null);
select is((select count(*)::int from cms.publish_requests
           where id not in (tests.pub('e901'), tests.pub('e902'), tests.pub('e903'), tests.pub('e904'), tests.pub('e905'))),
  0, 'no other requests exist (claims see every tenant; run after db:reset)');

select tests.act_as_service();
select throws_ok($$ select * from api.worker_claim_requests(0) $$, '22023', 'p_limit must be at least 1',
  'worker_claim_requests: p_limit below 1 raises 22023');
select throws_ok($$ select * from api.worker_claim_requests(null) $$, '22023', 'p_limit must be at least 1',
  'worker_claim_requests: a null p_limit raises 22023');
select is(array(select id from api.worker_claim_requests(1)), array[tests.pub('e902')],
  'claim(1) takes the oldest claimable request: the stale validating one');
select is((select row(status, attempts, claimed_at)::text from cms.publish_requests where id = tests.pub('e902')),
  row('validating', 2, now())::text, 'a stale claim is renewed: validating, claimed now, one more attempt');
select is(array(select id from api.worker_claim_requests() order by id), array[tests.pub('e901'), tests.pub('e905')],
  'claim() takes the pending requests of every tenant, not the freshly claimed ones');
select is((select array_agg(row(id, status, attempts, claimed_at)::text order by id) from cms.publish_requests
           where id in (tests.pub('e901'), tests.pub('e905'))),
  array[row(tests.pub('e901'), 'validating', 1, now())::text, row(tests.pub('e905'), 'validating', 1, now())::text],
  'claimed requests are validating, claimed now, with one attempt');
select is((select row(status, attempts, claimed_at)::text from cms.publish_requests where id = tests.pub('e903')),
  row('validating', 1, now() - interval '1 minute')::text, 'a claim under 5 minutes old is left alone');
select is((select status from cms.publish_requests where id = tests.pub('e904')), 'committed',
  'a committed request is never claimed');
select is(array(select id from api.worker_claim_requests(10)), '{}'::uuid[], 'nothing is left to claim');
select tests.act_as_owner();
select is((select count(*)::int from cms.audit_log where target_id = tests.pub('e901')
           and action = 'publish_request.validating' and actor_id = tests.persona('editor_labak')), 1,
  'a claim is audited with the requester as actor');

-- Remaining requests (owner context), validating unless marked:
--   e906 c906 v1; e910 c910 v3; e911 c911 v1; e912 c912 v1; e913 c913 v2
--   e914 c914 v2 (stale); e915 c914 v3; e916 c914 v3; e917 c917 v1 by revoked
--   e918 c918 v1; e919 c919 v1; e920 c920 v1
--   e921 demo c921 v1; e922 demo c921 unpublish
--   e923 c907 unpublish; e924 c913 unpublish by revoked
--   e925 c908 v1 pending; e927 and e928 c908 v1; e929 c927 v1
--   e933 demo c921 committed (no release); e934 demo c921 unpublish
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, claimed_at, attempts)
select tests.pub(r), tests.tenant(t), tests.entry(e), a, v, tests.persona(p), s,
       case when s = 'pending' then null else now() end, case when s = 'pending' then 0 else 1 end
from (values
  ('e906', 'labak', 'c906', 'publish', 1, 'editor_labak', 'validating'),
  ('e910', 'labak', 'c910', 'publish', 3, 'editor_labak', 'validating'),
  ('e911', 'labak', 'c911', 'publish', 1, 'editor_labak', 'validating'),
  ('e912', 'labak', 'c912', 'publish', 1, 'editor_labak', 'validating'),
  ('e913', 'labak', 'c913', 'publish', 2, 'editor_labak', 'validating'),
  ('e914', 'labak', 'c914', 'publish', 2, 'editor_labak', 'validating'),
  ('e915', 'labak', 'c914', 'publish', 3, 'editor_labak', 'validating'),
  ('e916', 'labak', 'c914', 'publish', 3, 'editor_labak', 'validating'),
  ('e917', 'labak', 'c917', 'publish', 1, 'revoked', 'validating'),
  ('e918', 'labak', 'c918', 'publish', 1, 'editor_labak', 'validating'),
  ('e919', 'labak', 'c919', 'publish', 1, 'editor_labak', 'validating'),
  ('e920', 'labak', 'c920', 'publish', 1, 'editor_labak', 'validating'),
  ('e921', 'demo', 'c921', 'publish', 1, 'editor_demo', 'validating'),
  ('e922', 'demo', 'c921', 'unpublish', null, 'editor_demo', 'validating'),
  ('e923', 'labak', 'c907', 'unpublish', null, 'editor_labak', 'validating'),
  ('e924', 'labak', 'c913', 'unpublish', null, 'revoked', 'validating'),
  ('e925', 'labak', 'c908', 'publish', 1, 'editor_labak', 'pending'),
  ('e927', 'labak', 'c908', 'publish', 1, 'editor_labak', 'validating'),
  ('e928', 'labak', 'c908', 'publish', 1, 'editor_labak', 'validating'),
  ('e929', 'labak', 'c927', 'publish', 1, 'editor_labak', 'validating'),
  ('e933', 'demo', 'c921', 'publish', 1, 'editor_demo', 'committed'),
  ('e934', 'demo', 'c921', 'unpublish', null, 'editor_demo', 'validating')) as x(r, t, e, a, v, p, s);

-- ---------------------------------------------------------------------------
-- worker_read_request: one statement, {request, entry, draft, refs}.
select tests.act_as_service();
select is(array(select jsonb_object_keys(api.worker_read_request(tests.pub('e906'))) order by 1),
  array['draft', 'entry', 'refs', 'request', 'tenant'], 'worker_read_request returns request, entry, tenant, draft and refs');
select is(api.worker_read_request(tests.pub('e906')) -> 'tenant',
  jsonb_build_object('id', tests.tenant('labak'), 'slug', 'labak', 'status', 'active'),
  'tenant is the request''s tenant: {id, slug, status} (decision 34.2)');
select is((select (j -> 'request' ->> 'id', j -> 'request' ->> 'status', j -> 'request' ->> 'draft_version',
                   j -> 'entry' ->> 'id', j -> 'entry' ->> 'tenant_id', j -> 'entry' ->> 'type')::text
           from api.worker_read_request(tests.pub('e906')) as j),
  (tests.pub('e906')::text, 'validating', '1', tests.entry('c906')::text, tests.tenant('labak')::text, 'news')::text,
  'the request and entry are the rows, as JSON');
select is(api.worker_read_request(tests.pub('e906')) -> 'draft',
  (select jsonb_build_object('data', d.data, 'version', 1, 'schema_version', 1) from cms.drafts d
   where d.entry_id = tests.entry('c906')),
  'draft is exactly {data, version, schema_version}');
-- Each reference carries its target's metadata (decision 34.2): an entry's
-- type, slug and published revision's title (null when unpublished); an
-- asset's filename, mime, size, focal point, default alt and public path, and
-- (media library L3, 118_media_library_delivery) its caption and credit.
select is(api.worker_read_request(tests.pub('e906')) -> 'refs',
  jsonb_build_array(
    jsonb_build_object('path', '$."img"', 'kind', 'asset', 'id', tests.asset('f901'), 'published', false, 'archived', false,
                       'filename', 'a.jpg', 'mime', 'image/jpeg', 'width', 800, 'height', 600, 'focal_x', null,
                       'focal_y', null, 'default_alt', null, 'public_path', null, 'caption', null, 'credit', null),
    jsonb_build_object('path', '$."old"', 'kind', 'asset', 'id', tests.asset('f902'), 'published', false, 'archived', true,
                       'filename', 'b.jpg', 'mime', 'image/jpeg', 'width', 800, 'height', 600, 'focal_x', null,
                       'focal_y', null, 'default_alt', null, 'public_path', null, 'caption', null, 'credit', null),
    jsonb_build_object('path', '$."pub"', 'kind', 'entry', 'id', tests.entry('c907'), 'published', true, 'archived', false,
                       'type', 'news', 'slug', 'tilvisun', 'title', 'Birt'),
    jsonb_build_object('path', '$."unpub"', 'kind', 'entry', 'id', tests.entry('c908'), 'published', false, 'archived', false,
                       'type', 'news', 'slug', null, 'title', null)),
  'refs come from the draft''s data with their targets'' state and metadata, not from the forged draft_refs row');
-- Asset metadata is read from the row, and a target in another tenant is
-- looked up in the request's tenant only, so it reads as missing (all nulls).
-- (Paths are ordered by the database's collation, which puts $."other_entry"
-- before $."other".)
select tests.act_as_owner();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, focal_x, focal_y,
                        default_alt, public_path, created_by)
  values (tests.asset('f906'), tests.tenant('labak'),
          tests.tenant('labak')::text || '/' || tests.asset('f906')::text || '/f.png', 'f.png', 'image/png', 1000,
          1200, 900, repeat('6', 64), 0.25, 0.75, 'Sjálfgefið', 'labak/' || tests.asset('f906')::text || '/f.png',
          tests.persona('editor_labak'));
insert into cms.entries (id, tenant_id, type, slug, created_by)
  values (tests.entry('c930'), tests.tenant('labak'), 'news', null, tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by)
  values (tests.entry('c930'), tests.tenant('labak'), 1,
          jsonb_build_object('img', tests.ref(tests.asset('f906'), 'asset')), tests.persona('editor_labak'));
-- (A draft cannot hold another tenant's reference: draft_refs' composite
-- foreign keys refuse it. The cross-tenant case is set up as the owner with
-- the refs trigger disabled for one update, inside this rolled-back test.)
alter table cms.drafts disable trigger drafts_sync_refs_on_update;
update cms.drafts set data = data || jsonb_build_object('other', tests.ref(tests.asset('f904'), 'asset'),
                                                        'other_entry', tests.ref(tests.entry('c905'), 'entry'))
  where entry_id = tests.entry('c930');
alter table cms.drafts enable trigger drafts_sync_refs_on_update;
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, claimed_at, attempts)
  values (tests.pub('e930'), tests.tenant('labak'), tests.entry('c930'), 'publish', 1, tests.persona('editor_labak'),
          'pending', null, 0);
select tests.act_as_service();
select is(api.worker_read_request(tests.pub('e930')) -> 'refs',
  jsonb_build_array(
    jsonb_build_object('path', '$."img"', 'kind', 'asset', 'id', tests.asset('f906'), 'published', true, 'archived', false,
                       'filename', 'f.png', 'mime', 'image/png', 'width', 1200, 'height', 900, 'focal_x', 0.25,
                       'focal_y', 0.75, 'default_alt', 'Sjálfgefið',
                       'public_path', 'labak/' || tests.asset('f906')::text || '/f.png', 'caption', null, 'credit', null),
    jsonb_build_object('path', '$."other_entry"', 'kind', 'entry', 'id', tests.entry('c905'), 'published', false,
                       'archived', false, 'type', null, 'slug', null, 'title', null),
    jsonb_build_object('path', '$."other"', 'kind', 'asset', 'id', tests.asset('f904'), 'published', false,
                       'archived', false, 'filename', null, 'mime', null, 'width', null, 'height', null,
                       'focal_x', null, 'focal_y', null, 'default_alt', null, 'public_path', null,
                       'caption', null, 'credit', null)),
  'asset metadata is the row''s; another tenant''s targets read as missing, without their metadata');
-- f906's public path is cleared again so the release tests below start with
-- no public asset.
select tests.act_as_owner();
update cms.assets set public_path = null where id = tests.asset('f906');
select tests.act_as_service();
select throws_ok($$ select api.worker_read_request(gen_random_uuid()) $$, 'P0001', 'not_found',
  'worker_read_request: an unknown request is not_found');

-- ---------------------------------------------------------------------------
-- Exactness (plan "Exactness: what M1 proves" 1–3): c910 at version 3, request
-- e910 for version 3.
select is(api.worker_commit_publish(tests.pub('e910'), 3, 1, 'T', '2025-06-01 00:00:00+00'), 'committed',
  'commit of the validated version is committed');
select is((select data from cms.revisions where id = (select revision_id from cms.publish_requests where id = tests.pub('e910'))),
  (select data from cms.drafts where entry_id = tests.entry('c910')), 'revision data equals validated draft data');
select is((select row(r.tenant_id, r.entry_id, r.draft_version, r.schema_version, r.title, r.sort_at, r.requested_by,
                      r.committed_at)::text
           from cms.revisions r where r.id = (select revision_id from cms.publish_requests where id = tests.pub('e910'))),
  row(tests.tenant('labak'), tests.entry('c910'), 3, 1, 'T', '2025-06-01 00:00:00+00'::timestamptz,
      tests.persona('editor_labak'), now())::text,
  'the revision has the validated draft and schema versions, the worker''s title and sort_at, and the requester');
select results_eq($$ select path, target_entry_id, target_asset_id from cms.revision_refs
                     where revision_id = (select revision_id from cms.publish_requests where id = tests.pub('e910')) order by 1 $$,
                  $$ select path, target_entry_id, target_asset_id from cms.draft_refs
                     where entry_id = tests.entry('c910') order by 1 $$,
                  'revision refs equal draft refs');
select is((select count(*)::int from cms.revision_refs
           where revision_id = (select revision_id from cms.publish_requests where id = tests.pub('e910'))), 3,
  'the revision has its three references');
select is((select row(r.status, r.error, r.revision_id is not null)::text from cms.publish_requests r where r.id = tests.pub('e910')),
  row('committed', null::jsonb, true)::text, 'the request is committed with its revision');
select is((select row(e.published_rev_id, e.published_draft_version, e.first_published_at, e.last_published_at)::text
           from cms.entries e where e.id = tests.entry('c910')),
  (select row(r.revision_id, 3, now(), now())::text from cms.publish_requests r where r.id = tests.pub('e910')),
  'the pointer moves to the revision; first and last published are set');
-- Row locks taken by the commit (§6.2 steps 1 and 5, plan Task 11), read with
-- pgrowlocks (owner context; created inside this transaction, so it is rolled
-- back with it). xmax alone cannot tell lock modes apart: the revision_refs
-- foreign keys take FOR KEY SHARE on the referenced entries and assets, so a
-- referenced row is locked whether or not step 5's FOR SHARE loop runs. The
-- mode can: this transaction's FOR SHARE outranks the foreign key's FOR KEY
-- SHARE (and the draft_refs foreign keys' from the fixtures), so "For Share"
-- appears only if the loop ran. The draft's FOR UPDATE is the strongest mode.
-- Task 12's concurrent test (an unpublish of a referenced entry waits for the
-- commit) proves the same locks across sessions. The mode strings ('For
-- Update', 'For Share', ...) are pgrowlocks' output format, which could change
-- with its version; a change fails these assertions loudly, never silently.
select tests.act_as_owner();
select is((select l.modes from cms.drafts d join extensions.pgrowlocks('cms.drafts') l on l.locked_row = d.ctid
           where d.entry_id = tests.entry('c910')),
  array['For Update'], 'the commit locked c910''s draft FOR UPDATE');
select is((select l.modes from cms.assets a join extensions.pgrowlocks('cms.assets') l on l.locked_row = a.ctid
           where a.id = tests.asset('f901')),
  array['For Share'], 'the commit locked the referenced asset f901 FOR SHARE, not only the foreign key''s FOR KEY SHARE');
select is((select l.modes from cms.entries e join extensions.pgrowlocks('cms.entries') l on l.locked_row = e.ctid
           where e.id = tests.entry('c907')),
  array['For Share'], 'the commit locked the referenced entry c907 FOR SHARE, not only the foreign key''s FOR KEY SHARE');
select is_empty($$ select 1 from cms.assets a join extensions.pgrowlocks('cms.assets') l on l.locked_row = a.ctid
                   where a.id = tests.asset('f905') $$,
  'an asset the draft does not reference is not locked');
select is((select count(*)::int from cms.audit_log where target_id = tests.pub('e910')
           and action = 'publish_request.committed' and actor_id = tests.persona('editor_labak')), 1,
  'the commit is audited with the requester as actor');
select tests.act_as_service();

-- draft_refs are not trusted (Task 7 security r1, Minor 1).
select is(api.worker_commit_publish(tests.pub('e911'), 1, 1, 'Engar', null), 'committed',
  'a forged draft_refs row to an unpublished entry does not fail a draft that has no references');
select is((select count(*)::int from cms.revision_refs
           where revision_id = (select revision_id from cms.publish_requests where id = tests.pub('e911'))), 0,
  'the forged reference is not in revision_refs');
select is(api.worker_commit_publish(tests.pub('e912'), 1, 1, 'T', null), 'failed_validation',
  'deleting draft_refs rows does not hide a reference to an unpublished entry');
select is((select error from cms.publish_requests where id = tests.pub('e912')),
  jsonb_build_object('code', 'invalid_reference', 'refs', jsonb_build_array(jsonb_build_object(
    'path', '$."rel"', 'kind', 'entry', 'id', tests.entry('c908'), 'reason', 'unpublished'))),
  'failed_validation names the offending reference');
select is((select row(e.published_rev_id, (select count(*) from cms.revisions r where r.entry_id = e.id))::text
           from cms.entries e where e.id = tests.entry('c912')),
  row(null::uuid, 0)::text, 'a failed commit writes no revision and leaves the pointer');

-- Republishing keeps first_published_at.
select is(api.worker_commit_publish(tests.pub('e913'), 2, 1, 'Ný', null), 'committed', 'republishing commits');
select is((select row(e.published_draft_version, e.first_published_at, e.last_published_at)::text
           from cms.entries e where e.id = tests.entry('c913')),
  row(2, '2020-01-01 00:00:00+00'::timestamptz, now())::text,
  'republishing keeps first_published_at and moves last_published_at');

-- Supersession (§6.2 step 2) and schema version (step 3).
select is(api.worker_commit_publish(tests.pub('e914'), 2, 1, 'T', null), 'superseded',
  'a request for a version the draft has moved past is superseded');
select is((select error from cms.publish_requests where id = tests.pub('e914')),
  '{"code": "superseded", "requested_version": 2, "validated_version": 2, "draft_version": 3}'::jsonb,
  'superseded records the versions');
select is(api.worker_commit_publish(tests.pub('e915'), 2, 1, 'T', null), 'superseded',
  'the worker validated another version than the request''s: superseded');
select is(api.worker_commit_publish(tests.pub('e916'), 3, 2, 'T', null), 'failed_validation',
  'a schema version other than the draft''s: failed_validation');
select is((select error from cms.publish_requests where id = tests.pub('e916')),
  '{"code": "schema_version", "validated_schema_version": 2, "draft_schema_version": 1}'::jsonb,
  'the schema-version failure records both versions');
select is((select row(e.published_rev_id, (select count(*) from cms.revisions r where r.entry_id = e.id))::text
           from cms.entries e where e.id = tests.entry('c914')),
  row(null::uuid, 0)::text, 'neither wrote a revision or moved the pointer');

-- Authorization at commit (§6.2 step 4).
select is(api.worker_commit_publish(tests.pub('e917'), 1, 1, 'T', null), 'rejected',
  'a request by a revoked member is rejected');
select is((select row(status, error)::text from cms.publish_requests where id = tests.pub('e917')),
  row('rejected', '{"code": "forbidden"}'::jsonb)::text, 'the rejection records forbidden');
select is((select published_rev_id from cms.entries where id = tests.entry('c917')), null,
  'a rejected request does not publish');

-- References (§6.2 step 5).
select is(api.worker_commit_publish(tests.pub('e918'), 1, 1, 'T', null), 'failed_validation',
  'a reference to an unpublished entry fails validation');
select is(api.worker_commit_publish(tests.pub('e919'), 1, 1, 'T', null), 'failed_validation',
  'a reference to an archived asset fails validation');
select is((select error -> 'refs' from cms.publish_requests where id = tests.pub('e919')),
  jsonb_build_array(jsonb_build_object('path', '$."image"', 'kind', 'asset', 'id', tests.asset('f902'), 'reason', 'archived')),
  'the archived asset is named');
select is(api.worker_commit_publish(tests.pub('e929'), 1, 1, 'T', null), 'failed_validation',
  'a reference to a published but archived entry fails validation');
select is((select error from cms.publish_requests where id = tests.pub('e929')),
  jsonb_build_object('code', 'invalid_reference', 'refs', jsonb_build_array(jsonb_build_object(
    'path', '$."rel"', 'kind', 'entry', 'id', tests.entry('c925'), 'reason', 'archived'))),
  'the archived entry is named with reason archived');
select is(api.worker_commit_publish(tests.pub('e920'), 1, 1, 'T', null), 'committed',
  'a reference to the entry itself is allowed before its first publication');

-- Suspended tenant (§6.2 step 4).
select tests.act_as_owner();
update cms.tenants set status = 'suspended' where id = tests.tenant('demo');
select tests.act_as_service();
select is(api.worker_commit_publish(tests.pub('e921'), 1, 1, 'T', null), 'rejected',
  'a request of a suspended tenant is rejected');
select is((select error from cms.publish_requests where id = tests.pub('e921')), '{"code": "tenant_inactive"}'::jsonb,
  'the rejection records tenant_inactive');
select is(api.worker_commit_unpublish(tests.pub('e922')), 'rejected',
  'an unpublish request of a suspended tenant is rejected too');
select tests.act_as_owner();
update cms.tenants set status = 'active' where id = tests.tenant('demo');
select tests.act_as_service();

-- Wrong action, wrong state, unknown request.
select throws_ok($$ select api.worker_commit_publish(tests.pub('e923'), 1, 1, 'T', null) $$, 'P0001', 'forbidden',
  'worker_commit_publish refuses an unpublish request');
select throws_ok($$ select api.worker_commit_publish(tests.pub('e925'), 1, 1, 'T', null) $$, 'P0001', 'forbidden',
  'worker_commit_publish refuses a request that is not validating (pending)');
select throws_ok($$ select api.worker_commit_publish(tests.pub('e910'), 3, 1, 'T', null) $$, 'P0001', 'forbidden',
  'worker_commit_publish refuses a committed request');
select throws_ok($$ select api.worker_commit_publish(gen_random_uuid(), 1, 1, 'T', null) $$, 'P0001', 'not_found',
  'worker_commit_publish: an unknown request is not_found');
select throws_ok($$ select api.worker_commit_unpublish(tests.pub('e927')) $$, 'P0001', 'forbidden',
  'worker_commit_unpublish refuses a publish request');
select throws_ok($$ select api.worker_commit_unpublish(gen_random_uuid()) $$, 'P0001', 'not_found',
  'worker_commit_unpublish: an unknown request is not_found');

-- Unpublish is never blocked by references (§6.2): c910's published revision
-- references c907.
select is(api.worker_commit_unpublish(tests.pub('e923')), 'committed',
  'unpublishing an entry that a published revision references is committed');
select is((select row(e.published_rev_id, e.published_draft_version, e.first_published_at)::text
           from cms.entries e where e.id = tests.entry('c907')),
  row(null::uuid, null::int, '2020-01-01 00:00:00+00'::timestamptz)::text,
  'unpublish clears the pointer and keeps first_published_at');
select is((select row(status, revision_id, error)::text from cms.publish_requests where id = tests.pub('e923')),
  row('committed', null::uuid, null::jsonb)::text, 'the unpublish request is committed without a revision');
select ok(exists (select 1 from cms.revision_refs rr join cms.entries e on e.published_rev_id = rr.revision_id
                  where e.id = tests.entry('c910') and rr.target_entry_id = tests.entry('c907')),
  'the referencing revision is still published and still references c907');
select is(api.worker_commit_unpublish(tests.pub('e924')), 'rejected', 'an unpublish by a revoked member is rejected');
select isnt((select published_rev_id from cms.entries where id = tests.entry('c913')), null,
  'the rejected unpublish leaves the entry published');
-- Unpublishing an entry that is not published (demo c921, never published;
-- demo, so labak's release requests below are unchanged) ends superseded and
-- changes nothing else (M5-01).
select is(api.worker_commit_unpublish(tests.pub('e934')), 'superseded',
  'unpublishing an entry that is not published ends superseded');
select is((select row(e.published_rev_id, e.published_draft_version, e.first_published_at, e.last_published_at)::text
           from cms.entries e where e.id = tests.entry('c921')),
  row(null::uuid, null::int, null::timestamptz, null::timestamptz)::text,
  'the entry is unchanged: no pointer, never published');
select is((select row(status, revision_id, error)::text from cms.publish_requests where id = tests.pub('e934')),
  row('superseded', null::uuid, jsonb_build_object('code', 'not_published'))::text,
  'the no-op unpublish request records why, without a revision');

-- first_published_at is write-once (Task 6 security r1): the slug stays locked.
select throws_ok($$ update cms.entries set first_published_at = null where id = tests.entry('c907') $$,
  '23514', 'entries.first_published_at is write-once', 'service_role cannot clear first_published_at');
select tests.act_as_owner();
select throws_ok($$ update cms.entries set first_published_at = null where id = tests.entry('c907') $$,
  '23514', 'entries.first_published_at is write-once', 'nor can the owner');
select throws_ok($$ update cms.entries set first_published_at = now() where id = tests.entry('c907') $$,
  '23514', 'entries.first_published_at is write-once', 'nor move it');
select lives_ok($$ update cms.entries set first_published_at = now() where id = tests.entry('c908') $$,
  'setting first_published_at the first time is allowed');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.set_slug(tests.entry('c907'), 'annad') $$, 'P0001', 'slug_locked',
  'an unpublished entry''s slug stays locked');

-- revisions.data is a JSON object of at most 1 MB (Task 7 security r3).
select tests.act_as_service();
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c908'), 1, 1, '[]', tests.persona('editor_labak')) $$,
  '23514', 'new row for relation "revisions" violates check constraint "revisions_data_check"',
  'revision data must be a JSON object');
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c908'), 1, 1, jsonb_build_object('x', repeat('a', 1048576)),
          tests.persona('editor_labak')) $$,
  '23514', 'new row for relation "revisions" violates check constraint "revisions_data_check"',
  'revision data must be at most 1 MB');

-- ---------------------------------------------------------------------------
-- worker_reject_request (§6.3).
select lives_ok($$ select api.worker_reject_request(tests.pub('e927'), 'failed', '{"message": "boom"}') $$,
  'a validating request can be failed');
select is((select row(status, error)::text from cms.publish_requests where id = tests.pub('e927')),
  row('failed', '{"message": "boom"}'::jsonb)::text, 'the request is failed with the error');
select throws_ok($$ select api.worker_reject_request(tests.pub('e928'), 'committed', null) $$, '22023',
  'p_status must be failed_validation or failed', 'worker_reject_request cannot commit');
select throws_ok($$ select api.worker_reject_request(tests.pub('e928'), 'rejected', null) $$, '22023',
  'p_status must be failed_validation or failed', 'worker_reject_request cannot reject');
select lives_ok($$ select api.worker_reject_request(tests.pub('e928'), 'failed_validation',
                    '{"fields": {"title": "required"}}') $$, 'a validating request can fail validation');
select is((select status from cms.publish_requests where id = tests.pub('e928')), 'failed_validation',
  'the request is failed_validation');
select throws_ok($$ select api.worker_reject_request(tests.pub('e910'), 'failed', null) $$, 'P0001', 'forbidden',
  'a committed request cannot be failed');
select throws_ok($$ select api.worker_reject_request(tests.pub('e925'), 'failed', null) $$, 'P0001', 'forbidden',
  'a pending request cannot be failed');
select throws_ok($$ select api.worker_reject_request(gen_random_uuid(), 'failed', null) $$, 'P0001', 'not_found',
  'worker_reject_request: an unknown request is not_found');

-- ---------------------------------------------------------------------------
-- Releases (§7.1).
select is((select id from api.worker_previous_release(tests.tenant('labak'))), tests.pub('e931'),
  'previous release: the latest delivered (number 1; number 2 failed)');
select is((select id from api.worker_previous_release(tests.tenant('demo'))), null,
  'previous release: null for a tenant with none delivered');
select lives_ok($$ insert into ids select 'labak3', r.id from api.worker_begin_release(tests.tenant('labak')) as r $$,
  'worker_begin_release starts a labak release');
select isnt((select id from ids where name = 'labak3'), null, 'the first build gets a release');
select is((select row(r.tenant_id, r.number, r.status, r.bundle_path, r.delivered_at)::text from cms.releases r
           where r.id = (select id from ids where name = 'labak3')),
  row(tests.tenant('labak'), 3, 'building', null::text, null::timestamptz)::text,
  'the release is number max + 1 (3), building');
select is((select r.id from api.worker_begin_release(tests.tenant('labak')) as r), null,
  'second build while one is building');
select is((select count(*)::int from cms.releases where tenant_id = tests.tenant('labak') and status = 'building'), 1,
  'one building release for labak');
select throws_ok($$ select api.worker_begin_release(gen_random_uuid()) $$, 'P0001', 'not_found',
  'worker_begin_release: an unknown tenant is not_found');

-- The snapshot (§7.1): published and not archived entries only.
create temporary table snap on commit drop as select api.worker_release_snapshot((select id from ids where name = 'labak3')) as j;
select is(array(select jsonb_object_keys(j) from snap order by 1), array['assets', 'entries', 'release', 'requests', 'tenant'],
  'the snapshot has release, tenant, entries, assets and requests');
select is((select j -> 'release' from snap),
  jsonb_build_object('id', (select id from ids where name = 'labak3'), 'tenant_id', tests.tenant('labak'),
                     'number', 3, 'status', 'building'), 'the snapshot names its release');
select is((select j -> 'tenant' from snap), jsonb_build_object('id', tests.tenant('labak'), 'slug', 'labak'),
  'the snapshot names the release''s tenant');
select is(array(select (x ->> 'entry_id')::uuid from snap, jsonb_array_elements(j -> 'entries') as x order by 1),
  array[tests.entry('c910'), tests.entry('c911'), tests.entry('c913'), tests.entry('c920'), tests.entry('c926')],
  'entries: exactly the published, not archived labak entries (not unpublished c907, archived c925, demo or drafts)');
select is((select x from snap, jsonb_array_elements(j -> 'entries') as x where x ->> 'entry_id' = tests.entry('c910')::text),
  (select jsonb_build_object('entry_id', e.id, 'type', 'news', 'slug', 'nakvaem', 'revision_id', r.id,
            'schema_version', 1, 'data', d.data, 'title', 'T', 'sort_at', '2025-06-01 00:00:00+00'::timestamptz,
            'first_published_at', now(), 'last_published_at', now(),
            'refs', jsonb_build_array(
              jsonb_build_object('path', '$."image"', 'kind', 'asset', 'id', tests.asset('f901')),
              jsonb_build_object('path', '$."link"', 'kind', 'entry', 'id', tests.entry('c907')),
              jsonb_build_object('path', '$."list"[0]."x"', 'kind', 'entry', 'id', tests.entry('c907'))))
   from cms.entries e join cms.revisions r on r.id = e.published_rev_id join cms.drafts d on d.entry_id = e.id
   where e.id = tests.entry('c910')),
  'an entry carries its published revision''s data, title, sort_at, timestamps and references');
select is((select j -> 'assets' from snap),
  (select jsonb_agg(jsonb_build_object('id', a.id, 'original_path', a.original_path, 'filename', a.filename,
            'mime', a.mime, 'width', a.width, 'height', a.height, 'focal_x', a.focal_x, 'focal_y', a.focal_y,
            'default_alt', a.default_alt, 'public_path', a.public_path, 'archived', a.archived_at is not null,
            'caption', a.caption, 'credit', a.credit)
          order by a.id)
   from cms.assets a where a.id in (tests.asset('f901'), tests.asset('f903'))),
  'assets: every asset the included revisions reference, with archived status');
select is(array(select (x ->> 'archived')::boolean from snap, jsonb_array_elements(j -> 'assets') as x order by x ->> 'id'),
  array[false, true], 'f901 is live and f903 archived');
select is(array(select (x ->> 'id')::uuid from snap, jsonb_array_elements(j -> 'requests') as x order by 1),
  array[tests.pub('e910'), tests.pub('e911'), tests.pub('e913'), tests.pub('e920'), tests.pub('e923')],
  'requests: the tenant''s committed requests with no release (the unpublish included; e904 is in release 1)');
select throws_ok($$ select api.worker_release_snapshot(gen_random_uuid()) $$, 'P0001', 'not_found',
  'worker_release_snapshot: an unknown release is not_found');

-- worker_finish_release: everything scoped to the release's tenant. Task 20
-- replaced the function (20261102001200_release_build.sql): 'delivered' needs a
-- bundle path, and 'failed' links no requests and no assets (both 22023, pinned
-- in 096_release_build), so a failed build's requests wait for the next build.
-- Only a building release can be finished, so a release the sweep failed as
-- stale cannot be revived by a late worker (Task 30, 098_worker_recovery).
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'building', null, null, null, null) $$,
  '22023', 'p_status must be delivered or failed', 'finish: status must be delivered or failed');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered', null, null, null, '{}') $$,
  '22023', 'p_public_assets must be a JSON array', 'finish: public assets must be an array');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered',
                    'demo/releases/3.json', null, null, null) $$,
  'P0001', 'forbidden', 'finish: the bundle path must be under the release''s tenant and number');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered',
                    'labak/releases/3.json', null, array[tests.pub('e910'), tests.pub('e933')], null) $$,
  'P0001', 'forbidden', 'finish: a request of another tenant is refused');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered',
                    'labak/releases/3.json', null, array[tests.pub('e912')], null) $$,
  'P0001', 'forbidden', 'finish: a request that is not committed is refused');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered',
                    'labak/releases/3.json', null, array[tests.pub('e904')], null) $$,
  'P0001', 'forbidden', 'finish: a request already in a release is refused');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered',
                    'labak/releases/3.json', null, null,
                    jsonb_build_array(jsonb_build_object('id', tests.asset('f904'),
                      'public_path', 'labak/' || tests.asset('f904') || '/d.jpg'))) $$,
  'P0001', 'forbidden', 'finish: an asset of another tenant is refused');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered',
                    'labak/releases/3.json', null, null,
                    jsonb_build_array(jsonb_build_object('id', tests.asset('f905'),
                      'public_path', 'demo/' || tests.asset('f905') || '/e.webp'))) $$,
  'P0001', 'forbidden', 'finish: a public path outside {tenant_slug}/{asset_id}/{filename} is refused');
select is((select row(r.status, (select count(*) from cms.publish_requests p where p.release_id = r.id),
                      (select count(*) from cms.assets a where a.public_path is not null))::text
           from cms.releases r where r.id = (select id from ids where name = 'labak3')),
  row('building', 0, 0)::text, 'the refused calls changed nothing');
select lives_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'delivered',
                    'labak/releases/3.json', null,
                    array[tests.pub('e910'), tests.pub('e911'), tests.pub('e913'), tests.pub('e920'), tests.pub('e923')],
                    jsonb_build_array(jsonb_build_object('id', tests.asset('f901'),
                      'public_path', 'labak/' || tests.asset('f901') || '/a.jpg'))) $$,
  'finish delivers the release');
select is((select row(r.status, r.bundle_path, r.delivered_at, r.error)::text from cms.releases r
           where r.id = (select id from ids where name = 'labak3')),
  row('delivered', 'labak/releases/3.json', now(), null::jsonb)::text, 'the release is delivered with its bundle path');
select is(array(select id from cms.publish_requests where release_id = (select id from ids where name = 'labak3') order by id),
  array[tests.pub('e910'), tests.pub('e911'), tests.pub('e913'), tests.pub('e920'), tests.pub('e923')],
  'the given requests are in the release');
select is((select public_path from cms.assets where id = tests.asset('f901')), 'labak/' || tests.asset('f901') || '/a.jpg',
  'the given asset has its public path');
select throws_ok($$ select api.worker_finish_release((select id from ids where name = 'labak3'), 'failed', null, null, null, null) $$,
  'P0001', 'forbidden', 'a finished release cannot be finished again');
select throws_ok($$ select api.worker_finish_release(gen_random_uuid(), 'failed', null, null, null, null) $$,
  'P0001', 'not_found', 'worker_finish_release: an unknown release is not_found');
select is((select id from api.worker_previous_release(tests.tenant('labak'))), (select id from ids where name = 'labak3'),
  'previous release is now release 3');
select tests.act_as_owner();
select is((select count(*)::int from cms.audit_log where target_id = (select id from ids where name = 'labak3')
           and action = 'system.release.delivered' and actor_id is null), 1,
  'delivery is audited as a system event');
select tests.act_as_service();

-- A failed release; the next build sees no pending requests.
select lives_ok($$ insert into ids select 'labak4', r.id from api.worker_begin_release(tests.tenant('labak')) as r $$,
  'a new build starts once release 3 is finished');
select is((select number from cms.releases where id = (select id from ids where name = 'labak4')), 4, 'it is number 4');
select is(api.worker_release_snapshot((select id from ids where name = 'labak4')) -> 'requests', '[]'::jsonb,
  'requests already in a release are not listed again');
select is((select x ->> 'public_path' from jsonb_array_elements(
             api.worker_release_snapshot((select id from ids where name = 'labak4')) -> 'assets') as x
           where x ->> 'id' = tests.asset('f901')::text), 'labak/' || tests.asset('f901') || '/a.jpg',
  'the snapshot shows the public path');
select lives_ok($$ select api.worker_finish_release((select id from ids where name = 'labak4'), 'failed', null,
                    '{"entries": {"c926": "projection failed"}}', null, null) $$, 'finish marks a release failed');
select is((select row(status, delivered_at, error)::text from cms.releases where id = (select id from ids where name = 'labak4')),
  row('failed', null::timestamptz, '{"entries": {"c926": "projection failed"}}'::jsonb)::text,
  'a failed release has its error and no delivered_at');
select is((select id from api.worker_previous_release(tests.tenant('labak'))), (select id from ids where name = 'labak3'),
  'a failed release is never the previous release');

-- ---------------------------------------------------------------------------
-- Vault (A9, §8.2): admin_create_site stores the secret with
-- vault.create_secret and keeps only its id; worker_sites reads it back from
-- vault.decrypted_secrets. Both run as service_role.
select lives_ok($$ insert into ids select 'site_demo', api.admin_create_site(tests.tenant('demo'), 'http://localhost:3101', 'http://localhost:3101/api/cms/revalidate', null, 's3cr3t') $$,
  'A9: admin_create_site stores a webhook secret in Vault (as service_role)');
select is((select webhook_secrets from api.worker_sites(tests.tenant('demo'))), array['s3cr3t'],
  'A9: worker_sites reads the secret back from Vault (as service_role)');
select is((select row(id, base_url, revalidate_url)::text from api.worker_sites(tests.tenant('demo'))),
  row((select id from ids where name = 'site_demo'), 'http://localhost:3101', 'http://localhost:3101/api/cms/revalidate')::text,
  'worker_sites returns the site''s id and URLs');
select is((select row(s.tenant_id, s.base_url, s.revalidate_url, s.preview_url, s.active, s.preview_secret_ref)::text
           from cms.sites s where s.id = (select id from ids where name = 'site_demo')),
  row(tests.tenant('demo'), 'http://localhost:3101', 'http://localhost:3101/api/cms/revalidate', null::text, true, null::uuid)::text,
  'the site row is stored');
select is((select count(*)::int from cms.sites s where to_jsonb(s)::text like '%s3cr3t%'), 0,
  'the secret is in no cms.sites column');
select lives_ok($$ insert into ids select 'site_labak_old', api.admin_create_site(tests.tenant('labak'), 'http://localhost:3102',
                    'http://localhost:3102/api/cms/revalidate', 'http://localhost:3102/api/preview', 'annad-leyndarmal') $$,
  'a second site, for labak');
select tests.act_as_owner();
select is((select count(*)::int from vault.secrets v join cms.sites s on s.webhook_secret_ref = v.id
           where s.id = (select id from ids where name = 'site_demo')
             and v.name = 'cms.sites/' || s.id || '/webhook'), 1,
  'A9: the site''s webhook_secret_ref is a Vault secret named after the site');
select is((select count(*)::int from vault.secrets v join cms.sites s on s.webhook_secret_ref = v.id
           where s.id = (select id from ids where name = 'site_demo') and v.secret like '%s3cr3t%'), 0,
  'A9: Vault stores the secret encrypted');
update cms.sites set active = false where id = (select id from ids where name = 'site_labak_old');
select tests.act_as_service();
select is((select array_agg(row(id, webhook_secrets)::text order by id) from api.worker_sites(tests.tenant('labak'))),
  array[row(tests.pub('e941'), '{}'::text[])::text],
  'worker_sites: active sites of the tenant only, never another tenant''s secret; no Vault secret gives an empty array');
select is((select count(*)::int from api.worker_sites(gen_random_uuid())), 0, 'worker_sites: no sites for an unknown tenant');
select throws_ok($$ select api.admin_create_site(gen_random_uuid(), 'http://x', 'http://x/r', null, 'x') $$,
  'P0001', 'not_found', 'admin_create_site: an unknown tenant is not_found');
select throws_ok($$ select api.admin_create_site(tests.tenant('demo'), 'http://x', 'http://x/r', null, '') $$,
  '22023', 'p_webhook_secret must not be empty', 'admin_create_site: an empty secret raises 22023');

-- ---------------------------------------------------------------------------
-- worker_record_delivery (§7.4).
select lives_ok($$ select api.worker_record_delivery((select id from ids where name = 'labak3'), tests.pub('e941'),
                    'ok', 'pending', null, now()) $$, 'a delivery is recorded');
select is((select row(tenant_id, notify_status, notify_attempts, notified_at, live_status, live_confirmed_at, last_error)::text
           from cms.site_deliveries where release_id = (select id from ids where name = 'labak3') and site_id = tests.pub('e941')),
  row(tests.tenant('labak'), 'ok', 1, now(), 'pending', null::timestamptz, null::jsonb)::text,
  'the delivery row: the release''s tenant, notified now, one attempt');
select lives_ok($$ select api.worker_record_delivery((select id from ids where name = 'labak3'), tests.pub('e941'),
                    null, 'ok', null, now()) $$, 'the live status is recorded');
select is((select row(notify_status, notify_attempts, live_status, live_confirmed_at)::text
           from cms.site_deliveries where release_id = (select id from ids where name = 'labak3') and site_id = tests.pub('e941')),
  row('ok', 1, 'ok', now())::text, 'live is confirmed; a null notify status changes nothing');
select lives_ok($$ select api.worker_record_delivery((select id from ids where name = 'labak3'), tests.pub('e941'),
                    'failed', null, '{"status": 500}', now()) $$, 'a failed notification is recorded');
select is((select row(notify_status, notify_attempts, last_error)::text
           from cms.site_deliveries where release_id = (select id from ids where name = 'labak3') and site_id = tests.pub('e941')),
  row('failed', 2, '{"status": 500}'::jsonb)::text, 'a second attempt, with its error');
select throws_ok($$ select api.worker_record_delivery((select id from ids where name = 'labak3'),
                    (select id from ids where name = 'site_demo'), 'ok', 'ok', null, now()) $$,
  'P0001', 'forbidden', 'a labak release cannot be recorded for a demo site');
select throws_ok($$ select api.worker_record_delivery(gen_random_uuid(), tests.pub('e941'), 'ok', 'ok', null, now()) $$,
  'P0001', 'not_found', 'worker_record_delivery: an unknown release is not_found');
select is((select count(*)::int from cms.site_deliveries where site_id = (select id from ids where name = 'site_demo')), 0,
  'the refused call recorded nothing');

-- ---------------------------------------------------------------------------
-- admin_create_tenant and admin_add_membership (decision 5).
select lives_ok($$ insert into ids select 'acme', api.admin_create_tenant('acme-bakari', 'Acme bakarí') $$,
  'admin_create_tenant creates a tenant');
select is((select row(slug, name, status)::text from cms.tenants where id = (select id from ids where name = 'acme')),
  row('acme-bakari', 'Acme bakarí', 'active')::text, 'the tenant is active');
select throws_ok($$ select api.admin_create_tenant('acme-bakari', 'Annað') $$, 'P0001', 'slug_taken',
  'admin_create_tenant: a taken slug with another name is slug_taken (the same name returns the id, 113)');
select throws_ok($$ select api.admin_create_tenant('Acme Bakari', 'Annað') $$, '23514', null,
  'admin_create_tenant: a malformed slug fails the slug check');
select lives_ok($$ select api.admin_add_membership((select id from ids where name = 'acme'), tests.persona('outsider')) $$,
  'admin_add_membership adds an editor');
select lives_ok($$ select api.admin_add_membership((select id from ids where name = 'acme'), tests.persona('outsider')) $$,
  'adding it again changes nothing');
select is((select array_agg(row(user_id, role)::text) from cms.memberships where tenant_id = (select id from ids where name = 'acme')),
  array[row(tests.persona('outsider'), 'editor')::text], 'one editor membership');
select throws_ok($$ select api.admin_add_membership(gen_random_uuid(), tests.persona('outsider')) $$, 'P0001', 'not_found',
  'admin_add_membership: an unknown tenant is not_found');
select throws_ok($$ select api.admin_add_membership((select id from ids where name = 'acme'), gen_random_uuid()) $$,
  '23503', null, 'admin_add_membership: an unknown user fails the foreign key');
select tests.act_as_owner();
select is((select count(*)::int from cms.audit_log where tenant_id = (select id from ids where name = 'acme')
           and action = 'system.membership.added' and actor_id is null and target_id = tests.persona('outsider')), 1,
  'the membership is audited once, as a system event');

select * from finish();
rollback;
