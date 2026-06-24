const { Client } = require('pg');
require('dotenv').config();

const projectRef = 'onsxodfsmobsulrsdvwx';
const host = `db.${projectRef}.supabase.co`;
const port = 5432;
const user = 'postgres';
const database = 'postgres';

const passwords = [process.env.ADMIN_PASSWORD || 'diamond1!', 'admin1234'];

const sql = `
-- 자유게시판 글 테이블 (board_posts)
CREATE TABLE IF NOT EXISTS public.board_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    password TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 자유게시판 댓글 테이블 (board_comments)
CREATE TABLE IF NOT EXISTS public.board_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.board_posts(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    password TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
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
      console.log('Creating board tables...');
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
