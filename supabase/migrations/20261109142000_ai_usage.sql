-- Per-call model usage + estimated cost, used for the app-level monthly spend guard ($9.50 soft cap under the $10/mo approval).
create table public.ai_usage (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  capture_id uuid references public.captures(id) on delete set null,
  model text not null,
  route text not null default 'vercel-ai-gateway',
  tokens_in int not null default 0,
  tokens_in_cached int not null default 0,
  tokens_out int not null default 0,
  est_cost_usd numeric(12,6) not null,        -- from token usage x Gateway list price
  gateway_cost_usd numeric(12,6),             -- cost reported by the Gateway response, when present
  ok boolean not null default true,
  error text,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index ai_usage_org_month on public.ai_usage (org_id, created_at);
alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage for select to authenticated using (private.is_org_member(org_id));
create policy ai_usage_insert on public.ai_usage for insert to authenticated with check (private.is_org_member(org_id));
-- append-only: no update/delete policies; not cleared by "Reset demo"
