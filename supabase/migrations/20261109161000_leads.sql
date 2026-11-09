-- Pilot requests from the public landing page. Anonymous visitors may INSERT only; nobody reads through the API
-- (no select policy for anon or authenticated). Read leads in the Supabase dashboard / SQL editor.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company text check (char_length(company) <= 160),
  role text check (char_length(role) <= 60),
  message text check (char_length(message) <= 2000),
  source text not null default 'landing' check (char_length(source) <= 40)
);
create index leads_created on public.leads (created_at);
create index leads_email on public.leads (lower(email), created_at);
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant insert on public.leads to anon, authenticated;
create policy leads_insert_anyone on public.leads for insert to anon, authenticated with check (true);

-- Basic rate limiting at the database (applies even if someone posts straight to the REST API):
-- max 3 per email per hour, max 30 site-wide per 10 minutes.
create or replace function private.leads_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.leads where lower(email) = lower(new.email) and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'rate limited: too many requests for this email' using errcode = 'P0001';
  end if;
  if (select count(*) from public.leads where created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate limited: too many requests, try again shortly' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.leads_rate_limit() from public, anon, authenticated;
create trigger leads_rate_limit before insert on public.leads for each row execute function private.leads_rate_limit();
