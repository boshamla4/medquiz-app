/**
 * Debug scoring for a specific exam ID.
 * Usage: node scripts/debug-exam-score.mjs <examId>
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const examId = parseInt(process.argv[2], 10);
if (isNaN(examId)) { console.error('Usage: node scripts/debug-exam-score.mjs <examId>'); process.exit(1); }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: eqRows, error } = await db
  .from('exam_questions')
  .select('id, question_snapshot, user_answer, is_correct, score_weight')
  .eq('exam_id', examId)
  .order('id');

if (error) { console.error(error); process.exit(1); }

function scoreQuestion(snapshot, selectedIds) {
  const { type, answers } = snapshot;
  if (!Array.isArray(answers) || answers.length === 0) return 0;
  if (!selectedIds || selectedIds.length === 0) return 0; // unanswered

  const selectedSet = new Set(selectedIds);
  if (type !== 'multiple') {
    const correctIds = answers.filter(a => a.is_correct).map(a => a.id);
    if (correctIds.length !== 1) return 0;
    return selectedSet.has(correctIds[0]) && selectedSet.size === 1 ? 1 : 0;
  }

  const N = answers.length;
  let raw = 0;
  for (const answer of answers) {
    const chosen = selectedSet.has(answer.id);
    raw += (answer.is_correct ? 1 : -1) * (chosen ? 1 : -1) / N;
  }
  return Math.max(0, Math.min(1, (raw + 1) / 2));
}

function scoreBuggy(snapshot, selectedIds) {
  // Reproduces current (buggy) behavior: treats unanswered as empty selection
  const { type, answers } = snapshot;
  if (!Array.isArray(answers) || answers.length === 0) return 0;

  const selectedSet = new Set(selectedIds ?? []);
  if (type !== 'multiple') {
    const correctIds = answers.filter(a => a.is_correct).map(a => a.id);
    if (correctIds.length !== 1) return 0;
    return selectedSet.has(correctIds[0]) && selectedSet.size === 1 ? 1 : 0;
  }

  const N = answers.length;
  let raw = 0;
  for (const answer of answers) {
    const chosen = selectedSet.has(answer.id);
    raw += (answer.is_correct ? 1 : -1) * (chosen ? 1 : -1) / N;
  }
  return Math.max(0, Math.min(1, (raw + 1) / 2));
}

console.log(`\n=== Exam ${examId} — Score Debug ===\n`);
console.log('QID'.padEnd(8) + 'Type'.padEnd(10) + 'N'.padEnd(4) + 'Selected'.padEnd(10) + 'Buggy'.padEnd(10) + 'Fixed');
console.log('─'.repeat(52));

let totalBuggy = 0;
let totalFixed = 0;
let answeredCount = 0;

for (const row of eqRows) {
  const snap = typeof row.question_snapshot === 'string'
    ? JSON.parse(row.question_snapshot)
    : row.question_snapshot;
  const ua = typeof row.user_answer === 'string'
    ? JSON.parse(row.user_answer)
    : (row.user_answer ?? []);

  const N = snap.answers?.length ?? 0;
  const selCount = ua.length;
  const buggy = scoreBuggy(snap, ua);
  const fixed = scoreQuestion(snap, ua);

  totalBuggy += buggy;
  totalFixed += fixed;
  if (selCount > 0) answeredCount++;

  const changed = Math.abs(buggy - fixed) > 0.001 ? ' ←' : '';
  console.log(
    String(row.id).padEnd(8) +
    snap.type.padEnd(10) +
    String(N).padEnd(4) +
    String(selCount).padEnd(10) +
    buggy.toFixed(4).padEnd(10) +
    fixed.toFixed(4) + changed
  );
}

const total = eqRows.length;
console.log('─'.repeat(52));
console.log(`\nTotal questions : ${total}`);
console.log(`Answered        : ${answeredCount}`);
console.log(`\nBuggy  score    : ${totalBuggy.toFixed(4)} / ${total}  (${(totalBuggy/total*100).toFixed(1)}%)`);
console.log(`Fixed  score    : ${totalFixed.toFixed(4)} / ${total}  (${(totalFixed/total*100).toFixed(1)}%)`);
