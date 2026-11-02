-- Schemas and global privileges (spec §4.2, §4.5; plan Task 4, decisions 1 and 16).
--
--   api      exposed through the Data API (config.toml [api] schemas = ["api"]);
--            SECURITY INVOKER functions and security_invoker views only
--   cms      not exposed; all platform tables
--   private  not exposed; trigger functions, internal helpers and the Auth hook
--
-- Supabase's custom-schema recipe (GRANT ALL to anon and authenticated) is never
-- applied to cms (§4.2): grants on cms are exactly those in §4.5, added per table
-- by later migrations.

create schema api;
create schema cms;
create schema private;

-- EXECUTE is revoked from PUBLIC globally through default privileges, not per
-- schema (§4.5): no `in schema` clause, so it covers every function postgres
-- creates from here on, in any schema. Each function is granted explicitly.
alter default privileges for role postgres revoke execute on functions from public;

-- New schemas grant nothing to PUBLIC; stated explicitly so no role reaches
-- them through PUBLIC.
revoke all on schema api, cms, private from public;

-- Schema usage only; no table grants yet (§4.5 grants are per table).
grant usage on schema api to authenticated, service_role;
grant usage on schema cms to authenticated, service_role;
-- anon: nothing on cms or private. private: no usage for anon, authenticated or
-- service_role; the Auth hook migration grants usage to supabase_auth_admin only.

-- GraphQL is not used by the Hub; dropping it removes a surface (decision 1).
drop extension if exists pg_graphql;
