/**
 * Scoring logic for exam questions.
 *
 * Single choice (CS): binary — 1 if the correct answer is selected, 0 otherwise.
 *
 * Multiple choice (CM): weighted per-answer scoring with N = total answers.
 *   For each answer:
 *     - Correct + selected   → +1/N
 *     - Correct + not sel    → -1/N
 *     - Incorrect + selected → -1/N
 *     - Incorrect + not sel  → +1/N
 *   Raw sum is normalised to [0, 1] (clamped at 0).
 */

export interface ScoringAnswer {
  id: number;
  is_correct: boolean;
}

export interface ScoringSnapshot {
  type: string;
  answers: ScoringAnswer[];
}

/**
 * Returns a weight in [0, 1] for a single question.
 * CS questions return exactly 0 or 1.
 * CM questions return a float [0, 1].
 */
export function scoreQuestion(
  snapshot: ScoringSnapshot,
  selectedIds: number[]
): number {
  const { type, answers } = snapshot;

  if (!Array.isArray(answers) || answers.length === 0) return 0;

  const selectedSet = new Set(selectedIds);

  if (type !== 'multiple') {
    // Single choice: correct only if exactly the right answer is selected
    const correctIds = answers.filter((a) => a.is_correct).map((a) => a.id);
    if (correctIds.length !== 1) return 0;
    return selectedSet.has(correctIds[0]) && selectedSet.size === 1 ? 1 : 0;
  }

  // Multiple choice: weighted scoring
  const N = answers.length;
  let raw = 0;

  for (const answer of answers) {
    const chosen = selectedSet.has(answer.id);
    if (answer.is_correct) {
      raw += chosen ? 1 / N : -1 / N;
    } else {
      raw += chosen ? -1 / N : 1 / N;
    }
  }

  // Normalise: raw range is [-1, 1], shift to [0, 1] then clamp
  const normalised = (raw + 1) / 2;
  return Math.max(0, Math.min(1, normalised));
}

/**
 * Returns true only when the answer is fully correct (weight === 1).
 * Used to populate the legacy boolean `is_correct` column.
 */
export function isFullyCorrect(
  snapshot: ScoringSnapshot,
  selectedIds: number[]
): boolean {
  return scoreQuestion(snapshot, selectedIds) === 1;
}

/**
 * Formats a weight value for display: drops trailing zeros after decimal.
 * 1 → "1", 0 → "0", 0.40 → "0.4", 0.75 → "0.75"
 */
export function formatWeight(w: number): string {
  if (w === 1) return '1';
  if (w === 0) return '0';
  return parseFloat(w.toFixed(2)).toString();
}

/**
 * Returns the user-facing feedback message for a question result.
 */
export function scoreFeedback(weight: number): string {
  if (weight === 1) return '1 point. Correct answer.';
  if (weight === 0) return '0 points. Incorrect answer. Review highlighted options above.';
  return `${formatWeight(weight)} point. You missed some answers. Review highlighted options above.`;
}
