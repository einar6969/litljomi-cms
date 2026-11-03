-- api.revision_list: an entry's published revisions, for the editor's revision history and
-- restore (spec §5.5 "Restore from a revision copies its data into the draft (a normal versioned
-- save). Revisions are never modified", §7.1 per-entry rollback; plan M2-16).
--
-- Editors already read cms.revisions under RLS (revisions_select_member, §4.5), but only `api` is
-- exposed through the Data API (§4.2), and no api view or editor function read a revision. This
-- view adds that read and nothing else (Einar, 2026-11-03, on the M2-16 thread): no grant or
-- policy on cms changes. It is security_invoker, so RLS on cms.revisions and cms.entries decides
-- the rows: members of the revision's tenant only, and no platform-admin clause (§4.5: none on
-- content tables). is_published says whether the entry's publish pointer names this revision.
--
-- Restore needs no new function: the CMS app reads one row here with the editor's session, upcasts
-- its data (M2-05) and saves it through api.save_draft as a normal versioned update.

create view api.revision_list with (security_invoker = true) as
select r.id, r.tenant_id, r.entry_id, r.draft_version, r.schema_version, r.data, r.title,
       r.requested_by, r.committed_at,
       coalesce(e.published_rev_id = r.id, false) as is_published
from cms.revisions r
join cms.entries e on e.tenant_id = r.tenant_id and e.id = r.entry_id;

revoke all on api.revision_list from public, anon, service_role;
grant select on api.revision_list to authenticated;
