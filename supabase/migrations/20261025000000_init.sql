-- Breadcrumb initial schema.
--
-- Access model: the Express backend is the only client of this database and connects
-- with the Supabase service-role key (which bypasses RLS). RLS is enabled on every
-- table with NO policies and privileges are revoked from anon/authenticated, so the
-- public anon key cannot read or write anything — including unrevealed hints and the
-- encrypted Twitch tokens. Ownership is enforced in the backend service layer.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- streamer_connections: one row per Twitch broadcaster (or the demo streamer).
-- Tokens are AES-256-GCM ciphertext produced by the backend (TOKEN_ENCRYPTION_KEY).
-- ---------------------------------------------------------------------------
create table public.streamer_connections (
  id                uuid primary key default gen_random_uuid(),
  twitch_user_id    text not null unique,
  login             text not null,
  display_name      text not null,
  is_demo           boolean not null default false,
  scopes            text[] not null default '{}',
  access_token_enc  text,
  refresh_token_enc text,
  token_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger streamer_connections_updated_at
  before update on public.streamer_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- hint_sessions
-- ---------------------------------------------------------------------------
create table public.hint_sessions (
  id                    uuid primary key default gen_random_uuid(),
  streamer_id           uuid not null references public.streamer_connections(id) on delete cascade,
  game                  text not null check (char_length(game) between 1 and 120),
  question              text not null check (char_length(question) between 3 and 300),
  context               text not null default '' check (char_length(context) <= 1200),
  status                text not null default 'collecting' check (status in ('collecting', 'closed')),
  current_revealed_tier smallint not null default 0 check (current_revealed_tier between 0 and 3),
  show_credits          boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  closed_at             timestamptz,
  check ((status = 'closed') = (closed_at is not null))
);

create index hint_sessions_streamer_created_idx on public.hint_sessions (streamer_id, created_at desc);
create index hint_sessions_streamer_open_idx on public.hint_sessions (streamer_id) where status = 'collecting';

create trigger hint_sessions_updated_at
  before update on public.hint_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- hint_submissions: private viewer clues. viewer_id is an opaque identifier
-- (Twitch extension opaque_user_id or an anonymous token subject).
-- ---------------------------------------------------------------------------
create table public.hint_submissions (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.hint_sessions(id) on delete cascade,
  viewer_id           text not null,
  viewer_display_name text check (viewer_display_name is null or char_length(viewer_display_name) <= 40),
  credit_opt_in       boolean not null default false,
  text                text not null check (char_length(text) between 3 and 280),
  status              text not null default 'pending' check (status in ('pending', 'rejected')),
  source              text not null default 'live' check (source in ('live', 'demo')),
  created_at          timestamptz not null default now()
);

create index hint_submissions_session_idx on public.hint_submissions (session_id, created_at);
create index hint_submissions_viewer_idx on public.hint_submissions (session_id, viewer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- hint_sets: versioned AI outputs. Exactly one active set per session.
-- tiers: [{ tier, text, supportingSubmissionIds, approval, revealedAt }]
-- ---------------------------------------------------------------------------
create table public.hint_sets (
  id                      uuid primary key default gen_random_uuid(),
  session_id              uuid not null references public.hint_sessions(id) on delete cascade,
  version                 integer not null check (version > 0),
  status                  text not null check (status in ('READY', 'NEED_MORE_CLUES', 'NEED_REVIEW', 'ERROR')),
  reason                  text,
  flagged_submission_ids  uuid[] not null default '{}',
  tiers                   jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array'),
  provider                text not null check (provider in ('openai', 'demo-heuristic')),
  model                   text,
  input_hash              text not null,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  unique (session_id, version)
);

create unique index hint_sets_one_active_idx on public.hint_sets (session_id) where is_active;

-- Atomically deactivate the previous set and insert the next version.
create or replace function public.insert_hint_set(p jsonb)
returns public.hint_sets
language plpgsql
as $$
declare
  next_version integer;
  inserted public.hint_sets;
begin
  perform 1 from public.hint_sessions where id = (p->>'session_id')::uuid for update;

  select coalesce(max(version), 0) + 1 into next_version
  from public.hint_sets where session_id = (p->>'session_id')::uuid;

  update public.hint_sets set is_active = false
  where session_id = (p->>'session_id')::uuid and is_active;

  insert into public.hint_sets
    (session_id, version, status, reason, flagged_submission_ids, tiers, provider, model, input_hash, is_active)
  values (
    (p->>'session_id')::uuid,
    next_version,
    p->>'status',
    p->>'reason',
    coalesce(array(select jsonb_array_elements_text(p->'flagged_submission_ids'))::uuid[], '{}'),
    coalesce(p->'tiers', '[]'::jsonb),
    p->>'provider',
    p->>'model',
    p->>'input_hash',
    true
  )
  returning * into inserted;

  return inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- chat_messages: buffered chat for Chat Guard and Chat Pulse evidence.
-- Additional table (beyond the original six) because summaries must reference real
-- message IDs and moderation needs the original message. Purge with
-- purge_old_chat_messages() — Twitch only allows deleting messages < 6h old anyway.
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id                   uuid primary key default gen_random_uuid(),
  streamer_id          uuid not null references public.streamer_connections(id) on delete cascade,
  twitch_message_id    text,
  chatter_user_id      text not null,
  chatter_login        text not null,
  chatter_display_name text not null,
  text                 text not null check (char_length(text) <= 1000),
  is_privileged        boolean not null default false,
  is_duplicate         boolean not null default false,
  flag_id              uuid,
  source               text not null check (source in ('live', 'demo')),
  sent_at              timestamptz not null default now()
);

create index chat_messages_streamer_sent_idx on public.chat_messages (streamer_id, sent_at);
-- EventSub can redeliver a notification; this makes ingest idempotent.
create unique index chat_messages_twitch_id_idx on public.chat_messages (streamer_id, twitch_message_id)
  where twitch_message_id is not null;

create or replace function public.purge_old_chat_messages(retain_days integer default 7)
returns integer
language sql
as $$
  with deleted as (
    delete from public.chat_messages where sent_at < now() - make_interval(days => retain_days) returning 1
  )
  select count(*)::integer from deleted;
$$;

-- ---------------------------------------------------------------------------
-- moderation_events: Chat Guard flags plus their review/action history.
-- ---------------------------------------------------------------------------
create table public.moderation_events (
  id                uuid primary key default gen_random_uuid(),
  streamer_id       uuid not null references public.streamer_connections(id) on delete cascade,
  chat_message_id   uuid references public.chat_messages(id) on delete set null,
  twitch_message_id text,
  chatter_user_id   text not null,
  chatter_login     text not null,
  message_text      text not null,
  reasons           jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  category          text not null check (category in ('duplicate', 'near_duplicate', 'flood', 'link_promo', 'copypasta')),
  confidence        text not null check (confidence in ('low', 'medium', 'high')),
  review_status     text not null default 'open' check (review_status in ('open', 'dismissed', 'confirmed_spam')),
  action            text not null default 'none' check (action in ('none', 'deleted', 'delete_failed', 'demo_deleted')),
  action_detail     text,
  history           jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  source            text not null check (source in ('live', 'demo')),
  message_sent_at   timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index moderation_events_streamer_status_idx on public.moderation_events (streamer_id, review_status, created_at desc);

alter table public.chat_messages
  add constraint chat_messages_flag_fk foreign key (flag_id) references public.moderation_events(id) on delete set null;

create trigger moderation_events_updated_at
  before update on public.moderation_events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat_summaries: Chat Pulse output with its time window and computed stats.
-- ---------------------------------------------------------------------------
create table public.chat_summaries (
  id           uuid primary key default gen_random_uuid(),
  streamer_id  uuid not null references public.streamer_connections(id) on delete cascade,
  window_start timestamptz not null,
  window_end   timestamptz not null,
  status       text not null check (status in ('READY', 'EMPTY', 'ERROR')),
  topics       jsonb not null default '[]'::jsonb,
  questions    jsonb not null default '[]'::jsonb,
  suggestions  jsonb not null default '[]'::jsonb,
  reactions    jsonb not null default '[]'::jsonb,
  stats        jsonb not null default '{}'::jsonb,
  provider     text not null check (provider in ('openai', 'demo-heuristic')),
  model        text,
  source       text not null check (source in ('live', 'demo')),
  error        text,
  created_at   timestamptz not null default now(),
  check (window_end >= window_start)
);

create index chat_summaries_streamer_created_idx on public.chat_summaries (streamer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny-by-default for every client except service_role.
-- ---------------------------------------------------------------------------
alter table public.streamer_connections enable row level security;
alter table public.hint_sessions        enable row level security;
alter table public.hint_submissions     enable row level security;
alter table public.hint_sets            enable row level security;
alter table public.chat_messages        enable row level security;
alter table public.moderation_events    enable row level security;
alter table public.chat_summaries       enable row level security;

revoke all on public.streamer_connections, public.hint_sessions, public.hint_submissions, public.hint_sets,
  public.chat_messages, public.moderation_events, public.chat_summaries from anon, authenticated;
revoke execute on function public.insert_hint_set(jsonb) from public, anon, authenticated;
revoke execute on function public.purge_old_chat_messages(integer) from public, anon, authenticated;
grant execute on function public.insert_hint_set(jsonb) to service_role;
grant execute on function public.purge_old_chat_messages(integer) to service_role;
