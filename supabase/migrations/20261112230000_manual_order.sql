-- A12: manual ordering of a type's entries (docs/clients/dld/ENHANCEMENTS.md A12; spec §4.3, §4.5,
-- §4.6, §4.7, §5.1, §7.2). A module opts a type in with `orderBy: 'manual'`; the database knows
-- nothing of that (§4.1 rule 1) and keeps an order for every type, which only such a type uses.
--
--   1. cms.entries gains order_key, nullable, with one check.
--   2. authenticated may update order_key (a column grant); nothing new on insert.
--   3. api.move_entry(p_entry_id, p_target_id, p_place): moves one entry just before or just after
--      another of the same tenant and type.
--   4. api.entry_list gains order_position, appended.
--   5. api.worker_release_snapshot gives each entry its order_rank.
--   6. The audit event entry.moved.
--
-- The order (one expression, written out in parts 3, 4 and 5; keep the three identical; the pgTAP
-- test 118_manual_order checks that they agree). Entries are listed by their position, ascending,
-- then by id:
--
--   position = coalesce(order_key,
--                       - extract(epoch from created_at)
--                       + (the last 12 hex digits of id, as a number) * 1e-22)
--
--   - An entry nobody has moved has no order_key. Its position is minus its creation time in
--     seconds (to the microsecond), so the newest comes first, plus a fraction below 3e-8 seconds
--     taken from its id, so two entries created in the same microsecond (one transaction) still
--     have different positions. A new entry of a manually ordered type therefore comes first, and
--     the existing entries of a type that becomes manually ordered start newest first, with
--     nothing written to them.
--   - A move writes the moved entry's order_key only: a number strictly between the positions of
--     its two new neighbours, the shortest decimal in the middle half of the space between them. numeric is exact
--     and has no fixed scale, so there is always room between two neighbours and no other row is
--     ever renumbered. Gaps are never filled or closed, and nothing depends on their size.
--   - To the front, the lower bound is the first entry's position or minus the current time,
--     whichever is lower, less 1e-7 seconds. The key lands above that bound, and an entry created
--     a microsecond or more later has a position below it, so a new entry still comes first.
--   - To the end, the upper bound is the last entry's position plus 1.
--   - Ties: two positions can be equal only for two unmoved entries created in the same
--     microsecond whose ids end in the same 12 hex digits, or by an owner's direct write. The list
--     then orders them by id, and a move into the space between exactly those two is refused
--     (forbidden); every other move works. Moves are serialized per tenant and type (part 3), so
--     two moves never choose the same key.
--   - Archived entries keep their key and are never a neighbour.
--
-- Delivery (§7.2): a manually ordered type's entries are listed in the bundle in this order. The
-- order is the entries' current one when a release is built, not part of any revision: a move
-- reaches the sites with the tenant's next release, and sort_at is untouched.
--
-- Additive and forward-only, because production has no backups and the app that is live when this
-- lands must keep working until the next one is deployed:
--   - nothing is dropped, no function changes its signature or result type, and no row is
--     rewritten (every existing entry keeps a null order_key);
--   - the one new CHECK is on the new column, null on every existing row;
--   - api.entry_list keeps its twelve columns, names, types and order, and so its grants (CREATE OR
--     REPLACE VIEW); api.worker_release_snapshot keeps its signature, owner and grants, and only
--     adds a key to each entry object, which the deployed worker ignores;
--   - private.audit_entries keeps its signature, and the trigger is replaced in place.
--
-- Every function is SECURITY INVOKER with search_path = '' and schema-qualified names; the view is
-- security_invoker. api.move_entry is for authenticated only. Errors follow decision 3: P0001 with
-- not_found, tenant_inactive or forbidden; 22023 for a place that is not 'before' or 'after'.

