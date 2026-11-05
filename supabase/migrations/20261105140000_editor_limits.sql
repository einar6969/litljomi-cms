-- Editor limits (M5-02; findings 3, 4 and 5 of docs/verification/m5-review.md; spec §4.3, §4.5,
-- §4.6; plan decision 65). A hostile editor could use shared Postgres memory and time through the
-- Data API: bulk reads of `data` through the views, regexes run over `data` by PostgREST filters,
-- and unbounded text stored and copied into the audit log.
--
--   0. A preflight: the migration stops, with nothing applied, if an existing row would be frozen
--      by a limit.
--   1. api.entry_detail_by_id and api.revision_detail_by_id read one entry's or one revision's
--      data. The views lose `data` in the next migration, 20261105140100_view_data_removal, kept
--      separate because the deployed app reads `data` from the views until it is replaced.
--   2. CHECK limits on the text an editor writes. A check runs before the AFTER triggers, so a
--      refused value never reaches the audit copy.
--   3. A request's stored error is bounded before the audit trigger copies it.
--   4. A lower statement timeout for editors.
--
-- No per-tenant quota (M5 fix plan): the limits bound each value, not a tenant's total.

-- 0. A check runs on every UPDATE of a row, not only of its column. An entry over a limit could not
-- be withdrawn, because worker_commit_unpublish updates the entry, and an asset over a limit could
-- not be published or archived. A limit must never stop a withdrawal, so such a row stops the
-- migration instead, before anything here runs. drafts and revisions don't stop it: every update of
-- a draft replaces its title, and a revision is never updated. Runbook operations.md section 8 has
-- the same check as a read-only query. Names and counts only: the values are content.
do $$
declare
  v_broken text;
begin
  select pg_catalog.string_agg(c.name || ': ' || c.over || ' row(s)', ', ') into v_broken
  from (
    select 'entries_type_length' as name, count(*) as over from cms.entries where char_length(type) > 100
    union all select 'entries_slug_length', count(*) from cms.entries where char_length(slug) > 200
    union all select 'assets_filename_length', count(*) from cms.assets where char_length(filename) > 255
    union all select 'assets_original_path_length', count(*) from cms.assets where char_length(original_path) > 400
    union all select 'assets_default_alt_length', count(*) from cms.assets where char_length(default_alt) > 1000
  ) c
  where c.over > 0;
  if v_broken is not null then
    raise exception 'M5-02 stopped, nothing applied. Existing rows break a length limit: %', v_broken
      using hint = 'Shorten them first: docs/runbooks/operations.md section 8.';
  end if;
end;
$$;

-- 1. One id, one document, and null for "not visible or not there", so a request can't read or
-- filter across rows. PostgREST can still filter that one document (`pgrst_scalar->>data=match.…`),
-- and can't be told not to per function: the statement timeout in part 4 bounds that. A jsonb value
-- leaves it no result column for a plain `data=` filter, select or order. SECURITY INVOKER and the
-- views underneath: RLS decides, members of the tenant only, with no platform-admin clause (§4.5).
-- The columns are the views', so `status` keeps one definition.
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
-- returns it in bulk. entries and assets are validated as they are added: the preflight has passed.
-- drafts and revisions are NOT VALID first, because an old row over a limit does no harm there.
alter table cms.entries
  add constraint entries_type_length check (char_length(type) <= 100),
  add constraint entries_slug_length check (char_length(slug) <= 200);
alter table cms.drafts
  add constraint drafts_title_length check (char_length(title) <= 500) not valid;
alter table cms.revisions
  add constraint revisions_title_length check (char_length(title) <= 500) not valid;
alter table cms.assets
  add constraint assets_filename_length check (char_length(filename) <= 255),
  add constraint assets_original_path_length check (char_length(original_path) <= 400),
  add constraint assets_default_alt_length check (char_length(default_alt) <= 1000);

-- Validated only where every row passes. A skipped limit still holds for every write; the WARNING
-- names it in the output of `supabase db push`, and it can be validated once the row is fixed.
do $$
declare
  c record;
  v_over boolean;
begin
  for c in
    select * from (values
      ('drafts', 'drafts_title_length'),
      ('revisions', 'revisions_title_length')
    ) as l(tbl, con)
  loop
    execute format('select exists (select 1 from cms.%I where char_length(title) > 500)', c.tbl) into v_over;
    if v_over then
      raise warning 'M5-02: % not validated: cms.%.title holds a value over 500 characters', c.con, c.tbl;
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

-- 4. Down from 8 s, the value the Supabase image gives authenticated (no migration here sets it;
-- anon has 3 s and authenticator 8 s the same way). It bounds what a filter can cost, on one
-- document or on the short text the views still carry. No editor call comes near it: on 20,000
-- entries, the slowest was a first save of a 1 MB draft with 1,000 references, at 0.2 s locally;
-- lists, publish requests and restore took under 20 ms. Lock waits end here too, before
-- authenticator's 8 s lock_timeout. The worker's service_role keeps its 10 s. PostgREST applies the
-- impersonated role's settings to every request and re-reads them on this notification, delivered
-- when the migration commits, as in 20261102001100_worker_phase3.
alter role authenticated set statement_timeout = '3s';
notify pgrst, 'reload config';
