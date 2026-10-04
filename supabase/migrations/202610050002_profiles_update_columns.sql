-- Usernames change only through the sign-up trigger and claim_username (both security definer).
-- The earlier table-wide UPDATE grant let a signed-in user write any column, including username,
-- through the REST API, bypassing the reserved list and the one-time claim. Safe to re-run.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