-- Every lock below is held to the end of this migration's transaction, and while one waits, every
-- new request on that table queues behind it. So no wait may be long: past 5 s the migration
-- fails, whole, having changed nothing, and is simply run again (docs/runbooks/operations.md §8).
-- The ALTER locks cms.entries for the moment a metadata change and the check's scan of a small
-- table take. One ring can form, as in 20261112200000_media_library.sql: part 4 replaces
-- api.entry_list while this transaction holds cms.entries, and a read that opened the view just
-- before waits for cms.entries; the deadlock detector, or else the timeout, cancels one of the two.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1 and 2. The column, its check and its grant.
--
-- The check bounds the value: finite (NaN sorts above every number in numeric and fails the upper
-- bound, and the infinities fail one bound each), within a range far wider than any position
-- (about -1.8e9 today), and at most 1,000 decimal places. A key needs a digit more only when the
-- space it lands in is tighter than any before, about one digit per three moves into the same
-- space, so the cap is reached only after thousands of moves between the same two entries; that
-- move is then refused (23514) and every other still works.
alter table cms.entries
  add column order_key numeric,
  add constraint entries_order_key_range check (
    order_key > -1e15 and order_key < 1e15 and pg_catalog.scale(order_key) <= 1000
  );

-- §4.5: one more UPDATE column. Nothing for INSERT: a new entry has no key, so it comes first.
-- cms is not exposed, so the only route to the column is api.move_entry.
grant update (order_key) on cms.entries to authenticated;

