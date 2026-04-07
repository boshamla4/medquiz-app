import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';

config({ path: '.env.local' });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const payload = JSON.parse(readFileSync('scripts/generated/parsed-questions.json', 'utf8'));

const probe = await db
  .from('questions')
  .select('source_file, source_collection, topic')
  .limit(1);

if (probe.error) {
  console.error('Metadata columns are missing. Run SQL migration first:');
  console.error('supabase/migrations/20260407_add_question_metadata.sql');
  process.exit(1);
}

let updated = 0;
for (const file of payload.files) {
  for (const q of file.questions) {
    const { error } = await db
      .from('questions')
      .update({
        source_file: q.source_file ?? file.file,
        source_collection: q.source_collection ?? 'data',
        topic: q.topic ?? q.module,
      })
      .eq('module', q.module)
      .eq('question_text', q.question_text)
      .is('deleted_at', null);

    if (!error) updated += 1;
  }
}

console.log(`Metadata sync attempted for ${updated} questions.`);
