-- console_deliveries gains release_number (M4-05), so the console can order a tenant's deliveries
-- newest release first and take the latest 50 in one read: a delivery has no time of its own, and its
-- release_id is a random uuid. The number comes from the delivery's own release (the composite foreign
-- key makes the join total). The view stays security_invoker with the same gate and grants; the new
-- column is last, so create or replace keeps the existing ones.

create or replace view api.console_deliveries with (security_invoker = true) as
select d.release_id, d.site_id, d.tenant_id, d.notify_status, d.notify_attempts, d.notified_at, d.live_status,
       d.live_confirmed_at, d.last_error ->> 'code' as last_error_code, d.last_error ->> 'status' as last_error_status,
       d.first_failed_at, d.next_attempt_at, r.number as release_number
from cms.site_deliveries d
join cms.releases r on r.tenant_id = d.tenant_id and r.id = d.release_id
where (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1 from cms.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
