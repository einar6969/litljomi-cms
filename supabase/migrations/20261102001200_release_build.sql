-- The release build's database change (spec §5.6, §7.1, §7.4; plan Task 20, decision 35;
-- deferred Minors: Task 11 security r1 Minor 2, Task 11 quality r1/r2 on finish_release).
--
-- api.worker_finish_release is replaced with two more parameter rules, checked before anything is
-- read or changed (22023 invalid_parameter_value, like the existing status and array rules):
--
--   1. 'delivered' needs p_bundle_path. Delivered means the bundle was written, read back and the
--      pointer moved to it (§7.1, §7.4); a delivered release without a bundle path could not be
--      found by worker_previous_release's callers (the previous bundle, the live checks, retention).
--   2. 'failed' links no requests and no assets: p_request_ids and p_public_assets must be null or
--      empty. Requests stay without a release, so the next build (or Task 21's sweep, which looks
--      for committed requests without release_id) picks them up and they reach a delivered release;
--      public_path is set only by a delivered release, so it never names media that no delivered
--      release published. Media a failed build did copy is copied again by the next build, where an
--      existing destination counts as success (decision 35).
--
-- Everything else is unchanged from Task 11 (20261102000900_api_worker.sql): SECURITY INVOKER,
-- search_path = '', schema-qualified names, every id scoped to the release's tenant, and EXECUTE
-- for service_role only (create or replace keeps the existing grants; PUBLIC has none through
-- Task 4's global default privileges).

create or replace function api.worker_finish_release(p_release_id uuid, p_status text, p_bundle_path text, p_error jsonb,
                                          p_request_ids uuid[], p_public_assets jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_release cms.releases;
  v_slug text;
  v_count int;
  v_given int;
begin
  if p_status is null or p_status not in ('delivered', 'failed') then
    raise exception 'p_status must be delivered or failed' using errcode = '22023';
  end if;
  if p_public_assets is not null and pg_catalog.jsonb_typeof(p_public_assets) <> 'array' then
    raise exception 'p_public_assets must be a JSON array' using errcode = '22023';
  end if;
  -- Task 11 security r1, Minor 2: a delivered release names its bundle (§7.4: delivered means
  -- the bundle was written and read back), and a failed one links nothing.
  if p_status = 'delivered' and p_bundle_path is null then
    raise exception 'p_bundle_path is required for a delivered release' using errcode = '22023';
  end if;
  if p_status = 'failed'
     and (coalesce(pg_catalog.cardinality(p_request_ids), 0) > 0
          or coalesce(pg_catalog.jsonb_array_length(p_public_assets), 0) > 0) then
    raise exception 'a failed release links no requests and no assets' using errcode = '22023';
  end if;
  select * into v_release from cms.releases r where r.id = p_release_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_release.status <> 'building' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select t.slug into v_slug from cms.tenants t where t.id = v_release.tenant_id;
  if p_bundle_path is not null
     and p_bundle_path is distinct from (v_slug || '/releases/' || v_release.number::text || '.json') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Requests: every given id must be a committed request of this tenant that is
  -- in no release yet.
  if exists (select 1 from pg_catalog.unnest(p_request_ids) as u where u is null) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select pg_catalog.count(distinct u) into v_given from pg_catalog.unnest(p_request_ids) as u;
  update cms.publish_requests pr
  set release_id = v_release.id
  where pr.id = any (p_request_ids)
    and pr.tenant_id = v_release.tenant_id and pr.status = 'committed' and pr.release_id is null;
  get diagnostics v_count = row_count;
  if v_count <> v_given then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Assets: every element must name an asset of this tenant with its one
  -- public path.
  v_given := coalesce(pg_catalog.jsonb_array_length(p_public_assets), 0);
  select pg_catalog.count(*) into v_count
  from pg_catalog.jsonb_array_elements(coalesce(p_public_assets, '[]'::jsonb)) as x (item)
  join cms.assets a
    on pg_catalog.jsonb_typeof(x.item) = 'object'
   and a.tenant_id = v_release.tenant_id
   and a.id::text = x.item ->> 'id'
   and (x.item ->> 'public_path') = (v_slug || '/' || a.id::text || '/' || a.filename);
  if v_count <> v_given
     or v_given <> (select pg_catalog.count(distinct x.item ->> 'id')
                    from pg_catalog.jsonb_array_elements(coalesce(p_public_assets, '[]'::jsonb)) as x (item)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update cms.assets a
  set public_path = x.item ->> 'public_path'
  from pg_catalog.jsonb_array_elements(coalesce(p_public_assets, '[]'::jsonb)) as x (item)
  where a.tenant_id = v_release.tenant_id and a.id::text = x.item ->> 'id' and a.public_path is null;

  update cms.releases r
  set status = p_status,
      bundle_path = p_bundle_path,
      error = p_error,
      delivered_at = case when p_status = 'delivered' then pg_catalog.now() end
  where r.id = v_release.id;
end;
$$;
