-- Audit log and its triggers (spec §4.3, §4.5, §4.7; plan Task 10, decisions 10,
-- 11 and 12).
--
-- Audit events are written by triggers, never by callers (§4.7): the triggers
-- below run as the invoking role and insert into cms.audit_log; no api function
-- writes to it directly. audit_log is append-only: no UPDATE or DELETE for anon,
-- authenticated or service_role (§4.3, §4.5); only the table owner (migrations,
-- the owner-run offboarding procedure of §8.3) keeps them. It is not a tenant
-- table (§4.3): tenant_id is nullable, null for platform events, and it has its
-- own policies. No SECURITY DEFINER anywhere: the trigger functions are invoker
-- functions in private and are granted to no API role (triggers fire without
-- an EXECUTE check).

create table cms.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  actor_id uuid default auth.uid(),
  action text not null,
  target_type text not null,
  target_id uuid,
  at timestamptz not null default now(),
  details jsonb
);

-- actor_id and at are set by the database, never by the caller (§4.3, §4.7).
-- Whenever auth.uid() is not null (an editor's request), actor_id is that user,
-- whatever the insert named. Otherwise (the worker, the CLI through api.admin_*,
-- the owner) the trigger that writes the event names the actor: the worker's
-- recorded requester (for example publish_requests.requested_by), or null for a
-- system event. A system event's action is prefixed 'system.' (decision 12),
-- here in one place, so every event without an actor carries the prefix
-- whichever trigger or worker function wrote it. at is always the database
-- clock.
--
-- A BEFORE trigger whose name sorts after this one could still change NEW; for
-- editors the insert policy's WITH CHECK (actor_id = auth.uid()) runs after
-- every BEFORE trigger and refuses such a row.
create function private.audit_force_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    new.actor_id := v_uid;
  end if;
  if new.actor_id is null and not pg_catalog.starts_with(new.action, 'system.') then
    new.action := 'system.' || new.action;
  end if;
  new.at := pg_catalog.now();
  return new;
end;
$$;

create trigger audit_log_force_actor
  before insert on cms.audit_log
  for each row
  execute function private.audit_force_actor();

-- Audited in v1 (§4.7). Each trigger below writes the event with the actor it
-- knows; audit_force_actor replaces it with auth.uid() whenever that is set.
--   entries           entry.created (insert), entry.slug_changed, entry.archived
--   assets            asset.registered (insert), asset.updated (focal point or
--                     default alt), asset.archived
--   publish_requests  publish_request.created (insert; details.action is publish
--                     or unpublish), publish_request.<new status> on every
--                     status change (claims, commits, rejections, supersessions,
--                     failures), actor: the request's requester
--   releases          release.<new status> on every status change (delivery and
--                     failure); no requester, so a system event
--   memberships       membership.added, membership.removed (made by the CLI)
-- Draft autosaves are not audited (§4.7): drafts.updated_by and updated_at
-- record the last editor. Archiving is the transition from not archived to
-- archived.

create function private.audit_entries()
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
  return null;
end;
$$;

create trigger entries_audit_insert
  after insert on cms.entries
  for each row
  execute function private.audit_entries();

create trigger entries_audit_update
  after update on cms.entries
  for each row
  when (old.slug is distinct from new.slug or (old.archived_at is null and new.archived_at is not null))
  execute function private.audit_entries();

create function private.audit_assets()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'asset.registered', 'asset', new.id,
            pg_catalog.jsonb_build_object('filename', new.filename, 'mime', new.mime, 'bytes', new.bytes));
    return null;
  end if;
  if (new.focal_x, new.focal_y, new.default_alt) is distinct from (old.focal_x, old.focal_y, old.default_alt) then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'asset.updated', 'asset', new.id,
            pg_catalog.jsonb_build_object('focal_x', new.focal_x, 'focal_y', new.focal_y,
                                          'default_alt', new.default_alt));
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'asset.archived', 'asset', new.id, null);
  end if;
  return null;
end;
$$;

create trigger assets_audit_insert
  after insert on cms.assets
  for each row
  execute function private.audit_assets();

create trigger assets_audit_update
  after update on cms.assets
  for each row
  when ((old.focal_x, old.focal_y, old.default_alt) is distinct from (new.focal_x, new.focal_y, new.default_alt)
        or (old.archived_at is null and new.archived_at is not null))
  execute function private.audit_assets();

-- The actor of a request's events is its requester: the editor who inserted it
-- (auth.uid(), decision 11) and, for the worker's status changes, the recorded
-- requested_by (§4.7).
create function private.audit_publish_requests()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, new.requested_by, 'publish_request.created', 'publish_request', new.id,
            pg_catalog.jsonb_build_object('entry_id', new.entry_id, 'action', new.action,
                                          'draft_version', new.draft_version));
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, new.requested_by, 'publish_request.' || new.status, 'publish_request', new.id,
            pg_catalog.jsonb_build_object('entry_id', new.entry_id, 'action', new.action,
                                          'draft_version', new.draft_version, 'from', old.status,
                                          'to', new.status, 'revision_id', new.revision_id, 'error', new.error));
  end if;
  return null;
end;
$$;

create trigger publish_requests_audit_insert
  after insert on cms.publish_requests
  for each row
  execute function private.audit_publish_requests();

create trigger publish_requests_audit_update
  after update on cms.publish_requests
  for each row
  when (old.status is distinct from new.status)
  execute function private.audit_publish_requests();

create function private.audit_releases()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'release.' || new.status, 'release', new.id,
            pg_catalog.jsonb_build_object('number', new.number, 'from', old.status, 'to', new.status,
                                          'bundle_path', new.bundle_path, 'error', new.error));
  end if;
  return null;
end;
$$;

create trigger releases_audit_update
  after update on cms.releases
  for each row
  when (old.status is distinct from new.status)
  execute function private.audit_releases();

-- Membership changes are made by the CLI (§4.7, decision 5); target_id is the
-- member's user id.
create function private.audit_memberships()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'membership.added', 'membership', new.user_id,
            pg_catalog.jsonb_build_object('role', new.role));
  else
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (old.tenant_id, null, 'membership.removed', 'membership', old.user_id,
            pg_catalog.jsonb_build_object('role', old.role));
  end if;
  return null;
end;
$$;

create trigger memberships_audit
  after insert or delete on cms.memberships
  for each row
  execute function private.audit_memberships();

-- RLS (§4.5, §4.7).
alter table cms.audit_log enable row level security;

-- Editors insert only through the triggers above: an event about a tenant they
-- are a member of, with themselves as the actor. The membership predicate is
-- identical to the other tenant tables'; keep it so.
create policy audit_log_insert_member on cms.audit_log
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and exists (
      select 1 from cms.memberships m
      where m.tenant_id = audit_log.tenant_id and m.user_id = (select auth.uid())
    )
  );

-- Console read (§4.5): every event, for a platform admin at aal2 only. Keep the
-- predicate identical to tenants_select_console. Editors have no select policy,
-- so they read nothing.
create policy audit_log_select_console on cms.audit_log
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from cms.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

-- Grants (§4.5). authenticated: INSERT so the triggers can run, SELECT for the
-- console policy. service_role: INSERT, because the worker's and the CLI's
-- writes fire the triggers above (and decision 10's alerts are audit events).
-- Never UPDATE or DELETE for any API role. id is generated always, so no
-- caller chooses it either. anon: none.
grant select, insert on cms.audit_log to authenticated;
grant insert on cms.audit_log to service_role;
