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
const forceReset = process.argv.includes('--force-reset');

const { data: existing, error: existingError } = await db
  .from('import_runs')
  .select('id')
  .eq('tag', IMPORT_TAG)
  .maybeSingle();

if (existingError) throw existingError;

if (existing && !forceReset) {
  console.log('Already imported. Delete import_runs row to re-run.');
  process.exit(0);
}

if (forceReset) {
  // Clear question bank and dependent records before a clean reimport.
  const { error: resetExamQuestionsError } = await db
    .from('exam_questions')
    .delete()
    .gt('id', 0);
  if (resetExamQuestionsError) throw resetExamQuestionsError;

  const { error: resetAnswersError } = await db
    .from('answers')
    .delete()
    .gt('id', 0);
  if (resetAnswersError) throw resetAnswersError;

  const { error: resetQuestionsError } = await db
    .from('questions')
    .delete()
    .gt('id', 0);
  if (resetQuestionsError) throw resetQuestionsError;

  const { error: resetRunsError } = await db
    .from('import_runs')
    .delete()
    .eq('tag', IMPORT_TAG);
  if (resetRunsError) throw resetRunsError;
}

const payload = JSON.parse(readFileSync(INPUT, 'utf8'));
let totalQ = 0;
let totalA = 0;
let skipped = 0;

// ---------------------------------------------------------------------------
// Pre-import validation
// ---------------------------------------------------------------------------
const anomalies = [];
for (const file of payload.files) {
  const fname = file.file.split('/').at(-1);
  for (const q of file.questions) {
    const n = q.answers?.length ?? 0;
    const correctCount = q.answers?.filter((a) => a.is_correct).length ?? 0;
    const snippet = q.question_text?.slice(0, 60);

    if (n < 2)
      anomalies.push({ file: fname, snippet, issue: `Too few answers: ${n}` });
    if (n > 8)
      anomalies.push({ file: fname, snippet, issue: `Too many answers: ${n}` });
    if (q.type === 'single' && correctCount !== 1)
      anomalies.push({ file: fname, snippet, issue: `Single-choice has ${correctCount} correct answer(s)` });
    if (q.type === 'multiple' && correctCount === 0)
      anomalies.push({ file: fname, snippet, issue: 'Multiple-choice has 0 correct answers' });
  }
}

if (anomalies.length > 0) {
  console.warn(`\n⚠  Validation anomalies (${anomalies.length}):`);
  for (const a of anomalies) {
    console.warn(`  [${a.file}] ${a.issue} — "${a.snippet}"`);
  }
  console.warn('');
}

// ---------------------------------------------------------------------------

const metadataProbe = await db
  .from('questions')
  .select('source_file, source_collection, question_order')
  .limit(1);

const hasMetadataColumns = !metadataProbe.error;

// Build a set of invalid question texts to skip
const invalidKeys = new Set(
  anomalies
    .filter((a) => a.issue.startsWith('Too few') || a.issue.startsWith('Single-choice') || a.issue.includes('0 correct'))
    .map((a) => a.snippet)
);

for (const file of payload.files) {
  for (const q of file.questions) {
    const snippet = q.question_text?.slice(0, 60);
    if (invalidKeys.has(snippet)) {
      skipped++;
      continue;
    }

    const insertQuestion = {
      module: q.module,
      type: q.type,
      question_text: q.question_text,
      ...(hasMetadataColumns
        ? {
            source_file: q.source_file ?? file.file,
            source_collection: q.source_collection ?? 'data',
            question_order:
              typeof q.question_order === 'number'
                ? q.question_order
                : totalQ,
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

console.log(`Imported: ${totalQ} questions, ${totalA} answers. Skipped (invalid): ${skipped}.`);

const { error: runError } = await db.from('import_runs').insert({
  tag: IMPORT_TAG,
  source_file: INPUT,
  notes: `files=${payload.files.length},questions=${totalQ},answers=${totalA},skipped=${skipped}`,
});

if (runError) throw runError;

console.log(`Imported ${totalQ} questions and ${totalA} answers.`);
