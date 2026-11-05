-- No exposed view carries drafts.data or revisions.data (M5-02; findings 3 and 4 of
-- docs/verification/m5-review.md; spec §4.5, §4.6; plan decision 65). Through a view, PostgREST
-- could return `data` for up to max_rows rows in one request and run an editor's regex over all of
-- them. Editors read one row's data through api.entry_detail_by_id and api.revision_detail_by_id
-- (20261105140000_editor_limits).
--
-- This is a separate migration because an app that still selects `data` from these views fails
-- from here on: every entry page, the draft reload after a conflict, restore and the outdated-draft
-- update. Apply it once the app that uses the by-id functions is live. The other columns keep their
-- names and order. Plain DROP, no CASCADE: nothing depends on either view, and a future dependent
-- should stop this. Both functions name the views in a body, which is resolved at each call.

drop view api.entry_detail;
create view api.entry_detail with (security_invoker = true) as
select e.id, e.tenant_id, e.type, e.slug, d.schema_version, d.version as draft_version,
       e.published_draft_version, e.first_published_at,
       case
         when e.archived_at is not null then 'archived'
         when e.published_rev_id is null then 'draft'
         when d.version = e.published_draft_version then 'published'
         when d.version > e.published_draft_version then 'changed'
       end as status
from cms.entries e
join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id;

drop view api.revision_list;
create view api.revision_list with (security_invoker = true) as
select r.id, r.tenant_id, r.entry_id, r.draft_version, r.schema_version, r.title,
       r.requested_by, r.committed_at,
       coalesce(e.published_rev_id = r.id, false) as is_published
from cms.revisions r
join cms.entries e on e.tenant_id = r.tenant_id and e.id = r.entry_id;

revoke all on api.entry_detail, api.revision_list from public, anon, service_role;
grant select on api.entry_detail, api.revision_list to authenticated;
