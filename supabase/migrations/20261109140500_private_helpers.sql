-- Move RLS helper functions out of the API-exposed public schema (advisor 0028/0029).
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_org_member(uuid, public.member_role[]) set schema private;
alter function public.project_org(uuid) set schema private;
alter function public.is_org_member_path(text) set schema private;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
-- Policies reference the functions by OID, so they keep working after the schema move.
