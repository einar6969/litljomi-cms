begin;
select plan(5);
-- f1-mvyihf1a: two refused correct-password grants; check nothing was persisted by them
select diag('f1 last_sign_in_at=' || coalesce(u.last_sign_in_at::text,'null') || ' sessions=' || (select count(*) from auth.sessions s where s.user_id = u.id)
  || ' amr=' || coalesce((select string_agg(c.authentication_method, ',' order by c.created_at) from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where s.user_id = u.id), '-'))
from auth.users u where u.email = 'f1-mvyihf1a@probe.local';
select diag('f1 audit actions=' || coalesce((select string_agg(coalesce(payload->>'action','?') || ':' || coalesce(payload->'traits'->>'provider',''), ', ' order by created_at) from auth.audit_log_entries where payload->>'actor_username' = 'f1-mvyihf1a@probe.local'), '-'));
select is((select count(*)::int from auth.mfa_amr_claims where authentication_method = 'password'), 0, 'no password amr claim anywhere');
select is((select count(*)::int from auth.audit_log_entries where payload->>'action' = 'login' and payload->'traits'->>'provider' = 'email' and payload->>'actor_username' = 'f1-mvyihf1a@probe.local'), 0, 'no login audit rows for the refused password grants');
select ok((select count(*) from auth.audit_log_entries) > 0, 'audit log is populated at all (not vacuous)');
select diag('all amr methods seen: ' || (select string_agg(distinct authentication_method, ',') from auth.mfa_amr_claims));
select diag('hook config: ' || coalesce((select string_agg(p.proname || ' secdef=' || p.prosecdef || ' acl=' || coalesce(p.proacl::text,'-'), '; ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'), '-'));
select ok(not has_schema_privilege('authenticator', 'private', 'usage'), 'PostgREST authenticator has no usage on private');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('authenticated', p.oid, 'execute')), 0, 'authenticated cannot execute anything in private');
select * from finish();
rollback;
