-- Run once in a NEW Supabase project's SQL editor. No browser secret is required.
-- Private helpers hold authority; exposed RPC wrappers run as the authenticated caller.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.players (
  id uuid primary key references auth.users(id),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  rating integer not null default 1200,
  joined_at timestamptz not null default now()
);
create unique index player_name_unique on public.players (lower(display_name));

create table private.club_settings (
  singleton boolean primary key default true check (singleton),
  invite_code text not null check (char_length(invite_code) >= 16)
);
-- Configure your own long, random invitation code AFTER installing this schema.
-- No default code is shipped, and this table is inaccessible to the website.

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger uuid not null references public.players(id),
  opponent uuid not null references public.players(id),
  note text not null default '' check (char_length(note) <= 240),
  status text not null default 'open' check (status in ('open','accepted','declined','cancelled','completed')),
  created_at timestamptz not null default now(),
  check (challenger <> opponent)
);
create unique index one_active_challenge_per_pair on public.challenges
  (least(challenger,opponent), greatest(challenger,opponent)) where status in ('open','accepted');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  player_a uuid not null references public.players(id),
  player_b uuid not null references public.players(id),
  submitted_by uuid not null references public.players(id),
  score_a integer not null,
  score_b integer not null,
  best_of integer not null check (best_of in (3,5)),
  played_on date not null,
  challenge_id uuid references public.challenges(id),
  status text not null default 'pending' check (status in ('pending','confirmed','disputed')),
  rating_before_a integer,
  rating_before_b integer,
  rating_change_a integer,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check (player_a <> player_b),
  check (submitted_by in (player_a,player_b)),
  check (score_a >= 0 and score_b >= 0),
  check ((score_a = (best_of+1)/2 and score_b < (best_of+1)/2) or (score_b = (best_of+1)/2 and score_a < (best_of+1)/2)),
  check ((status = 'confirmed' and confirmed_at is not null and rating_before_a is not null and rating_before_b is not null and rating_change_a is not null) or
         (status <> 'confirmed' and confirmed_at is null and rating_before_a is null and rating_before_b is null and rating_change_a is null))
);
create unique index one_pending_result_per_pair on public.matches
  (least(player_a,player_b), greatest(player_a,player_b)) where status = 'pending';
create unique index one_live_result_per_challenge on public.matches(challenge_id) where status in ('pending','confirmed');
create index matches_created on public.matches(created_at desc);
create index challenges_created on public.challenges(created_at desc);

alter table public.players enable row level security;
alter table public.challenges enable row level security;
alter table public.matches enable row level security;
alter table private.club_settings enable row level security;
revoke all on public.players, public.challenges, public.matches from anon, authenticated;
revoke all on private.club_settings from public, anon, authenticated;
grant select on public.players, public.challenges, public.matches to authenticated;

create function private.is_member() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.players where id = auth.uid());
$$;
revoke all on function private.is_member() from public, anon;
grant execute on function private.is_member() to authenticated;

create policy members_read_players on public.players for select to authenticated using ((select private.is_member()));
create policy members_read_challenges on public.challenges for select to authenticated using ((select private.is_member()));
create policy members_read_matches on public.matches for select to authenticated using ((select private.is_member()));

