-- Alerts by email: one email per incident (spec §8.4, §10.1; plan M3-04; deferred Minor Task 19
-- quality, "repeated alerts on every re-claim").
--
-- The worker's alerts (server log and audit log, decision 10) stay as they are: every alert is
-- still recorded by api.worker_record_alert. What is new is the email to the platform admin, which
-- is sent once per incident however often the alert is raised: a request re-claimed while its
-- failure cannot be stored, a release failed by the sweep and then refused at its finish, or two
-- workers raising the same alert at once. A worker run keeps no state between invocations, so the
-- incidents already emailed are kept in the database, in the audit log the alerts already use: no
-- new table (§4.3 lists the tables).
--
--   api.worker_claim_alert_email(p_tenant_id, p_event, p_incident) returns true exactly once per
--   incident key: the first call records the system event system.alert_email (target_type
--   'alert', details {event, incident}) and returns true, so the caller sends the email; every
--   later call for the same key records nothing and returns false. A partial unique index on
--   details ->> 'incident' (system.alert_email rows only) makes the claim atomic: the insert is
--   ON CONFLICT DO NOTHING, so of two concurrent callers exactly one inserts, and the other waits
--   for it and then inserts nothing. The incident key is the worker's (for example
--   'release.failed:<release id>'); it holds event names and ids only, never content.
--
-- An email that then fails to send is not retried (the incident stays claimed): the alert itself
-- is in the server log and the audit log, which remain the record (§8.4), and the send failure is
-- logged next to it.
--
-- SECURITY INVOKER with search_path = '' and schema-qualified names. EXECUTE is granted to
-- service_role only; PUBLIC has none through Task 4's global default privileges, and it is revoked
-- from anon and authenticated explicitly as well. service_role already holds INSERT on
-- cms.audit_log (decision 10), which is all ON CONFLICT DO NOTHING needs when it names no conflict
-- target (a target would need SELECT on the columns it infers the index from). Without a target
-- any unique violation is skipped; the audit log's only other unique index is its primary key,
-- whose id is always generated, so the incident index is the one that can conflict. service_role
-- gets no SELECT on the audit log, and no grant changes.

create unique index audit_log_alert_email_incident on cms.audit_log ((details ->> 'incident'))
  where action = 'system.alert_email';

-- The first call for an incident key records system.alert_email and returns true; later calls
-- return false. 22023 for an event that is not a dotted lowercase name of at most 100 characters,
-- or an incident key that is not 1-200 characters of [a-z0-9_.:-]; not_found for a tenant id that
-- names no tenant.
create function api.worker_claim_alert_email(p_tenant_id uuid, p_event text, p_incident text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted int;
begin
  if p_event is null or pg_catalog.length(p_event) > 100
     or p_event !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' then
    raise exception 'p_event must be a dotted lowercase name of at most 100 characters' using errcode = '22023';
  end if;
  if p_incident is null or pg_catalog.length(p_incident) > 200 or p_incident !~ '^[a-z0-9_.:-]+$' then
    raise exception 'p_incident must be 1-200 characters of a-z, 0-9, _ . : -' using errcode = '22023';
  end if;
  if p_tenant_id is not null and not exists (select 1 from cms.tenants t where t.id = p_tenant_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
  values (p_tenant_id, null, 'system.alert_email', 'alert', null,
          pg_catalog.jsonb_build_object('event', p_event, 'incident', p_incident))
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function api.worker_claim_alert_email(uuid, text, text) from public, anon, authenticated;
grant execute on function api.worker_claim_alert_email(uuid, text, text) to service_role;
