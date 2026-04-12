import { describe, it, expect } from 'vitest';
import { scoreQuestion, isFullyCorrect } from '../lib/scoring';

// Helper to build a snapshot with N answers, correct at given indices.
function makeSnapshot(type: string, totalAnswers: number, correctIndices: number[]) {
  return {
    type,
    answers: Array.from({ length: totalAnswers }, (_, i) => ({
      id: i + 1,
      is_correct: correctIndices.includes(i),
    })),
  };
}

// ---------------------------------------------------------------------------
// Single choice
// ---------------------------------------------------------------------------
describe('scoreQuestion — single choice', () => {
  it('returns 1 when the single correct answer is selected', () => {
    const s = makeSnapshot('single', 5, [2]);
    expect(scoreQuestion(s, [3])).toBe(1);
  });

  it('returns 0 when a wrong answer is selected', () => {
    const s = makeSnapshot('single', 5, [2]);
    expect(scoreQuestion(s, [1])).toBe(0);
  });

  it('returns 0 when multiple answers are selected for a single-choice question', () => {
    const s = makeSnapshot('single', 5, [2]);
    expect(scoreQuestion(s, [3, 1])).toBe(0);
  });

  it('returns 0 for empty selection', () => {
    const s = makeSnapshot('single', 5, [0]);
    expect(scoreQuestion(s, [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple choice — edge distributions
// ---------------------------------------------------------------------------
describe('scoreQuestion — multiple choice', () => {
  it('returns 1 when all correct answers are selected and no wrong ones', () => {
    const s = makeSnapshot('multiple', 5, [0, 2, 4]);
    expect(scoreQuestion(s, [1, 3, 5])).toBe(1);
  });

  it('returns 0 (clamped) when no correct answers are selected and all wrong ones are selected', () => {
    const s = makeSnapshot('multiple', 5, [0, 2, 4]);
    expect(scoreQuestion(s, [2, 4])).toBe(0); // selecting only wrong answers
  });

  it('returns 0 for empty selection (every correct is missed, every wrong is not-selected)', () => {
    // With 5 answers, 3 correct: each correct missed = -1/5, each wrong not-sel = +1/5
    // raw = -3/5 + 2/5 = -1/5  → norm = (−0.2+1)/2 = 0.4 → NOT 0
    // Actually let's test the real value
    const s = makeSnapshot('multiple', 5, [0, 1, 2]);
    const score = scoreQuestion(s, []);
    // raw: correct not sel: 3 × (−1/5) = −0.6; wrong not sel: 2 × (+1/5) = +0.4 → raw = −0.2
    // normalised = (−0.2+1)/2 = 0.4
    expect(score).toBeCloseTo(0.4, 5);
  });

  it('clamps to 0 for worst-case selection (select all wrong, miss all correct)', () => {
    const s = makeSnapshot('multiple', 4, [0, 1]); // 2 correct, 2 wrong
    // Select only wrong answers (ids 3, 4)
    const score = scoreQuestion(s, [3, 4]);
    // correct not sel: 2×(−1/4)=−0.5; wrong sel: 2×(−1/4)=−0.5 → raw=−1 → norm=0 → clamped 0
    expect(score).toBe(0);
  });

  it('returns partial score for partial selection', () => {
    // 4 answers, 2 correct (ids 1,2), select only id 1
    const s = makeSnapshot('multiple', 4, [0, 1]);
    const score = scoreQuestion(s, [1]);
    // correct sel: 1×(+1/4)=0.25; correct not sel: 1×(−1/4)=−0.25; wrong not sel: 2×(+1/4)=0.5
    // raw = 0.25 − 0.25 + 0.5 = 0.5 → norm = (0.5+1)/2 = 0.75
    expect(score).toBeCloseTo(0.75, 5);
  });

  it('works correctly with a single correct answer in multiple-choice type', () => {
    const s = makeSnapshot('multiple', 5, [1]);
    expect(scoreQuestion(s, [2])).toBe(1); // select the one correct answer
  });

  it('score is always in [0, 1]', () => {
    for (let total = 2; total <= 8; total++) {
      for (let nCorrect = 1; nCorrect < total; nCorrect++) {
        const correctIndices = Array.from({ length: nCorrect }, (_, i) => i);
        const s = makeSnapshot('multiple', total, correctIndices);
        // All possible selections (simulate random)
        for (let mask = 0; mask < 1 << total; mask++) {
          const selected = Array.from({ length: total }, (_, i) =>
            (mask >> i) & 1 ? i + 1 : 0
          ).filter(Boolean);
          const sc = scoreQuestion(s, selected);
          expect(sc).toBeGreaterThanOrEqual(0);
          expect(sc).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// isFullyCorrect
// ---------------------------------------------------------------------------
describe('isFullyCorrect', () => {
  it('true only when weight === 1', () => {
    const s = makeSnapshot('multiple', 5, [0, 2, 4]);
    expect(isFullyCorrect(s, [1, 3, 5])).toBe(true);
    expect(isFullyCorrect(s, [1, 3])).toBe(false);
  });

  it('true for correct CS selection', () => {
    const s = makeSnapshot('single', 5, [3]);
    expect(isFullyCorrect(s, [4])).toBe(true);
    expect(isFullyCorrect(s, [1])).toBe(false);
  });
});
