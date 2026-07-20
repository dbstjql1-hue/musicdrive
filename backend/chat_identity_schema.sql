-- Realtime chat identity migration (2026-07-20)
-- Public chat only exposes a user-selected nickname. Google identity remains admin-only.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_name text,
  ADD COLUMN IF NOT EXISTS chat_nickname text,
  ADD COLUMN IF NOT EXISTS nickname_updated_at timestamp with time zone;

UPDATE public.profiles AS profile
SET google_name = NULLIF(LEFT(BTRIM(COALESCE(
  auth_user.raw_user_meta_data ->> 'full_name',
  auth_user.raw_user_meta_data ->> 'name',
  ''
)), 100), '')
FROM auth.users AS auth_user
WHERE auth_user.id = profile.id
  AND profile.google_name IS NULL;

UPDATE public.profiles
SET chat_nickname = '음악친구_' || LEFT(REPLACE(id::text, '-', ''), 8),
    nickname_updated_at = COALESCE(nickname_updated_at, timezone('utc'::text, now()))
WHERE chat_nickname IS NULL OR BTRIM(chat_nickname) = '';

ALTER TABLE public.profiles
  ALTER COLUMN chat_nickname SET NOT NULL,
  ALTER COLUMN nickname_updated_at SET DEFAULT timezone('utc'::text, now());

CREATE UNIQUE INDEX IF NOT EXISTS profiles_chat_nickname_lower_uidx
  ON public.profiles (LOWER(chat_nickname));

DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    google_name,
    chat_nickname,
    role,
    nickname_updated_at
  ) VALUES (
    new.id,
    new.email,
    NULLIF(LEFT(BTRIM(COALESCE(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    )), 100), ''),
    '음악친구_' || LEFT(REPLACE(new.id::text, '-', ''), 8),
    'user',
    timezone('utc'::text, now())
  );
  RETURN new;
END;
$$;

COMMIT;
