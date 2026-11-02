-- Reference extraction (spec §4.1 rules 3 and 5, §4.3 "References inside JSON",
-- §4.5; plan Task 7, decisions 3, 25, 26 and 27).
--
-- Every reference in a document, at any depth, is an object
-- { "_ref": "<uuid>", "_kind": "entry" | "asset", ... }. Triggers extract them
-- into draft_refs (on every draft write that changes data) and revision_refs (on
-- revision insert). Both are tenant tables: tenant_id not null and every foreign
-- key composite with tenant_id, so a reference to another tenant's row fails the
-- write with 23503 (§4.1 rule 3). The foreign keys to cms.assets come with that
-- table (Task 8). Grants are exactly those in §4.5; nothing for anon. No
-- SECURITY DEFINER anywhere: the triggers run as the invoking role.

-- Target of revision_refs' composite foreign key (revisions already has
-- unique (tenant_id, entry_id, id) for the publish pointer).
alter table cms.revisions add constraint revisions_tenant_id_id_key unique (tenant_id, id);

-- The primary keys start with tenant_id, so a duplicate key can never reveal
-- another tenant's rows (decision 26). A path is unique within one document.
create table cms.draft_refs (
  tenant_id uuid not null,
  entry_id uuid not null,
  path text not null,
  target_entry_id uuid,
  target_asset_id uuid,
  constraint draft_refs_pkey primary key (tenant_id, entry_id, path),
  constraint draft_refs_one_target check (num_nonnulls(target_entry_id, target_asset_id) = 1),
  constraint draft_refs_tenant_id_entry_id_fkey foreign key (tenant_id, entry_id)
    references cms.entries (tenant_id, id) on delete cascade,
  constraint draft_refs_tenant_id_target_entry_id_fkey foreign key (tenant_id, target_entry_id)
    references cms.entries (tenant_id, id)
);

create table cms.revision_refs (
  tenant_id uuid not null,
  revision_id uuid not null,
  path text not null,
  target_entry_id uuid,
  target_asset_id uuid,
  constraint revision_refs_pkey primary key (tenant_id, revision_id, path),
  constraint revision_refs_one_target check (num_nonnulls(target_entry_id, target_asset_id) = 1),
  constraint revision_refs_tenant_id_revision_id_fkey foreign key (tenant_id, revision_id)
    references cms.revisions (tenant_id, id) on delete restrict,
  constraint revision_refs_tenant_id_target_entry_id_fkey foreign key (tenant_id, target_entry_id)
    references cms.entries (tenant_id, id) on delete restrict
);

