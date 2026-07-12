require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function dump() {
  console.log('Fetching songs...');
  const { data: songs, error } = await supabase.from('songs').select('*').order('created_at', { ascending: false });
  if (error) throw error;

  const outDir = path.join(__dirname, '../frontend/public/data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outFile = path.join(outDir, 'songs.json');
  fs.writeFileSync(outFile, JSON.stringify(songs, null, 2));
  console.log(`Saved ${songs.length} songs to ${outFile}`);
}

dump().catch(console.error);
