-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  google_name text,
  chat_nickname text NOT NULL,
  nickname_updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (id)
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_chat_nickname_lower_uidx
  ON public.profiles (LOWER(chat_nickname));

-- Create policies
-- Everyone can read their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);

-- Admin member management runs through the backend service role.
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- 2. Create trigger to automatically insert into profiles on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, google_name, chat_nickname, role, nickname_updated_at)
  VALUES (
    new.id,
    new.email,
    NULLIF(LEFT(BTRIM(COALESCE(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 100), ''),
    '음악친구_' || LEFT(REPLACE(new.id::text, '-', ''), 8),
    'user',
    timezone('utc'::text, now())
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Initial admin setup query (To be run manually by the user)
/*
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'your_email@gmail.com';
*/