-- Every reference in p_data, found by a recursive walk of the document
-- (decision 25). path is the reference object's location as jsonpath text, keys
-- quoted as JSON strings, e.g. $."list"[0]."link"; the document itself is $.
-- _ref must be a JSON string in canonical lowercase 8-4-4-4-12 form, with no
-- version or variant check (the same rule as packages/schema and
-- packages/rich-text), else 22P02. _kind must be exactly "entry" or "asset",
-- else invalid_reference (decision 3). _ref is checked first.
--
-- Nesting limit (§4.3, decision 27): a document nested deeper than 128 levels
-- raises 54000 before anything is walked or validated. Levels count objects and
-- arrays: the document is level 1, a container directly inside a level-n
-- container is level n + 1, and scalars are not levels. Every draft and revision
-- write of data reaches this function through its trigger, so the limit holds
-- for both. (A CHECK constraint would report 23514, not 54000, and would run the
-- same check a second time.)
--
-- The walk is lean (decision 27): it enters only containers with a reference
-- below them, never a reference-free subtree, and a row carries its location
-- (needed for the result), never a subtree.
create function private.extract_refs(p_data jsonb)
returns table (path text, ref uuid, kind text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_doc jsonb;
  r record;
begin
  -- p_data may be a TOAST pointer (a trigger's NEW.data). #> '{}' returns the
  -- document itself, detoasted, so the checks and the walk below do not each
  -- detoast it again.
  v_doc := p_data #> '{}';
  -- $.**{128} is jsonpath depth 128, where the level-129 containers sit (the
  -- document is depth 0). The scan never descends below that depth and stops at
  -- the first match: at most one visit per node, so linear in the document.
  if pg_catalog.jsonb_path_exists(v_doc, 'strict $.**{128} ? (@.type() == "object" || @.type() == "array")') then
    raise exception 'document nested deeper than 128 levels' using errcode = '54000';
  end if;
  if not pg_catalog.jsonb_path_exists(v_doc, 'strict $.**._ref') then
    return;
  end if;
  -- One row per reference object and per container on the way to one: loc is
  -- the jsonpath text; nested says whether a reference sits strictly below, and
  -- only those rows are entered, through steps (the same location as a #> path,
  -- null on rows not entered); ref_value and kind_value are set on reference
  -- objects only. Rows come out level by level, in document order within a level.
  for r in
    with recursive walk (loc, steps, nested, ref_value, kind_value) as (
      select '$'::text, '{}'::text[],
             pg_catalog.jsonb_path_exists(v_doc, 'strict $.**{1 to last}._ref'),
             v_doc -> '_ref',
             case when v_doc -> '_ref' is not null then v_doc -> '_kind' end
      union all
      select w.loc || c.step, case when f.nested then w.steps || c.key end, f.nested, f.ref_value,
             case when f.ref_value is not null then c.value -> '_kind' end
      from walk w
      cross join lateral (select v_doc #> w.steps offset 0) as n (node)
      cross join lateral (
        select '.' || pg_catalog.to_jsonb(e.key)::text, e.key, e.value
        from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(n.node) = 'object' then n.node end) as e
        union all
        select '[' || (a.ord - 1)::text || ']', (a.ord - 1)::text, a.value
        from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(n.node) = 'array' then n.node end)
          with ordinality as a (value, ord)
      ) as c (step, key, value)
      -- Scalars are dropped; -> '_ref' is null except on an object with a _ref key.
      cross join lateral (
        select c.value -> '_ref', pg_catalog.jsonb_path_exists(c.value, 'strict $.**{1 to last}._ref')
        where pg_catalog.jsonb_typeof(c.value) in ('object', 'array')
        offset 0
      ) as f (ref_value, nested)
      where w.nested and (f.ref_value is not null or f.nested)
    )
    select w.loc, w.ref_value, w.kind_value
    from walk w
    where w.ref_value is not null
  loop
    if pg_catalog.jsonb_typeof(r.ref_value) <> 'string'
       or (r.ref_value #>> '{}') !~ ('^[0123456789abcdef]{8}-[0123456789abcdef]{4}-[0123456789abcdef]{4}'
                                      '-[0123456789abcdef]{4}-[0123456789abcdef]{12}$') then
      raise exception 'malformed _ref' using errcode = '22P02', detail = pg_catalog.format('at %s', r.loc);
    end if;
    if r.kind_value is null or r.kind_value not in ('"entry"'::jsonb, '"asset"'::jsonb) then
      raise exception 'invalid_reference' using errcode = 'P0001', detail = pg_catalog.format('_kind at %s', r.loc);
    end if;
    path := r.loc;
    ref := (r.ref_value #>> '{}')::uuid;
    kind := r.kind_value #>> '{}';
    return next;
  end loop;
end;
$$;

-- draft_refs is rebuilt whenever a draft's data is written (§4.3). Two triggers,
-- because a WHEN clause on OLD is not allowed on INSERT; the function re-checks
-- the condition, so it stays correct if the WHEN clause is ever dropped. AFTER
-- triggers see the final row, whatever BEFORE triggers did.
create function private.drafts_sync_refs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then
    return null;
  end if;
  delete from cms.draft_refs d
  where d.tenant_id = new.tenant_id and d.entry_id = new.entry_id;
  insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id, target_asset_id)
  select new.tenant_id, new.entry_id, x.path,
         case when x.kind = 'entry' then x.ref end,
         case when x.kind = 'asset' then x.ref end
  from private.extract_refs(new.data) as x;
  return null;
end;
$$;

create trigger drafts_sync_refs_on_insert
  after insert on cms.drafts
  for each row
  execute function private.drafts_sync_refs();

create trigger drafts_sync_refs_on_update
  after update on cms.drafts
  for each row
  when (old.data is distinct from new.data)
  execute function private.drafts_sync_refs();

-- revision_refs is written once, when the worker appends a revision; revisions
-- are append-only, so there is nothing to rebuild.
create function private.revisions_write_refs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into cms.revision_refs (tenant_id, revision_id, path, target_entry_id, target_asset_id)
  select new.tenant_id, new.id, x.path,
         case when x.kind = 'entry' then x.ref end,
         case when x.kind = 'asset' then x.ref end
  from private.extract_refs(new.data) as x;
  return null;
end;
$$;

create trigger revisions_write_refs
  after insert on cms.revisions
  for each row
  execute function private.revisions_write_refs();

-- The triggers run as the invoking role (editors for drafts, the worker for
-- revisions) and call extract_refs, so those two roles get usage on private and
-- execute on this one function, nothing else in private (§4.5
-- "Reference-extraction grant", decision 26). anon: nothing.
grant usage on schema private to authenticated, service_role;
grant execute on function private.extract_refs(jsonb) to authenticated, service_role;

-- RLS (§4.5): the same tenant-membership policy as the parent tables. The
-- subquery runs under the memberships policy, which permits the user's own rows.
-- Keep every membership predicate below identical (and identical to those of the
-- other tenant tables): a change to one copy is a change to tenant isolation.
alter table cms.draft_refs enable row level security;
alter table cms.revision_refs enable row level security;

create policy draft_refs_select_member on cms.draft_refs
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = draft_refs.tenant_id and m.user_id = (select auth.uid())
  ));

create policy draft_refs_insert_member on cms.draft_refs
  for insert to authenticated
  with check (exists (
    select 1 from cms.memberships m
    where m.tenant_id = draft_refs.tenant_id and m.user_id = (select auth.uid())
  ));

create policy draft_refs_delete_member on cms.draft_refs
  for delete to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = draft_refs.tenant_id and m.user_id = (select auth.uid())
  ));

create policy revision_refs_select_member on cms.revision_refs
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = revision_refs.tenant_id and m.user_id = (select auth.uid())
  ));

-- Grants (§4.5). authenticated: select, insert, delete on draft_refs (the draft
-- trigger needs them); select on revision_refs. service_role (the worker): select
-- on both, insert on revision_refs. Never update, and no delete on revision_refs.
grant select, insert, delete on cms.draft_refs to authenticated;
grant select on cms.revision_refs to authenticated;
grant select on cms.draft_refs, cms.revision_refs to service_role;
grant insert on cms.revision_refs to service_role;
