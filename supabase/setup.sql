-- Inventory app: tables for Supabase.
-- Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
-- One table per Google Sheet tab, same column names. Every value is text, like the sheet.
-- _seq keeps rows in the order they were added (the app relies on oldest-first order).
-- Row Level Security is ON with no policies: only the app's server (secret / service_role key) can read or write.

create table if not exists public.items (
  _seq bigint generated always as identity,
  item_id text primary key,
  item_type text not null default '',
  home_hub text not null default '',
  current_hub text not null default '',
  status text not null default '',
  current_holder text not null default '',
  last_event_id text not null default '',
  updated_at text not null default '',
  attributes text not null default '',
  prism_no text not null default '',
  brand text not null default '',
  model text not null default '',
  price text not null default ''
);
create index if not exists items_seq_idx on public.items (_seq);
alter table public.items enable row level security;

create table if not exists public.events (
  _seq bigint generated always as identity,
  event_id text primary key,
  batch_id text not null default '',
  item_id text not null default '',
  action text not null default '',
  from_person text not null default '',
  to_person text not null default '',
  hub text not null default '',
  status_after text not null default '',
  occurred_at text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  note text not null default '',
  from_id text not null default '',
  to_id text not null default '',
  from_hub text not null default ''
);
create index if not exists events_seq_idx on public.events (_seq);
alter table public.events enable row level security;

create table if not exists public.people (
  _seq bigint generated always as identity,
  person_id text primary key,
  name text not null default '',
  role text not null default '',
  hub text not null default '',
  linked_user text not null default '',
  active text not null default '',
  mobile text not null default ''
);
create index if not exists people_seq_idx on public.people (_seq);
alter table public.people enable row level security;

create table if not exists public.hubs (
  _seq bigint generated always as identity,
  hub_id text primary key,
  name text not null default '',
  city text not null default '',
  is_central text not null default '',
  active text not null default '',
  parent_hub text not null default ''
);
create index if not exists hubs_seq_idx on public.hubs (_seq);
alter table public.hubs enable row level security;

create table if not exists public.item_types (
  _seq bigint generated always as identity,
  type text primary key,
  fields text not null default ''
);
create index if not exists item_types_seq_idx on public.item_types (_seq);
alter table public.item_types enable row level security;

create table if not exists public.users (
  _seq bigint generated always as identity,
  email text primary key,
  role text not null default '',
  person_id text not null default '',
  active text not null default '',
  secondary_role text not null default ''
);
-- For a database created before secondary_role existed:
alter table public.users add column if not exists secondary_role text not null default '';
create index if not exists users_seq_idx on public.users (_seq);
alter table public.users enable row level security;

create table if not exists public.status_limits (
  _seq bigint generated always as identity,
  status text primary key,
  max_days text not null default ''
);
create index if not exists status_limits_seq_idx on public.status_limits (_seq);
alter table public.status_limits enable row level security;

create table if not exists public.deletions (
  _seq bigint generated always as identity,
  deletion_id text primary key,
  deleted_at text not null default '',
  deleted_by_email text not null default '',
  deleted_by_name text not null default '',
  item_id text not null default '',
  prism_no text not null default '',
  brand text not null default '',
  model text not null default '',
  price text not null default '',
  attributes text not null default '',
  status text not null default '',
  current_hub text not null default '',
  current_holder text not null default '',
  home_hub text not null default '',
  events_deleted text not null default '',
  reason text not null default '',
  history_json text not null default ''
);
create index if not exists deletions_seq_idx on public.deletions (_seq);
alter table public.deletions enable row level security;

create table if not exists public.hardware_updates (
  _seq bigint generated always as identity,
  update_id text primary key,
  item_id text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  recorded_by_name text not null default '',
  update_type text not null default '',
  comment text not null default ''
);
create index if not exists hardware_updates_seq_idx on public.hardware_updates (_seq);
alter table public.hardware_updates enable row level security;

create table if not exists public.qc_checks (
  _seq bigint generated always as identity,
  check_id text primary key,
  item_id text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  recorded_by_name text not null default '',
  qc_status text not null default '',
  comment text not null default ''
);
create index if not exists qc_checks_seq_idx on public.qc_checks (_seq);
alter table public.qc_checks enable row level security;

create table if not exists public.rig_reports (
  _seq bigint generated always as identity,
  report_id text primary key,
  item_id text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  recorded_by_name text not null default '',
  location text not null default '',
  reason text not null default '',
  photo text not null default '',
  hub_id text not null default '',
  role text not null default '',
  person_id text not null default '',
  person_name text not null default ''
);
create index if not exists rig_reports_seq_idx on public.rig_reports (_seq);
create index if not exists rig_reports_item_id_idx on public.rig_reports (item_id);
alter table public.rig_reports enable row level security;

create table if not exists public.receipt_edits (
  _seq bigint generated always as identity,
  edit_id text primary key,
  edited_at text not null default '',
  edited_by_email text not null default '',
  edited_by_name text not null default '',
  batch_id text not null default '',
  field text not null default '',
  old_value text not null default '',
  new_value text not null default ''
);
create index if not exists receipt_edits_seq_idx on public.receipt_edits (_seq);
alter table public.receipt_edits enable row level security;

-- Change counters: every write to a table adds 1 to its number here (done by the triggers below, so
-- edits made in the Supabase Table Editor count too). The app reads these few numbers first and only
-- downloads a table again when its number changed, so pages and the Back button do not re-download
-- 50,000 events every time.
create table if not exists public.table_versions (
  tab text primary key,
  v bigint not null default 0
);
alter table public.table_versions enable row level security;

create or replace function public.bump_table_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.table_versions (tab, v) values (tg_table_name, 1)
  on conflict (tab) do update set v = public.table_versions.v + 1;
  return null;
end $$;
revoke all on function public.bump_table_version() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['items','events','people','hubs','item_types','users','status_limits',
    'deletions','hardware_updates','qc_checks','rig_reports','receipt_edits'] loop
    execute format('drop trigger if exists bump_version on public.%I', t);
    execute format(
      'create trigger bump_version after insert or update or delete or truncate on public.%I '
      'for each statement execute function public.bump_table_version()', t);
  end loop;
end $$;

-- The app's server key (service_role) must be able to read and write every table, even on projects
-- that do not grant table access automatically. Browser keys (anon) get nothing.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Faster item history and deletes.
create index if not exists events_item_id_idx on public.events (item_id);
create index if not exists qc_checks_item_id_idx on public.qc_checks (item_id);
create index if not exists hardware_updates_item_id_idx on public.hardware_updates (item_id);
