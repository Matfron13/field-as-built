-- Invite-only accounts: a new auth user is only allowed if its email is on private.invites.
-- (Public signup can't be switched off from our tools, so the database refuses non-invited signups.)
create table private.invites (
  email text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role public.member_role not null default 'foreman',
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);
revoke all on private.invites from public, anon, authenticated;

-- Member directory (names/emails of people in my orgs) for audit display.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  initials text
);
alter table public.profiles enable row level security;
create policy prof_select on public.profiles for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
    where a.user_id = (select auth.uid()) and b.user_id = profiles.user_id));
create policy prof_update_own on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function private.enforce_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.invites i where lower(i.email) = lower(new.email)) then
    raise exception 'Field As-Built is invite-only' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.accept_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (org_id, user_id, role)
    select i.org_id, new.id, i.role from private.invites i where lower(i.email) = lower(new.email)
  on conflict do nothing;
  insert into public.profiles (user_id, email, display_name, initials)
    values (new.id, new.email, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'initials')
  on conflict (user_id) do nothing;
  update private.invites set accepted_at = now() where lower(email) = lower(new.email);
  return new;
end $$;
revoke execute on function private.enforce_invite() from public, anon, authenticated;
revoke execute on function private.accept_invite() from public, anon, authenticated;
-- GoTrue inserts users as supabase_auth_admin, which fires these triggers.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.enforce_invite() to supabase_auth_admin;
grant execute on function private.accept_invite() to supabase_auth_admin;

create trigger fab_invite_only before insert on auth.users for each row execute function private.enforce_invite();
create trigger fab_accept_invite after insert on auth.users for each row execute function private.accept_invite();

-- Global month-to-date model spend (all orgs) for the $9.50 app-level cap. Returns only an aggregate number.
create or replace function public.ai_month_spend() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(greatest(est_cost_usd, coalesce(gateway_cost_usd, 0))), 0)
  from public.ai_usage where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;
revoke execute on function public.ai_month_spend() from public, anon;
grant execute on function public.ai_month_spend() to authenticated;

