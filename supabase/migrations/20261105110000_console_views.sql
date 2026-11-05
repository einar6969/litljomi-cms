-- The console's read surface (spec §4.5 "Console reads", §4.6, §8.4; plan M4-03).
--
-- cms is not exposed, so the console reads through these security_invoker views. They run as the
-- signed-in admin, under the console policies of §4.5: nothing here adds a policy, a table grant or
-- a clause on a content table, and no view reads a content table.
--
-- console_admin is the caller's own platform_admins row at any aal, which is how the console tells
-- an admin who still needs TOTP from everyone else. The other six carry the console policies' gate
-- in their own where clause, because RLS alone would also let them return the rows of a tenant the
-- caller is a member of: an editor's own rows must not appear. Keep each gate identical to
-- tenants_select_console.
--
-- Columns are what §8.4 needs and no more. console_sites has no secret reference, and the column
-- grant on cms.sites would refuse one anyway. No view carries content, or the audit log's details.
--
-- The three jsonb error columns are never shown whole, only their stable fields, because each can
-- hold free text: releases.error has the failure's message, which can quote a corrupt bundle, and
-- entries' projection errors; publish_requests.error has validation messages, which can echo an
-- item's _key; site_deliveries.last_error has site paths, which name slugs and media files.

create view api.console_admin with (security_invoker = true) as
select pa.user_id
from cms.platform_admins pa
where pa.user_id = (select auth.uid());

create view api.console_tenants with (security_invoker = true) as
select t.id, t.slug, t.name, t.status, t.created_at
from cms.tenants t
where (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1 from cms.platform_admins pa
    where pa.user_id = (select auth.uid())
  );

create view api.console_requests with (security_invoker = true) as
select r.id, r.tenant_id, r.action, r.status, r.requested_at, r.claimed_at, r.error ->> 'code' as error_code
from cms.publish_requests r
where (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1 from cms.platform_admins pa
    where pa.user_id = (select auth.uid())
  );

create view api.console_releases with (security_invoker = true) as
select r.id, r.tenant_id, r.number, r.status, r.created_at, r.delivered_at,
       r.error ->> 'code' as error_code, r.error ->> 'step' as error_step
from cms.releases r
where (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1 from cms.platform_admins pa
    where pa.user_id = (select auth.uid())
  );

create view api.console_sites with (security_invoker = true) as
select s.id, s.tenant_id, s.base_url, s.active
from cms.sites s
where (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1 from cms.platform_admins pa
    where pa.user_id = (select auth.uid())
  );

create view api.console_deliveries with (security_invoker = true) as
select d.release_id, d.site_id, d.tenant_id, d.notify_status, d.notify_attempts, d.notified_at, d.live_status,
       d.live_confirmed_at, d.last_error ->> 'code' as last_error_code, d.last_error ->> 'status' as last_error_status,
       d.first_failed_at, d.next_attempt_at
from cms.site_deliveries d
where (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1 from cms.platform_admins pa
    where pa.user_id = (select auth.uid())
  );

create view api.console_audit with (security_invoker = true) as
select l.id, l.tenant_id, l.at, l.actor_id, l.action, l.target_type, l.target_id
from cms.audit_log l
where (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1 from cms.platform_admins pa
    where pa.user_id = (select auth.uid())
  );

revoke all on api.console_admin, api.console_tenants, api.console_requests, api.console_releases, api.console_sites,
  api.console_deliveries, api.console_audit from public, anon, service_role;
grant select on api.console_admin, api.console_tenants, api.console_requests, api.console_releases, api.console_sites,
  api.console_deliveries, api.console_audit to authenticated;