-- ---------------------------------------------------------------------------
-- 3. api.move_entry: moves p_entry_id just before (p_place 'before') or just after ('after')
-- p_target_id. The tenant and the type come from the moved entry's row (not_found when the caller
-- cannot see it), then the tenant row is locked FOR SHARE through the lock-only grant and its status
-- read, as in api.update_asset_text, so a suspension waits for the move or is seen as
-- tenant_inactive. Then a transaction-scoped advisory lock on (tenant, type), the key
-- private.entries_check_singleton takes for a new entry, serializes moves and creations of the
-- type, and every read after it is a new statement (READ COMMITTED), so it sees the moves that
-- went before. The target must be visible (not_found), of the same tenant and type, another entry,
-- and neither may be archived (forbidden). A target of another tenant the caller is not a member
-- of is not_found, one of a tenant the caller also belongs to is forbidden: no move crosses
-- tenants. An entry that is already in the place asked for is left as it is (no write, no audit).
create function api.move_entry(p_entry_id uuid, p_target_id uuid, p_place text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_type text;
  v_status text;
  v_archived_at timestamptz;
  v_position numeric;
  v_target_tenant_id uuid;
  v_target_type text;
  v_target_archived_at timestamptz;
  v_target_position numeric;
  v_lo numeric;
  v_hi numeric;
  v_mid numeric;
  v_quarter numeric;
  v_key numeric;
begin
  if p_place is null or p_place not in ('before', 'after') then
    raise exception 'p_place must be before or after' using errcode = '22023';
  end if;
  select e.tenant_id, e.type into v_tenant_id, v_type
  from cms.entries e
  where e.id = p_entry_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select t.status into v_status from cms.tenants t where t.id = v_tenant_id for share;
  if v_status is distinct from 'active' then
    raise exception 'tenant_inactive' using errcode = 'P0001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant_id::text || '/' || v_type, 0));

  select e.archived_at,
         coalesce(e.order_key, - extract(epoch from e.created_at)
                               + ('x' || pg_catalog.right(e.id::text, 12))::bit(48)::bigint * 1e-22)
    into v_archived_at, v_position
  from cms.entries e
  where e.id = p_entry_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select e.tenant_id, e.type, e.archived_at,
         coalesce(e.order_key, - extract(epoch from e.created_at)
                               + ('x' || pg_catalog.right(e.id::text, 12))::bit(48)::bigint * 1e-22)
    into v_target_tenant_id, v_target_type, v_target_archived_at, v_target_position
  from cms.entries e
  where e.id = p_target_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_target_tenant_id <> v_tenant_id or v_target_type <> v_type or p_target_id = p_entry_id
     or v_archived_at is not null or v_target_archived_at is not null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- The target's neighbour on the side the entry goes to, among the type's live entries other than
  -- the moved one, in list order (position, then id).
  if p_place = 'before' then
    v_hi := v_target_position;
    select n.pos into v_lo
    from (
      select e.id,
             coalesce(e.order_key, - extract(epoch from e.created_at)
                                   + ('x' || pg_catalog.right(e.id::text, 12))::bit(48)::bigint * 1e-22) as pos
      from cms.entries e
      where e.tenant_id = v_tenant_id and e.type = v_type and e.archived_at is null and e.id <> p_entry_id
    ) n
    where (n.pos, n.id) < (v_target_position, p_target_id)
    order by n.pos desc, n.id desc
    limit 1;
    if v_lo is null then
      v_lo := least(- extract(epoch from pg_catalog.clock_timestamp()), v_hi) - 1e-7;
    end if;
  else
    v_lo := v_target_position;
    select n.pos into v_hi
    from (
      select e.id,
             coalesce(e.order_key, - extract(epoch from e.created_at)
                                   + ('x' || pg_catalog.right(e.id::text, 12))::bit(48)::bigint * 1e-22) as pos
      from cms.entries e
      where e.tenant_id = v_tenant_id and e.type = v_type and e.archived_at is null and e.id <> p_entry_id
    ) n
    where (n.pos, n.id) > (v_target_position, p_target_id)
    order by n.pos, n.id
    limit 1;
    if v_hi is null then
      v_hi := v_lo + 1;
    end if;
  end if;

  -- Already there: strictly between the two neighbours.
  if v_position > v_lo and v_position < v_hi then
    return;
  end if;
  -- Two neighbours with the same position (see the header): no key fits between them.
  if not v_lo < v_hi then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  -- The shortest decimal in the middle half of the space between the two: short, so keys stay
  -- small, and in the middle half, so each move into the same space leaves at least a quarter of it
  -- on either side and a key needs about one more digit only every few moves there. The midpoint
  -- itself is exact (multiplying a numeric is) and is reached at its own scale, so the loop always
  -- ends with a key.
  v_mid := (v_lo + v_hi) * 0.5;
  v_quarter := (v_hi - v_lo) * 0.25;
  for v_scale in 0 .. pg_catalog.scale(v_mid) loop
    v_key := pg_catalog.round(v_mid, v_scale);
    exit when v_key > v_lo + v_quarter and v_key < v_hi - v_quarter;
  end loop;
  update cms.entries e set order_key = v_key where e.id = p_entry_id;
end;
$$;

revoke all on function api.move_entry(uuid, uuid, text) from public, anon, service_role;
grant execute on function api.move_entry(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. api.entry_list, built on the definition in 20261103180000_entry_list_first_published.sql.
-- order_position (the position above) is appended and every other column keeps its name, type and
-- position, so `create or replace` keeps the view's grants (SELECT for authenticated only). The
-- option is repeated: a replace without it would clear security_invoker. The editor orders a
-- manually ordered type's list by order_position, then id. It is computed, never stored, so a
-- request sorting by it reads the tenant's rows of the type, which a list of a type does anyway.
create or replace view api.entry_list with (security_invoker = true) as
select e.id, e.tenant_id, e.type, e.slug, d.title, d.sort_at, d.version as draft_version,
       e.published_draft_version,
       case
         when e.archived_at is not null then 'archived'
         when e.published_rev_id is null then 'draft'
         when d.version = e.published_draft_version then 'published'
         when d.version > e.published_draft_version then 'changed'
       end as status,
       e.archived_at, d.updated_at, e.first_published_at,
       coalesce(e.order_key, - extract(epoch from e.created_at)
                             + ('x' || pg_catalog.right(e.id::text, 12))::bit(48)::bigint * 1e-22) as order_position
from cms.entries e
join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id;

-- ---------------------------------------------------------------------------
-- 5. api.worker_release_snapshot, as in 20261105130000_withdrawal_safety.sql plus one key on each
-- entry: order_rank, the entry's place (from 1) among the snapshot's entries of its type, by
-- position and then id. The worker lists a manually ordered type's entries in the bundle by it;
-- every other type keeps the order it had (by entry id), so existing sites see no change. The
-- entries array keeps its order. Same signature, result, owner and grants (CREATE OR REPLACE):
-- service_role only.
create or replace function api.worker_release_snapshot(p_release_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with rel as (
    select r.id, r.tenant_id, r.number, r.status from cms.releases r where r.id = p_release_id
  ),
  live as (
    select e.id as entry_id, e.tenant_id, e.type, e.slug, e.first_published_at, e.last_published_at,
           v.id as revision_id, v.schema_version, v.data, v.title, v.sort_at,
           coalesce(e.order_key, - extract(epoch from e.created_at)
                                 + ('x' || pg_catalog.right(e.id::text, 12))::bit(48)::bigint * 1e-22) as order_position
    from rel
    join cms.entries e on e.tenant_id = rel.tenant_id
    join cms.revisions v on v.tenant_id = e.tenant_id and v.entry_id = e.id and v.id = e.published_rev_id
    where e.published_rev_id is not null and e.archived_at is null
  ),
  published as (
    select l.*, pg_catalog.row_number() over (partition by l.type order by l.order_position, l.entry_id) as order_rank
    from live l
  ),
  refs as (
    select rr.revision_id, rr.path, rr.target_entry_id, rr.target_asset_id
    from published p
    join cms.revision_refs rr on rr.tenant_id = p.tenant_id and rr.revision_id = p.revision_id
  )
  select pg_catalog.jsonb_build_object(
           'release', pg_catalog.jsonb_build_object('id', rel.id, 'tenant_id', rel.tenant_id, 'number', rel.number,
                                                    'status', rel.status),
           'tenant', (select pg_catalog.jsonb_build_object('id', t.id, 'slug', t.slug)
                      from cms.tenants t where t.id = rel.tenant_id),
           'entries', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'entry_id', p.entry_id, 'type', p.type, 'slug', p.slug, 'revision_id', p.revision_id,
                      'schema_version', p.schema_version, 'data', p.data, 'title', p.title, 'sort_at', p.sort_at,
                      'first_published_at', p.first_published_at, 'last_published_at', p.last_published_at,
                      'order_rank', p.order_rank,
                      'refs', coalesce((
                        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'path', x.path,
                                 'kind', case when x.target_entry_id is not null then 'entry' else 'asset' end,
                                 'id', coalesce(x.target_entry_id, x.target_asset_id))
                               order by x.path)
                        from refs x where x.revision_id = p.revision_id), '[]'::jsonb))
                    order by p.type, p.entry_id)
             from published p), '[]'::jsonb),
           'assets', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'id', a.id, 'original_path', a.original_path, 'filename', a.filename, 'mime', a.mime,
                      'width', a.width, 'height', a.height, 'focal_x', a.focal_x, 'focal_y', a.focal_y,
                      'default_alt', a.default_alt, 'public_path', a.public_path,
                      'archived', a.archived_at is not null)
                    order by a.id)
             from cms.assets a
             where a.tenant_id = rel.tenant_id
               and a.id in (select x.target_asset_id from refs x where x.target_asset_id is not null)), '[]'::jsonb),
           'requests', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'id', pr.id, 'entry_id', pr.entry_id, 'action', pr.action, 'revision_id', pr.revision_id,
                      'was_delivered', api.worker_entry_was_delivered(rel.id, pr.entry_id))
                    order by pr.requested_at, pr.id)
             from cms.publish_requests pr
             where pr.tenant_id = rel.tenant_id and pr.status = 'committed' and pr.release_id is null), '[]'::jsonb))
    into v_result
  from rel;
  if v_result is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Audit (§4.7): entry.moved, with the key before and after (null before an entry's first move).
-- The function is as in 20261102000700_audit.sql otherwise; the trigger is replaced in place,
-- which touches no row.
create or replace function private.audit_entries()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'entry.created', 'entry', new.id,
            pg_catalog.jsonb_build_object('type', new.type, 'slug', new.slug));
    return null;
  end if;
  if new.slug is distinct from old.slug then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'entry.slug_changed', 'entry', new.id,
            pg_catalog.jsonb_build_object('from', old.slug, 'to', new.slug));
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'entry.archived', 'entry', new.id, null);
  end if;
  if new.order_key is distinct from old.order_key then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'entry.moved', 'entry', new.id,
            pg_catalog.jsonb_build_object('from', old.order_key, 'to', new.order_key));
  end if;
  return null;
end;
$$;

-- Keep this WHEN clause identical to the function's IF conditions above.
create or replace trigger entries_audit_update
  after update on cms.entries
  for each row
  when (old.slug is distinct from new.slug or (old.archived_at is null and new.archived_at is not null)
        or old.order_key is distinct from new.order_key)
  execute function private.audit_entries();
