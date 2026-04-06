import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const RetrySchema = z.object({
  examId: z.number().int().positive(),
  filter: z.enum(['all', 'wrong_only']).default('all'),
});

interface ExamQuestionRow {
  question_id: number;
  is_correct: number | null;
}

interface QuestionRow {
  id: number;
  module: string;
  type: string;
  question_text: string;
}

interface AnswerRow {
  id: number;
  question_id: number;
  answer_text: string;
  is_correct: number;
}

interface InsertResult {
  lastInsertRowid: number | bigint;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    );
  }

  const parsed = RetrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const { examId, filter } = parsed.data;

  const examOwner = db
    .prepare('SELECT id FROM exams WHERE id = ? AND user_id = ?')
    .get(examId, session.userId) as { id: number } | undefined;

  if (!examOwner) {
    return NextResponse.json(
      { error: 'Exam not found', code: 'EXAM_NOT_FOUND' },
      { status: 404 }
    );
  }

  let eqQuery = `
    SELECT question_id, is_correct
    FROM exam_questions
    WHERE exam_id = ?
  `;
  const eqParams: number[] = [examId];

  if (filter === 'wrong_only') {
    eqQuery += ' AND is_correct = 0';
  }

  const examQs = db.prepare(eqQuery).all(...eqParams) as ExamQuestionRow[];
  const questionIds = examQs.map((eq) => eq.question_id);

  if (questionIds.length === 0) {
    return NextResponse.json(
      { error: 'No questions found for retry', code: 'NO_QUESTIONS' },
      { status: 404 }
    );
  }

  const placeholders = questionIds.map(() => '?').join(',');

  const questions = db
    .prepare(
      `SELECT id, module, type, question_text
       FROM questions
       WHERE id IN (${placeholders}) AND deleted_at IS NULL`
    )
    .all(...questionIds) as QuestionRow[];

  const answers = db
    .prepare(
      `SELECT id, question_id, answer_text, is_correct
       FROM answers
       WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`
    )
    .all(...questionIds) as AnswerRow[];

  const answersByQuestion = new Map<number, AnswerRow[]>();
  for (const a of answers) {
    const list = answersByQuestion.get(a.question_id) ?? [];
    list.push(a);
    answersByQuestion.set(a.question_id, list);
  }

  const newExamResult = db
    .prepare('INSERT INTO exams (user_id, started_at) VALUES (?, CURRENT_TIMESTAMP)')
    .run(session.userId) as InsertResult;
  const newExamId = Number(newExamResult.lastInsertRowid);

  const insertEQ = db.prepare(
    `INSERT INTO exam_questions (exam_id, question_id, question_snapshot)
     VALUES (?, ?, ?)`
  );

  const examQuestions: { id: number; question_snapshot: object }[] = [];

  const insertAll = db.transaction(() => {
    for (const q of questions) {
      const qAnswers = answersByQuestion.get(q.id) ?? [];
      const snapshot = {
        id: q.id,
        module: q.module,
        type: q.type,
        question_text: q.question_text,
        answers: qAnswers.map((a) => ({
          id: a.id,
          answer_text: a.answer_text,
          is_correct: Boolean(a.is_correct),
        })),
      };

      const eqResult = insertEQ.run(
        newExamId,
        q.id,
        JSON.stringify(snapshot)
      ) as InsertResult;

      examQuestions.push({
        id: Number(eqResult.lastInsertRowid),
        question_snapshot: snapshot,
      });
    }
  });

  insertAll();

  return NextResponse.json({ examId: newExamId, questions: examQuestions });
}
