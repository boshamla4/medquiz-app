import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';

config({ path: '.env.local' });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const INPUT = 'scripts/generated/parsed-questions.json';
const IMPORT_TAG = 'data-folder-json-v1';

const { data: existing, error: existingError } = await db
  .from('import_runs')
  .select('id')
  .eq('tag', IMPORT_TAG)
  .maybeSingle();

if (existingError) throw existingError;

if (existing) {
  console.log('Already imported. Delete import_runs row to re-run.');
  process.exit(0);
}

const payload = JSON.parse(readFileSync(INPUT, 'utf8'));
let totalQ = 0;
let totalA = 0;

const metadataProbe = await db
  .from('questions')
  .select('source_file, topic, source_collection')
  .limit(1);

const hasMetadataColumns = !metadataProbe.error;

for (const file of payload.files) {
  for (const q of file.questions) {
    const insertQuestion = {
      module: q.module,
      type: q.type,
      question_text: q.question_text,
      ...(hasMetadataColumns
        ? {
            source_file: q.source_file ?? file.file,
            source_collection: q.source_collection ?? 'data',
            topic: q.topic ?? q.module,
          }
        : {}),
    };

    const { data: qRow, error: qError } = await db
      .from('questions')
      .insert(insertQuestion)
      .select('id')
      .single();

    if (qError || !qRow) throw qError ?? new Error('Failed to insert question');

    const answers = q.answers.map((a) => ({
      question_id: qRow.id,
      answer_text: a.text,
      is_correct: a.is_correct,
    }));

    const { error: answersError } = await db.from('answers').insert(answers);
    if (answersError) throw answersError;

    totalQ += 1;
    totalA += answers.length;
  }
}

const { error: runError } = await db.from('import_runs').insert({
  tag: IMPORT_TAG,
  source_file: INPUT,
  notes: `files=${payload.files.length},questions=${totalQ},answers=${totalA}`,
});

if (runError) throw runError;

console.log(`Imported ${totalQ} questions and ${totalA} answers.`);
