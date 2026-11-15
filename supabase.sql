-- One Hub: run this once in your Supabase project (SQL Editor > New query > Run).
-- It makes one table that holds every hub entry, and locks each row to the person who owns it.

create table if not exists public.hub_docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  col        text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);

alter table public.hub_docs enable row level security;

drop policy if exists "Each person reads and writes only their own rows" on public.hub_docs;
create policy "Each person reads and writes only their own rows"
  on public.hub_docs
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
