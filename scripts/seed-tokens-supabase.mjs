import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';

config({ path: '.env.local' });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const tokens = Array.from({ length: 25 }, () =>
  randomBytes(16).toString('base64url').toUpperCase().slice(0, 8)
);

const { error } = await db.from('users').insert(tokens.map((t) => ({ token: t })));
if (error) throw error;

console.log('Seeded 25 tokens (distribute securely):');
tokens.forEach((t, i) => console.log(`${String(i + 1).padStart(2, '0')}. ${t}`));
