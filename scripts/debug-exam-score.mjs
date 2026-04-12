/**
 * Debug scoring for a specific exam ID with per-option breakdown.
 * Usage: node scripts/debug-exam-score.mjs <examId> [--verbose]
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const examId = parseInt(process.argv[2], 10);
if (isNaN(examId)) { console.error('Usage: node scripts/debug-exam-score.mjs <examId> [--verbose]'); process.exit(1); }
const verbose = process.argv.includes('--verbose');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: eqRows, error } = await db
  .from('exam_questions')
  .select('id, question_snapshot, user_answer, is_correct, score_weight')
  .eq('exam_id', examId)
  .order('id');

if (error) { console.error(error); process.exit(1); }

// BUGGY: current live formula uses (raw+1)/2 normalization
function scoreBuggy(snapshot, selectedIds) {
  const { type, answers } = snapshot;
  if (!Array.isArray(answers) || answers.length === 0) return 0;
  if (!selectedIds || selectedIds.length === 0) return 0;
  const selectedSet = new Set(selectedIds);
  if (type !== 'multiple') {
    const correctIds = answers.filter(a => a.is_correct).map(a => a.id);
    if (correctIds.length !== 1) return 0;
    return selectedSet.has(correctIds[0]) && selectedSet.size === 1 ? 1 : 0;
  }
  const N = answers.length;
  let raw = 0;
  for (const a of answers) {
    const chosen = selectedSet.has(a.id);
    raw += (a.is_correct ? 1 : -1) * (chosen ? 1 : -1) / N;
  }
  return Math.max(0, Math.min(1, (raw + 1) / 2)); // BUGGY normalization
}

// FIXED: no normalization, just clamp raw to [0,1]
function scoreFixed(snapshot, selectedIds, detail = false) {
  const { type, answers } = snapshot;
  if (!Array.isArray(answers) || answers.length === 0) return detail ? { score: 0, raw: 0, contributions: [] } : 0;
  if (!selectedIds || selectedIds.length === 0) return detail ? { score: 0, raw: 0, contributions: [] } : 0;
  const selectedSet = new Set(selectedIds);
  if (type !== 'multiple') {
    const correctIds = answers.filter(a => a.is_correct).map(a => a.id);
    if (correctIds.length !== 1) return detail ? { score: 0, raw: 0, contributions: [] } : 0;
    const s = selectedSet.has(correctIds[0]) && selectedSet.size === 1 ? 1 : 0;
    return detail ? { score: s, raw: s, contributions: [] } : s;
  }
  const N = answers.length;
  let raw = 0;
  const contributions = [];
  for (const a of answers) {
    const chosen = selectedSet.has(a.id);
    const contrib = (a.is_correct ? 1 : -1) * (chosen ? 1 : -1) / N;
    raw += contrib;
    if (detail) contributions.push({
      id: a.id,
      is_correct: a.is_correct,
      chosen,
      contrib: +contrib.toFixed(4),
      label: a.is_correct
        ? (chosen ? 'correct+selected  → +1/N' : 'correct+missed    → -1/N')
        : (chosen ? 'wrong+selected    → -1/N' : 'wrong+not-sel     → +1/N'),
    });
  }
  const score = Math.max(0, Math.min(1, raw));
  return detail ? { score, raw: +raw.toFixed(4), contributions } : score;
}

console.log(`\n=== Exam ${examId} — Score Debug ===\n`);
console.log('QID'.padEnd(8) + 'Type'.padEnd(10) + 'N'.padEnd(4) + 'Correct'.padEnd(8) + 'Selected'.padEnd(10) + 'Buggy'.padEnd(10) + 'Fixed');
console.log('─'.repeat(60));

let totalBuggy = 0, totalFixed = 0, answeredCount = 0;

for (const row of eqRows) {
  const snap = typeof row.question_snapshot === 'string'
    ? JSON.parse(row.question_snapshot) : row.question_snapshot;
  const ua = typeof row.user_answer === 'string'
    ? JSON.parse(row.user_answer) : (row.user_answer ?? []);

  const N = snap.answers?.length ?? 0;
  const correctCount = snap.answers?.filter(a => a.is_correct).length ?? 0;
  const selCount = ua.length;
  const buggy = scoreBuggy(snap, ua);
  const { score: fixed, raw, contributions } = scoreFixed(snap, ua, true);

  totalBuggy += buggy;
  totalFixed += fixed;
  if (selCount > 0) answeredCount++;

  const changed = Math.abs(buggy - fixed) > 0.001 ? ' ←' : '';
  console.log(
    String(row.id).padEnd(8) +
    snap.type.padEnd(10) +
    String(N).padEnd(4) +
    String(correctCount).padEnd(8) +
    String(selCount).padEnd(10) +
    buggy.toFixed(4).padEnd(10) +
    fixed.toFixed(4) + changed
  );

  if (verbose && selCount > 0 && snap.type === 'multiple') {
    console.log(`  raw=${raw}  →  score=${fixed}`);
    for (const c of contributions) {
      console.log(`    ${c.label}  contrib=${c.contrib}`);
    }
  }
}

const total = eqRows.length;
console.log('─'.repeat(60));
console.log(`\nTotal questions : ${total}`);
console.log(`Answered        : ${answeredCount}`);
console.log(`\nBuggy  score    : ${totalBuggy.toFixed(4)} / ${total}  (${(totalBuggy/total*100).toFixed(2)}%)`);
console.log(`Fixed  score    : ${totalFixed.toFixed(4)} / ${total}  (${(totalFixed/total*100).toFixed(2)}%)`);
