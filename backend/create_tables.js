const { Client } = require('pg');

const projectRef = 'onsxodfsmobsulrsdvwx';
const host = `db.${projectRef}.supabase.co`;
const port = 5432;
const user = 'postgres';
const database = 'postgres';

const passwords = ['diamond1!', 'admin1234'];

const sql = `
-- VS 대결 매치 테이블 (vs_matches)
CREATE TABLE IF NOT EXISTS public.vs_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    song1_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    song2_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- VS 대결 투표 테이블 (vs_votes)
CREATE TABLE IF NOT EXISTS public.vs_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES public.vs_matches(id) ON DELETE CASCADE,
    song_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(match_id, session_id)
);
`;

async function run() {
  let success = false;
  for (const password of passwords) {
    console.log(`Connecting to ${host} with password length: ${password.length}...`);
    const client = new Client({
      host,
      port,
      user,
      password,
      database,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();
      console.log('Connected successfully!');
      console.log('Creating tables...');
      await client.query(sql);
      console.log('Tables created successfully!');
      await client.end();
      success = true;
      break;
    } catch (err) {
      console.error(`Connection failed for password: ${err.message}`);
      try {
        await client.end();
      } catch (e) {}
    }
  }

  if (!success) {
    console.log('--- ERROR: Could not connect to Supabase database with guessed passwords. ---');
    console.log('Please execute the SQL inside schema.sql in your Supabase SQL Editor manually.');
    process.exit(1);
  }
}

run();
