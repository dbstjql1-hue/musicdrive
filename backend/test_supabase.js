const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function test() {
  try {
    console.log('Testing connection...');
    
    // 1. Try listing songs table
    const { data: songs, error: dbError } = await supabase.from('songs').select('*').limit(1);
    if (dbError) {
      console.error('Database query error:', dbError);
    } else {
      console.log('Database query successful, songs found:', songs.length);
    }

    // 2. Try listing buckets in storage
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
    if (storageError) {
      console.error('Storage list buckets error:', storageError);
    } else {
      console.log('Storage list buckets successful:', buckets.map(b => b.name));
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

test();