create function private.join_ladder(p_name text, p_invite text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  if exists(select 1 from public.players where id = v_uid) then raise exception 'You are already a club member.'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 40 then raise exception 'Use a name between 2 and 40 characters.'; end if;
  if p_invite is null or not exists(select 1 from private.club_settings where invite_code = btrim(p_invite)) then raise exception 'That invitation code is not valid. Ask your organiser.'; end if;
  insert into public.players(id,display_name) values(v_uid,btrim(p_name));
  return v_uid;
exception when unique_violation then raise exception 'That name is already in the ladder.';
end;
$$;

create function private.issue_challenge(p_opponent uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not private.is_member() then raise exception 'Join the club first.'; end if;
  if p_opponent is null or p_opponent = v_uid or not exists(select 1 from public.players where id = p_opponent) then raise exception 'Choose another club member.'; end if;
  if p_note is null or char_length(p_note) > 240 then raise exception 'Keep your note to 240 characters.'; end if;
  insert into public.challenges(challenger,opponent,note) values(v_uid,p_opponent,btrim(p_note)) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'There is already an open challenge between you.';
end;
$$;

create function private.respond_to_challenge(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_c public.challenges%rowtype;
begin
  if not private.is_member() then raise exception 'Join the club first.'; end if;
  -- A shared transaction lock serialises small-club mutations and avoids cross-flow deadlocks.
  perform pg_advisory_xact_lock(831472);
  select * into v_c from public.challenges where id = p_id for update;
  if not found or v_c.status not in ('open','accepted') then raise exception 'This challenge is no longer open.'; end if;
  if p_action is null or not coalesce((v_uid = v_c.opponent and v_c.status = 'open' and p_action in ('accepted','declined')) or
          (v_uid = v_c.challenger and p_action = 'cancelled'),false) then raise exception 'You cannot make that change.'; end if;
  if exists(select 1 from public.matches where challenge_id = p_id and status = 'pending') then raise exception 'Resolve the submitted result first.'; end if;
  update public.challenges set status = p_action where id = p_id;
end;
$$;

create function private.submit_result(p_opponent uuid, p_score_a integer, p_score_b integer, p_best_of integer, p_played_on date, p_challenge uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_target integer; v_c public.challenges%rowtype;
begin
  if not private.is_member() then raise exception 'Join the club first.'; end if;
  if p_opponent is null or p_opponent = v_uid or not exists(select 1 from public.players where id = p_opponent) then raise exception 'Choose another club member.'; end if;
  if p_best_of is null or p_best_of not in (3,5) or p_score_a is null or p_score_b is null then raise exception 'Choose a match format and a valid score.'; end if;
  v_target := (p_best_of+1)/2;
  if p_score_a < 0 or p_score_b < 0 or not ((p_score_a = v_target and p_score_b < v_target) or (p_score_b = v_target and p_score_a < v_target)) then raise exception 'Enter a completed best-of-three or best-of-five score.'; end if;
  if p_played_on is null or p_played_on > (now() at time zone 'Europe/London')::date or p_played_on < date '2020-01-01' then raise exception 'Choose a valid match date between 1 January 2020 and today.'; end if;
  perform pg_advisory_xact_lock(831472);
  if p_challenge is not null then
    select * into v_c from public.challenges where id = p_challenge for update;
    if not found or v_c.status <> 'accepted' or v_uid not in (v_c.challenger,v_c.opponent) or p_opponent not in (v_c.challenger,v_c.opponent) then raise exception 'Choose an accepted challenge between you and your opponent.'; end if;
  end if;
  insert into public.matches(player_a,player_b,submitted_by,score_a,score_b,best_of,played_on,challenge_id)
    values(v_uid,p_opponent,v_uid,p_score_a,p_score_b,p_best_of,p_played_on,p_challenge) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'Confirm or dispute the existing result between you first.';
end;
$$;

create function private.review_result(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_m public.matches%rowtype; v_a integer; v_b integer; v_delta integer; v_expected numeric;
begin
  if not private.is_member() then raise exception 'Join the club first.'; end if;
  if p_accept is null then raise exception 'Choose confirm or dispute.'; end if;
  perform pg_advisory_xact_lock(831472);
  select * into v_m from public.matches where id = p_id for update;
  if not found or v_m.status <> 'pending' then raise exception 'This result is no longer awaiting confirmation.'; end if;
  if v_uid = v_m.submitted_by or v_uid not in (v_m.player_a,v_m.player_b) then raise exception 'Only the other player can confirm or dispute this result.'; end if;
  if not p_accept then
    update public.matches set status = 'disputed' where id = p_id;
    return;
  end if;
  select rating into v_a from public.players where id = v_m.player_a for update;
  select rating into v_b from public.players where id = v_m.player_b for update;
  v_expected := 1.0 / (1.0 + power(10::numeric, (v_b::numeric-v_a::numeric)/400.0));
  -- floor(x + 0.5) matches JavaScript Math.round, including negative half-ties.
  v_delta := floor(32 * ((case when v_m.score_a > v_m.score_b then 1 else 0 end) - v_expected) + 0.5)::integer;
  update public.players set rating = v_a + v_delta where id = v_m.player_a;
  update public.players set rating = v_b - v_delta where id = v_m.player_b;
  update public.matches set status = 'confirmed', confirmed_at = now(), rating_before_a = v_a, rating_before_b = v_b, rating_change_a = v_delta where id = p_id;
  if v_m.challenge_id is not null then update public.challenges set status = 'completed' where id = v_m.challenge_id; end if;
end;
$$;

-- Only the specific private helpers are callable. The private schema must NOT be
-- added to Supabase's exposed API schemas. No generic SQL executor is provided.
revoke all on function private.join_ladder(text,text), private.issue_challenge(uuid,text),
  private.respond_to_challenge(uuid,text), private.submit_result(uuid,integer,integer,integer,date,uuid),
  private.review_result(uuid,boolean) from public, anon;
grant execute on function private.join_ladder(text,text), private.issue_challenge(uuid,text),
  private.respond_to_challenge(uuid,text), private.submit_result(uuid,integer,integer,integer,date,uuid),
  private.review_result(uuid,boolean) to authenticated;

create function public.join_ladder(p_name text, p_invite text) returns uuid language sql security invoker set search_path = '' as $$ select private.join_ladder(p_name,p_invite); $$;
create function public.issue_challenge(p_opponent uuid, p_note text default '') returns uuid language sql security invoker set search_path = '' as $$ select private.issue_challenge(p_opponent,p_note); $$;
create function public.respond_to_challenge(p_id uuid, p_action text) returns void language sql security invoker set search_path = '' as $$ select private.respond_to_challenge(p_id,p_action); $$;
create function public.submit_result(p_opponent uuid, p_score_a integer, p_score_b integer, p_best_of integer, p_played_on date, p_challenge uuid default null) returns uuid language sql security invoker set search_path = '' as $$ select private.submit_result(p_opponent,p_score_a,p_score_b,p_best_of,p_played_on,p_challenge); $$;
create function public.review_result(p_id uuid, p_accept boolean) returns void language sql security invoker set search_path = '' as $$ select private.review_result(p_id,p_accept); $$;
revoke all on function public.join_ladder(text,text), public.issue_challenge(uuid,text),
  public.respond_to_challenge(uuid,text), public.submit_result(uuid,integer,integer,integer,date,uuid),
  public.review_result(uuid,boolean) from public, anon;
grant execute on function public.join_ladder(text,text), public.issue_challenge(uuid,text),
  public.respond_to_challenge(uuid,text), public.submit_result(uuid,integer,integer,integer,date,uuid),
  public.review_result(uuid,boolean) to authenticated;
commit;
