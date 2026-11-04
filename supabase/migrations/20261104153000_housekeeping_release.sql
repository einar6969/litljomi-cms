-- Housekeeping release after a withdrawal (spec §5.6 "Withdrawal", §7.2 "Retention", §8.4
-- "remove content urgently"; security fix, Thread D).
--
-- Retention (M3-06) keeps the current and the previous release public, and deletes a release once
-- the second delivered release above it is an hour old. So after release N withdraws something,
-- release N-1, which still carries it, stays public until a release N+1 is delivered and an hour
-- has passed. A tenant that never publishes again would keep the withdrawn entry, and the media
-- only it referenced, public for ever.
--
-- Now the sweep's build selection also lists a tenant whose latest delivered release withdrew
-- something from the delivered release before it, and the sweep builds the next release at once:
-- a housekeeping release, built like any other from the database's published state (§7.1), with
-- no linked requests when nothing else was committed. N-1 then expires an hour after it is
-- delivered, under the unchanged §7.2 rule, and the withdrawn bundle and media leave public storage.
--
-- A delivered release D "withdrew something" when the tenant has a delivered release P numbered
-- below it (the latest such) and
--   - an unpublish request is linked to D (the entry left the site with D), or
--   - P referenced media that D does not (releases.public_assets, recorded before copying, M3-06):
--     an image an editor removed or replaced, which §5.6 also withdraws.
-- A housekeeping release withdraws nothing from D (same published state), so it is listed once and
-- the selection stops; whatever is committed or unpublished meanwhile is built with it, as always.
-- A tenant without a delivered release before D had nothing public to withdraw.
--
-- The rest of the selection is unchanged: active tenants only (§8.4), and not while the tenant's
-- latest release failed and its next attempt is not due (M3-02), unless a request was made after
-- that build began. A failed housekeeping build is therefore retried on the same schedule.
--
-- Same name, arguments, return type and body language, so `create or replace` keeps the grants
-- (EXECUTE for service_role only, revoked from PUBLIC, anon and authenticated, M3-02). Still
-- SECURITY INVOKER, stable, search_path = ''. No new function, grant or column.

create or replace function api.worker_tenants_to_release(p_now timestamptz)
returns table (tenant_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_now is null then
    raise exception 'p_now is required' using errcode = '22023';
  end if;
  return query
  select t.id
  from cms.tenants t
  where t.status = 'active'
    and (exists (select 1 from cms.publish_requests pr
                 where pr.tenant_id = t.id and pr.status = 'committed' and pr.release_id is null)
         or exists (
           -- The latest delivered release withdrew something from the delivered release before it.
           select 1
           from (select d.id, d.number, d.public_assets from cms.releases d
                 where d.tenant_id = t.id and d.status = 'delivered'
                 order by d.number desc limit 1) as d
           join lateral (select p.public_assets from cms.releases p
                         where p.tenant_id = t.id and p.status = 'delivered' and p.number < d.number
                         order by p.number desc limit 1) as p on true
           where exists (select 1 from cms.publish_requests u
                         where u.tenant_id = t.id and u.release_id = d.id and u.action = 'unpublish')
              or not (coalesce(p.public_assets, '{}') <@ coalesce(d.public_assets, '{}'))))
    and not exists (
      select 1
      from (select l.status, l.created_at, l.next_attempt_at from cms.releases l
            where l.tenant_id = t.id order by l.number desc limit 1) as latest
      where latest.status = 'failed'
        and (latest.next_attempt_at is null or latest.next_attempt_at > p_now)
        and not exists (select 1 from cms.publish_requests pr
                        where pr.tenant_id = t.id and pr.status = 'committed' and pr.release_id is null
                          and pr.requested_at > latest.created_at))
  order by t.id;
end;
$$;
