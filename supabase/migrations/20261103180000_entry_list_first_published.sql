-- api.entry_list gains first_published_at (spec §10.1 "list views by type with title search and
-- status filter"; plan M2-10).
--
-- The entry list's status filter offers "unpublished" next to draft, published, changed and
-- archived. The derived status (§4.3) is `draft` for every entry without a published revision,
-- so an entry that was published and then unpublished cannot be told from one that never was by
-- the status alone, and unpublishing clears published_rev_id and published_draft_version both.
-- entries.first_published_at stays set once an entry has been published, so the list filters on
-- it: unpublished is `status = 'draft' and first_published_at is not null`.
--
-- Built on the definition in 20261102000800_api_editor.sql. The new column is appended and every
-- other column keeps its name, type and position, so `create or replace` keeps the view's grants
-- (SELECT for authenticated only). Still security_invoker, so RLS on cms.entries and cms.drafts
-- decides the rows. The status expression is unchanged and stays identical to entry_detail's. No
-- index (§10.2): the title search is a substring match within one tenant and type.

create or replace view api.entry_list with (security_invoker = true) as
select e.id, e.tenant_id, e.type, e.slug, d.title, d.sort_at, d.version as draft_version,
       e.published_draft_version,
       case
         when e.archived_at is not null then 'archived'
         when e.published_rev_id is null then 'draft'
         when d.version = e.published_draft_version then 'published'
         when d.version > e.published_draft_version then 'changed'
       end as status,
       e.archived_at, d.updated_at, e.first_published_at
from cms.entries e
join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id;
