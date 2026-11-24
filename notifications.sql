-- One Hub: reminders, notifications and Google Calendar.
-- Run once in Supabase (SQL Editor > New query > Run). Safe to run again.
-- __CRON_SECRET__ is replaced with a private value in the copy you actually run; never commit that copy.

-- devices that should receive notifications; each person sees and manages only their own
create table if not exists public.hub_push_subs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.hub_push_subs enable row level security;
drop policy if exists "Each person manages their own devices" on public.hub_push_subs;
create policy "Each person manages their own devices"
  on public.hub_push_subs for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- the calendar's secret address; no policies, so only the server function can read or write it
create table if not exists public.hub_private (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  ics_url    text,
  updated_at timestamptz not null default now()
);
alter table public.hub_private enable row level security;

-- which reminders were already sent, so none goes out twice; server-only as well
create table if not exists public.hub_reminders_sent (
  user_id   uuid        not null references auth.users (id) on delete cascade,
  task_id   text        not null,
  remind_at text        not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, task_id, remind_at)
);
alter table public.hub_reminders_sent enable row level security;

-- check for due reminders every minute
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'one-hub-reminders';
select cron.schedule('one-hub-reminders', '* * * * *', $job$
  select net.http_post(
    url := 'https://avijlkaksppwytuumqll.supabase.co/functions/v1/hub',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb
  );
$job$);
