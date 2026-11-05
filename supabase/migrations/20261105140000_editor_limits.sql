-- Editor limits (M5-02; findings 3, 4 and 5 of docs/verification/m5-review.md; spec §4.3, §4.5,
-- §4.6; plan decision 65). A hostile editor could use shared Postgres memory and time through the
-- Data API: bulk reads of `data` through the views, regexes run over `data` by PostgREST filters,
-- and unbounded text stored and copied into the audit log.
--
--   1. api.entry_detail_by_id and api.revision_detail_by_id read one entry's or one revision's
--      data. The views lose `data` in the next migration, 20261105140100_view_data_removal, kept
--      separate because the deployed app reads `data` from the views until it is replaced.
--   2. CHECK limits on the text an editor writes. A check runs before the AFTER triggers, so a
--      refused value never reaches the audit copy.
--   3. A request's stored error is bounded before the audit trigger copies it.
--
-- No per-tenant quota (M5 fix plan): the limits bound each value, not a tenant's total.

-- 1. One value, not a row set. PostgREST filters, selects and orders only what a function returns
-- as rows, so a scalar leaves it nothing to run a regex over, and null is "not visible or not
-- there". SECURITY INVOKER and the views underneath: RLS decides, members of the tenant only, with
-- no platform-admin clause (§4.5). The columns are the views', so `status` keeps one definition.
create function api.entry_detail_by_id(p_entry_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object('data', d.data)
  from api.entry_detail v
  join cms.drafts d on d.tenant_id = v.tenant_id and d.entry_id = v.id
  where v.id = p_entry_id
$$;

create function api.revision_detail_by_id(p_revision_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object('data', r.data)
  from api.revision_list v
  join cms.revisions r on r.tenant_id = v.tenant_id and r.id = v.id
  where v.id = p_revision_id
$$;

revoke all on function api.entry_detail_by_id(uuid), api.revision_detail_by_id(uuid) from public, anon, service_role;
grant execute on function api.entry_detail_by_id(uuid), api.revision_detail_by_id(uuid) to authenticated;

-- 2. Limits past anything real content reaches, in characters, not bytes. title, filename and
-- default_alt are a heading, a file name and a sentence; type names come from module code; slug
-- and default_alt match the bounds the app already sends (slugShape, MAX_ALT_LENGTH). original_path
-- is {tenant_id}/{asset_id}/{filename}: 74 characters and a filename. revisions.title has a limit
-- of its own: the worker derives it from the draft's data, not from drafts.title, and revision_list
-- returns it in bulk. NOT VALID first, so a row already over a limit on a hosted project cannot
-- stop the migration. Such a row stays readable, but any update of it is refused until its value
-- is shortened, worker updates included.
alter table cms.entries
  add constraint entries_type_length check (char_length(type) <= 100) not valid,
  add constraint entries_slug_length check (char_length(slug) <= 200) not valid;
alter table cms.drafts
  add constraint drafts_title_length check (char_length(title) <= 500) not valid;
alter table cms.revisions
  add constraint revisions_title_length check (char_length(title) <= 500) not valid;
alter table cms.assets
  add constraint assets_filename_length check (char_length(filename) <= 255) not valid,
  add constraint assets_original_path_length check (char_length(original_path) <= 400) not valid,
  add constraint assets_default_alt_length check (char_length(default_alt) <= 1000) not valid;

-- Validated only where every row passes. A skipped limit still holds for every write; the WARNING
-- names it in the output of `supabase db push`, and it can be validated once the row is fixed.
do $$
declare
  c record;
  v_over boolean;
begin
  for c in
    select * from (values
      ('entries', 'entries_type_length', 'type', 100),
      ('entries', 'entries_slug_length', 'slug', 200),
      ('drafts', 'drafts_title_length', 'title', 500),
      ('revisions', 'revisions_title_length', 'title', 500),
      ('assets', 'assets_filename_length', 'filename', 255),
      ('assets', 'assets_original_path_length', 'original_path', 400),
      ('assets', 'assets_default_alt_length', 'default_alt', 1000)
    ) as l(tbl, con, col, max)
  loop
    execute format('select exists (select 1 from cms.%I where char_length(%I) > %s)', c.tbl, c.col, c.max) into v_over;
    if v_over then
      raise warning 'M5-02: % not validated: cms.%.% holds a value over % characters', c.con, c.tbl, c.col, c.max;
    else
      execute format('alter table cms.%I validate constraint %I', c.tbl, c.con);
    end if;
  end loop;
end;
$$;

-- 3. publish_requests.error is worker-written, but a validation error repeats the draft's paths and
-- so grows with data an editor chose, and api.publication_status returns it. The audit trigger
-- copies it to the append-only log, so this runs on every writer, before that copy. Past 64 KB (the
-- limit of worker_record_alert) only the code stays; the panel then shows its generic text.
create function private.publish_requests_bound_error()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.octet_length(new.error::text) > 65536 then
    new.error := pg_catalog.jsonb_build_object('code', pg_catalog.left(new.error ->> 'code', 100), 'truncated', true);
  end if;
  return new;
end;
$$;

create trigger publish_requests_bound_error
  before update on cms.publish_requests
  for each row
  when (old.error is distinct from new.error)
  execute function private.publish_requests_bound_error();
