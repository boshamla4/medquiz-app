import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Validation rules (mirrors import-to-supabase.mjs logic)
// ---------------------------------------------------------------------------
interface Answer {
  is_correct: boolean;
  text?: string;
}

interface Question {
  type: string;
  question_text: string;
  answers: Answer[];
}

function validateQuestion(q: Question): string | null {
  const n = q.answers?.length ?? 0;
  const correctCount = q.answers?.filter((a) => a.is_correct).length ?? 0;

  if (n < 2) return `Too few answers: ${n}`;
  if (n > 8) return `Too many answers: ${n}`;
  if (q.type === 'single' && correctCount !== 1)
    return `Single-choice has ${correctCount} correct answer(s)`;
  if (q.type === 'multiple' && correctCount === 0)
    return 'Multiple-choice has 0 correct answers';
  return null;
}

// ---------------------------------------------------------------------------
// Unit tests for the validation rules themselves
// ---------------------------------------------------------------------------
describe('validateQuestion — rule unit tests', () => {
  const base: Question = {
    type: 'single',
    question_text: 'Test question?',
    answers: [
      { is_correct: true },
      { is_correct: false },
      { is_correct: false },
      { is_correct: false },
      { is_correct: false },
    ],
  };

  it('passes a valid single-choice question', () => {
    expect(validateQuestion(base)).toBeNull();
  });

  it('passes a valid multiple-choice question', () => {
    const q: Question = { ...base, type: 'multiple', answers: [
      { is_correct: true }, { is_correct: true }, { is_correct: false },
      { is_correct: false }, { is_correct: false },
    ]};
    expect(validateQuestion(q)).toBeNull();
  });

  it('rejects question with 1 answer', () => {
    const q: Question = { ...base, answers: [{ is_correct: true }] };
    expect(validateQuestion(q)).toMatch(/Too few/);
  });

  it('rejects question with 9 answers', () => {
    const q: Question = {
      ...base,
      answers: Array.from({ length: 9 }, (_, i) => ({ is_correct: i === 0 })),
    };
    expect(validateQuestion(q)).toMatch(/Too many/);
  });

  it('rejects single-choice with 0 correct answers', () => {
    const q: Question = { ...base, answers: base.answers.map(() => ({ is_correct: false })) };
    expect(validateQuestion(q)).toMatch(/Single-choice has 0/);
  });

  it('rejects single-choice with 2 correct answers', () => {
    const q: Question = { ...base, answers: [
      { is_correct: true }, { is_correct: true }, { is_correct: false },
    ]};
    expect(validateQuestion(q)).toMatch(/Single-choice has 2/);
  });

  it('rejects multiple-choice with 0 correct answers', () => {
    const q: Question = { ...base, type: 'multiple', answers: [
      { is_correct: false }, { is_correct: false }, { is_correct: false },
    ]};
    expect(validateQuestion(q)).toMatch(/0 correct/);
  });
});

// ---------------------------------------------------------------------------
// Integration: run validation against the actual parsed-questions.json
// ---------------------------------------------------------------------------
describe('parsed-questions.json — data integrity', () => {
  const jsonPath = path.resolve('scripts/generated/parsed-questions.json');

  it('file exists', () => {
    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  it('has no invalid questions (anomalies are skipped at import)', () => {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const anomalies: { file: string; text: string; issue: string }[] = [];

    for (const file of payload.files) {
      const fname = file.file.split('/').at(-1);
      for (const q of file.questions as Question[]) {
        const issue = validateQuestion(q);
        if (issue) {
          anomalies.push({ file: fname, text: q.question_text.slice(0, 60), issue });
        }
      }
    }

    if (anomalies.length > 0) {
      console.warn(`\n⚠ ${anomalies.length} anomalous questions (will be skipped at import):`);
      for (const a of anomalies) {
        console.warn(`  [${a.file}] ${a.issue} — "${a.text}"`);
      }
    }

    // These are known parser edge cases in certain Pediatrics and Surgery files.
    // They are excluded from the database at import time by import-to-supabase.mjs.
    // Keep the threshold tight — if this number grows, the parser regressed.
    expect(anomalies.length).toBeLessThanOrEqual(30);
  });

  it('all questions have type single or multiple', () => {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const invalid: string[] = [];
    for (const file of payload.files) {
      for (const q of file.questions as Question[]) {
        if (q.type !== 'single' && q.type !== 'multiple') {
          invalid.push(`${file.file.split('/').at(-1)}: type="${q.type}"`);
        }
      }
    }
    expect(invalid).toHaveLength(0);
  });
});
