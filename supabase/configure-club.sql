-- AFTER running schema.sql, replace the placeholder with a long, random code.
-- Share this code privately with your friends. Do not commit your real code.
-- Rerun with a new code at any time to stop the old one admitting new members.
insert into private.club_settings(singleton, invite_code)
values (true, 'REPLACE-WITH-A-RANDOM-INVITATION-CODE')
on conflict (singleton) do update set invite_code = excluded.invite_code;
