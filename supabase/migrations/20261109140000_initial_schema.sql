-- Field As-Built: initial schema (MVP_SPEC §4). RLS on everything; access via org membership.
create extension if not exists postgis with schema extensions;

create type public.member_role as enum ('admin', 'pe', 'foreman');
create type public.markup_status as enum ('draft', 'confirmed', 'rejected');
create type public.markup_action as enum ('suggested', 'moved', 'edited', 'confirmed', 'rejected', 'reopened');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'foreman',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.memberships (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  number text,
  address text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index on public.projects (org_id);

create table public.drawing_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  revision text,
  storage_path text not null,
  page_count int,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  superseded_by uuid references public.drawing_sets(id)
);
create index on public.drawing_sets (project_id);

create table public.sheets (
  id uuid primary key default gen_random_uuid(),
  drawing_set_id uuid not null references public.drawing_sets(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  page_index int not null,
  sheet_number text,
  title text,
  discipline text,
  width_pt numeric not null,
  height_pt numeric not null,
  rotation int not null default 0,
  scale_pts_per_ft numeric,
  text_items jsonb not null default '[]'::jsonb,
  thumbnail_path text,
  unique (drawing_set_id, page_index)
);
create index on public.sheets (project_id);

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sheet_id uuid references public.sheets(id) on delete set null,
  captured_by uuid references auth.users(id),
  captured_at timestamptz not null default now(),
  note_text text not null,
  note_source text not null default 'text' check (note_source in ('text', 'voice')),
  audio_path text,
  gps extensions.geography(point),
  heading numeric,
  device_info jsonb,
  client_id uuid unique  -- offline idempotency key
);
create index on public.captures (project_id);
create index on public.captures (sheet_id);

create table public.capture_photos (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.captures(id) on delete cascade,
  storage_path text not null,
  mime text,
  width int,
  height int,
  exif jsonb,
  ord int not null default 0
);
create index on public.capture_photos (capture_id);

create table public.markups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sheet_id uuid not null references public.sheets(id) on delete cascade,
  capture_id uuid references public.captures(id) on delete set null,
  status public.markup_status not null default 'draft',
  cloud_rect jsonb not null,    -- {x,y,w,h} PDF points, origin bottom-left
  callout_rect jsonb not null,
  text text not null,
  rfi_ref text,
  co_ref text,
  ai_method text,
  ai_model text,
  ai_confidence numeric,
  ai_reasoning text,
  ai_anchor_text text,
  ai_tokens_in int,
  ai_tokens_out int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_reason text
);
create index on public.markups (project_id, status);
create index on public.markups (sheet_id);
create index on public.markups (capture_id);

-- audit log
create table public.markup_events (
  id bigint generated always as identity primary key,
  markup_id uuid not null references public.markups(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action public.markup_action not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index on public.markup_events (markup_id);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid references auth.users(id),
  sheet_ids uuid[],
  include_drafts boolean not null default false,
  storage_path text,
  markup_count int,
  created_at timestamptz not null default now()
);
create index on public.exports (project_id);

-- ---------- helper functions (security definer, fixed search_path) ----------
create or replace function public.is_org_member(p_org uuid, p_roles public.member_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function public.project_org(p_project uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.projects where id = p_project;
$$;

create or replace function public.is_org_member_path(p_org_text text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id::text = p_org_text and m.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_org_member(uuid, public.member_role[]) from anon;
revoke execute on function public.is_org_member_path(text) from anon;
revoke execute on function public.project_org(uuid) from anon;

-- ---------- RLS ----------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.projects enable row level security;
alter table public.drawing_sets enable row level security;
alter table public.sheets enable row level security;
alter table public.captures enable row level security;
alter table public.capture_photos enable row level security;
alter table public.markups enable row level security;
alter table public.markup_events enable row level security;
alter table public.exports enable row level security;

create policy org_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated using (public.is_org_member(id, array['admin']::public.member_role[]));

create policy mem_select on public.memberships for select to authenticated using (public.is_org_member(org_id));
create policy mem_admin_all on public.memberships for all to authenticated
  using (public.is_org_member(org_id, array['admin']::public.member_role[]))
  with check (public.is_org_member(org_id, array['admin']::public.member_role[]));

create policy proj_select on public.projects for select to authenticated using (public.is_org_member(org_id));
create policy proj_admin_write on public.projects for all to authenticated
  using (public.is_org_member(org_id, array['admin','pe']::public.member_role[]))
  with check (public.is_org_member(org_id, array['admin','pe']::public.member_role[]));

create policy ds_select on public.drawing_sets for select to authenticated using (public.is_org_member(public.project_org(project_id)));
create policy ds_write on public.drawing_sets for all to authenticated
  using (public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]))
  with check (public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]));

create policy sh_select on public.sheets for select to authenticated using (public.is_org_member(public.project_org(project_id)));
create policy sh_write on public.sheets for all to authenticated
  using (public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]))
  with check (public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]));

create policy cap_select on public.captures for select to authenticated using (public.is_org_member(public.project_org(project_id)));
create policy cap_insert on public.captures for insert to authenticated
  with check (public.is_org_member(public.project_org(project_id)) and captured_by = (select auth.uid()));
create policy cap_update_own on public.captures for update to authenticated
  using (captured_by = (select auth.uid()) or public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]));

create policy ph_select on public.capture_photos for select to authenticated
  using (exists (select 1 from public.captures c where c.id = capture_id and public.is_org_member(public.project_org(c.project_id))));
create policy ph_insert on public.capture_photos for insert to authenticated
  with check (exists (select 1 from public.captures c where c.id = capture_id and public.is_org_member(public.project_org(c.project_id))));

create policy mk_select on public.markups for select to authenticated using (public.is_org_member(public.project_org(project_id)));
create policy mk_insert on public.markups for insert to authenticated
  with check (public.is_org_member(public.project_org(project_id)) and status = 'draft');
-- foremen may edit only their own drafts (and keep them drafts); PE/admin may confirm/reject
create policy mk_update_foreman on public.markups for update to authenticated
  using (created_by = (select auth.uid()) and status = 'draft')
  with check (created_by = (select auth.uid()) and status = 'draft');
create policy mk_update_pe on public.markups for update to authenticated
  using (public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]))
  with check (public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]));

create policy ev_select on public.markup_events for select to authenticated
  using (exists (select 1 from public.markups m where m.id = markup_id and public.is_org_member(public.project_org(m.project_id))));
create policy ev_insert on public.markup_events for insert to authenticated
  with check (actor_id = (select auth.uid()) and exists (select 1 from public.markups m where m.id = markup_id and public.is_org_member(public.project_org(m.project_id))));
-- audit log is append-only: no update/delete policies

create policy ex_select on public.exports for select to authenticated using (public.is_org_member(public.project_org(project_id)));
create policy ex_insert on public.exports for insert to authenticated
  with check (public.is_org_member(public.project_org(project_id), array['admin','pe']::public.member_role[]));

-- ---------- private storage buckets; object path convention: <org_id>/<project_id>/... ----------
insert into storage.buckets (id, name, public, file_size_limit) values
  ('drawings', 'drawings', false, 104857600),
  ('photos',   'photos',   false, 26214400),
  ('audio',    'audio',    false, 10485760),
  ('exports',  'exports',  false, 104857600)
on conflict (id) do nothing;

create policy fab_storage_read on storage.objects for select to authenticated
  using (bucket_id in ('drawings','photos','audio','exports')
         and public.is_org_member_path((storage.foldername(name))[1]));
create policy fab_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('drawings','photos','audio','exports')
         and public.is_org_member_path((storage.foldername(name))[1]));
