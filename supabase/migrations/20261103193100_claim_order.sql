-- api.worker_claim_requests returns the claimed requests oldest first (plan Task 11; found on M3-03).
--
-- The M1 function (20261102000900_api_worker.sql) ordered the claimable rows in a CTE but returned
-- them from `UPDATE … RETURNING`, whose rows come back in no guaranteed order. The worker
-- (processPendingRequests) processes them in the returned order, so a newer request could be
-- processed before an older one, and process-request.integration.test.ts failed intermittently.
-- The claim (which rows, the lock, the update) is unchanged; only the result is ordered by
-- requested_at, id. Same signature and result type, so `create or replace` keeps the grants
-- (service_role only). Still SECURITY INVOKER with search_path = ''.

create or replace function api.worker_claim_requests(p_limit int default 10)
returns setof cms.publish_requests
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be at least 1' using errcode = '22023';
  end if;
  return query
  with claimable as (
    select r.id
    from cms.publish_requests r
    where r.status = 'pending'
       or (r.status = 'validating' and r.claimed_at < pg_catalog.now() - interval '5 minutes')
    order by r.requested_at, r.id
    limit p_limit
    for update skip locked
  ), claimed as (
    update cms.publish_requests r
    set status = 'validating', claimed_at = pg_catalog.now(), attempts = r.attempts + 1
    from claimable c
    where r.id = c.id
    returning r.*
  )
  select * from claimed order by claimed.requested_at, claimed.id;
end;
$$;
