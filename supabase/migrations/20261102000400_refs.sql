-- Reference extraction (spec §4.1 rules 3 and 5, §4.3 "References inside JSON",
-- §4.5; plan Task 7, decisions 3, 25, 26, 27 and 28).
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
-- Key-length and reference-count limits (§4.3, decision 28): a document with an
-- object key longer than 64 characters (characters, not bytes, of the key itself,
-- not of its escaped JSON text) or with more than 1,000 references raises 54000,
-- after the nesting check and before anything is walked or validated. A
-- reference is an object with a _ref key, what strict $.**._ref matches.
--
-- The walk (decisions 27 and 28) takes one level of the document per
-- statement, so at most 128 statements, and enters only containers with a
-- reference below them. The containers entered on one level are disjoint and
-- each holds a reference, so there are at most 1,000 of them and together they
-- are no larger than the document. A node of the walk records only its parent's
-- position on the level above and its own step (."key" or [i]), never its path:
-- the path of a reference is put together once, from the steps of its
-- ancestors, when the reference is found. Which children hold references is
-- known from counts: the number of references below each entered container is
-- known; its children are counted with strict $.**._ref, except a child larger
-- than half of it (there is at most one), whose count is the remainder. So a
-- subtree is scanned only when it is at most half its parent, and no part of
-- the document is scanned more than log2 of the document's size times. The
-- children are listed by set-returning functions in select lists, which pass
-- their rows on one at a time instead of storing them in a tuplestore. The
-- state of the walk is in memory, at most about the size of the document in
-- its jsonb form. The one temp file is the result itself: at most 1,000 paths
-- of at most about 8.6 KB, which spill once they pass work_mem (4 MB).
-- Measured locally on documents inside all three limits (040_refs.test.sql,
-- "Cost regressions" and "Adversarial shapes"): at most about 8.5 MB of temp
-- files, for 1,000 paths of 8.4 KB, and at most about 0.5 s per draft save.
create function private.extract_refs(p_data jsonb)
returns table (path text, ref uuid, kind text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_doc jsonb;
  v_refs bigint;
  v_found bigint := 0;
  v_depth int := 0;
  -- The current level: its nodes, in walk order, and the references strictly
  -- below each. A node with none is null in v_nodes and is not entered.
  v_nodes jsonb[];
  v_below int[];
  v_more boolean;
  -- v_levels[l]: one [parent, step] pair per node of level l, in the order of
  -- v_nodes, where parent is a node's 1-based position on level l - 1 (the
  -- document is level 0).
  v_levels jsonb[] := '{}';
  v_level jsonb;
  -- The references found on the current level: parent, step, _ref and _kind.
  v_ref_parent int[];
  v_ref_step text[];
  v_ref_value jsonb[];
  v_ref_kind jsonb[];
  v_steps text[];
  v_pair jsonb;
  v_up int;
  v_loc text;
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
  -- Key length. jsonpath cannot read an object's keys without .keyvalue(),
  -- which copies every value it pairs with a key, so on nested objects it copies
  -- each subtree once per level above it. Instead one left-to-right regular
  -- expression scan of the document's JSON text matches each string in turn: a
  -- match starts at an opening quote and ends at the first unescaped quote, and
  -- between strings the text has no quotes, so every match is exactly one string
  -- of the document, and a string directly followed by ':' is an object key
  -- (jsonb's text output writes "key": value). One pass over the text, linear in
  -- the document. A key's escaped text is never shorter than the key, so only
  -- matches over 64 characters are decoded and measured. regexp_matches is
  -- called in the select list, so its rows reach the filter one at a time and
  -- exists stops at the first long key; in FROM, every row would first be stored
  -- in a tuplestore, which spills to temp files on a large document.
  if exists (
    select 1
    from (select pg_catalog.regexp_matches(v_doc::text, '"((?:[^"\\]|\\.)*)"(:?)', 'g')) as m (a)
    where case when m.a[2] = ':' and pg_catalog.char_length(m.a[1]) > 64
               then pg_catalog.char_length(('"' || m.a[1] || '"')::jsonb #>> '{}') > 64
               else false end
  ) then
    raise exception 'object key longer than 64 characters' using errcode = '54000';
  end if;
  -- Reference count. strict $.**._ref visits each node once (strict, so arrays
  -- are not unwrapped a second time); .type() turns each match into a short
  -- string, so no _ref value is copied. jsonb_path_query computes all its
  -- matches before returning any, at most one per object, so the limit only
  -- stops the counting.
  select pg_catalog.count(*) into v_refs
  from (select from pg_catalog.jsonb_path_query(v_doc, 'strict $.**._ref.type()') limit 1001) as x;
  if v_refs > 1000 then
    raise exception 'more than 1000 references' using errcode = '54000';
  end if;
  if v_refs = 0 then
    return;
  end if;

  -- Level 0 is the document, itself a reference if it has a _ref key. -> '_ref'
  -- is null except on an object with a _ref key (JSON null included), the
  -- objects strict $.**._ref matches.
  if v_doc -> '_ref' is not null then
    v_ref_parent := array[0];
    v_ref_step := array[''];
    v_ref_value := array[v_doc -> '_ref'];
    v_ref_kind := array[v_doc -> '_kind'];
  end if;
  v_nodes := array[v_doc];
  v_below := array[v_refs - (v_doc -> '_ref' is not null)::int];
  v_more := v_below[1] > 0;
  loop
    -- The references found on level v_depth, in walk order, _ref checked
    -- first. A path is the steps of the reference's ancestors, read up through
    -- v_levels, and its own.
    for i in 1 .. coalesce(pg_catalog.array_length(v_ref_parent, 1), 0) loop
      v_steps := pg_catalog.array_fill(''::text, array[greatest(v_depth, 1)]);
      v_steps[greatest(v_depth, 1)] := v_ref_step[i];
      v_up := v_ref_parent[i];
      for d in reverse v_depth - 1 .. 1 loop
        v_pair := v_levels[d] -> (v_up - 1);
        v_steps[d] := v_pair ->> 1;
        v_up := (v_pair ->> 0)::int;
      end loop;
      v_loc := '$' || pg_catalog.array_to_string(v_steps, '');
      if pg_catalog.jsonb_typeof(v_ref_value[i]) <> 'string'
         or (v_ref_value[i] #>> '{}') !~ ('^[0123456789abcdef]{8}-[0123456789abcdef]{4}-[0123456789abcdef]{4}'
                                         '-[0123456789abcdef]{4}-[0123456789abcdef]{12}$') then
        raise exception 'malformed _ref' using errcode = '22P02', detail = pg_catalog.format('at %s', v_loc);
      end if;
      if v_ref_kind[i] is null or v_ref_kind[i] not in ('"entry"'::jsonb, '"asset"'::jsonb) then
        raise exception 'invalid_reference' using errcode = 'P0001', detail = pg_catalog.format('_kind at %s', v_loc);
      end if;
      v_found := v_found + 1;
      path := v_loc;
      ref := (v_ref_value[i] #>> '{}')::uuid;
      kind := v_ref_kind[i] #>> '{}';
      return next;
    end loop;
    exit when not coalesce(v_more, false);
    v_depth := v_depth + 1;

    -- Level v_depth. From the inside out: p lists the entered nodes of the level
    -- above (position i, the node, the references below it); e lists their
    -- children; c keeps the containers and counts the references in each (n),
    -- except in a child larger than half its parent, whose n is null; r keeps
    -- the children with a reference or a null n and gives the latter the
    -- remainder of their parent's count; a child with a count is a node of this
    -- level, and a reference if it has a _ref key. Only r, which holds at most
    -- two rows per entered node and no subtrees, is sorted (for the window); the
    -- node is then read again from its parent. The aggregates have no ORDER BY
    -- and share one input, so position j of v_nodes, v_below and v_level is the
    -- same node.
    select pg_catalog.array_agg(case when y.total > y.is_ref then y.node end),
           pg_catalog.array_agg((y.total - y.is_ref)::int),
           pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(y.parent, y.step)),
           pg_catalog.bool_or(y.total > y.is_ref),
           pg_catalog.array_agg(y.parent) filter (where y.is_ref = 1),
           pg_catalog.array_agg(y.step) filter (where y.is_ref = 1),
           pg_catalog.array_agg(y.node -> '_ref') filter (where y.is_ref = 1),
           pg_catalog.array_agg(y.node -> '_kind') filter (where y.is_ref = 1)
      into v_nodes, v_below, v_level, v_more, v_ref_parent, v_ref_step, v_ref_value, v_ref_kind
    from (
      select r.parent, r.total, v.node, (v.node -> '_ref' is not null)::int,
             case when r.k is null then '[' || r.idx::text || ']' else '.' || pg_catalog.to_jsonb(r.k)::text end
      from (
        select c.parent, c.k, c.idx,
               coalesce(c.n, c.below - coalesce(pg_catalog.sum(c.n) over (partition by c.parent), 0))
        from (
          select c.parent, c.below, c.k, c.idx,
                 case when 2 * pg_catalog.pg_column_size(c.node) > c.parent_size then null
                      else pg_catalog.jsonb_array_length(pg_catalog.jsonb_path_query_array(c.node, 'strict $.**._ref.type()')) end
          from (
            select e.parent, e.below, e.parent_size, e.k, e.idx,
                   case when e.k is null then e.parent_node -> e.idx else e.parent_node -> e.k end
            from (
              -- An object's keys or an array's positions: one of the two
              -- set-returning functions has no rows, and the other's rows come
              -- with a null in its place.
              select p.i, p.below, p.node, pg_catalog.pg_column_size(p.node),
                     pg_catalog.jsonb_object_keys(case when pg_catalog.jsonb_typeof(p.node) = 'object' then p.node end),
                     pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(
                       case when pg_catalog.jsonb_typeof(p.node) = 'array' then p.node end) - 1)
              from (select pg_catalog.generate_subscripts(v_nodes, 1), pg_catalog.unnest(v_nodes), pg_catalog.unnest(v_below))
                as p (i, node, below)
              where p.below > 0
            ) as e (parent, below, parent_node, parent_size, k, idx)
            offset 0
          ) as c (parent, below, parent_size, k, idx, node)
          where pg_catalog.jsonb_typeof(c.node) in ('object', 'array')
          offset 0
        ) as c (parent, below, k, idx, n)
        where c.n is null or c.n > 0
      ) as r (parent, k, idx, total)
      cross join lateral (
        select case when r.k is null then v_nodes[r.parent] -> r.idx else v_nodes[r.parent] -> r.k end offset 0
      ) as v (node)
      where r.total > 0
    ) as y (parent, total, node, is_ref, step);
    v_levels[v_depth] := v_level;
  end loop;
  -- The counts make the walk find exactly the references strict $.**._ref
  -- counted; this guards that.
  if v_found <> v_refs then
    raise exception 'reference walk found % of % references', v_found, v_refs using errcode = 'XX000';
  end if;
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
