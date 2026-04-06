import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const StartExamSchema = z.object({
  module: z.string().optional(),
  limit: z.number().int().positive().max(200).optional().default(20),
  source_exam_id: z.number().int().positive().optional(),
  filter: z.enum(['all', 'wrong_only']).optional().default('all'),
});

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

interface ExamQuestionRow {
  question_id: number;
  question_snapshot: string;
  is_correct: number | null;
}

interface InsertResult {
  lastInsertRowid: number | bigint;
}

function fetchQuestionsWithAnswers(questionIds: number[]): {
  question: QuestionRow;
  answers: AnswerRow[];
}[] {
  if (questionIds.length === 0) return [];

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

  return questions.map((q) => ({
    question: q,
    answers: answersByQuestion.get(q.id) ?? [],
  }));
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

  const parsed = StartExamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const { module, limit, source_exam_id, filter } = parsed.data;

  let questionData: { question: QuestionRow; answers: AnswerRow[] }[] = [];

  if (source_exam_id !== undefined) {
    const examOwner = db
      .prepare('SELECT id FROM exams WHERE id = ? AND user_id = ?')
      .get(source_exam_id, session.userId) as { id: number } | undefined;

    if (!examOwner) {
      return NextResponse.json(
        { error: 'Exam not found', code: 'EXAM_NOT_FOUND' },
        { status: 404 }
      );
    }

    let eqQuery = `
      SELECT question_id, question_snapshot, is_correct
      FROM exam_questions
      WHERE exam_id = ?
    `;
    const eqParams: (number | string)[] = [source_exam_id];

    if (filter === 'wrong_only') {
      eqQuery += ' AND is_correct = 0';
    }

    const examQs = db.prepare(eqQuery).all(...eqParams) as ExamQuestionRow[];
    const questionIds = examQs.map((eq) => eq.question_id);
    questionData = fetchQuestionsWithAnswers(questionIds);
  } else {
    let qQuery = `
      SELECT id, module, type, question_text
      FROM questions
      WHERE deleted_at IS NULL
    `;
    const qParams: (string | number)[] = [];

    if (module) {
      qQuery += ' AND module = ?';
      qParams.push(module);
    }

    qQuery += ' ORDER BY RANDOM() LIMIT ?';
    qParams.push(limit);

    const questions = db.prepare(qQuery).all(...qParams) as QuestionRow[];
    const questionIds = questions.map((q) => q.id);
    questionData = fetchQuestionsWithAnswers(questionIds);
  }

  if (questionData.length === 0) {
    return NextResponse.json(
      { error: 'No questions found', code: 'NO_QUESTIONS' },
      { status: 404 }
    );
  }

  const insertExam = db.prepare(
    'INSERT INTO exams (user_id, started_at) VALUES (?, CURRENT_TIMESTAMP)'
  );
  const examResult = insertExam.run(session.userId) as InsertResult;
  const examId = Number(examResult.lastInsertRowid);

  const insertEQ = db.prepare(
    `INSERT INTO exam_questions (exam_id, question_id, question_snapshot)
     VALUES (?, ?, ?)`
  );

  const examQuestions: { id: number; question_snapshot: object }[] = [];

  const insertAll = db.transaction(() => {
    for (const { question, answers } of questionData) {
      const snapshot = {
        id: question.id,
        module: question.module,
        type: question.type,
        question_text: question.question_text,
        answers: answers.map((a) => ({
          id: a.id,
          answer_text: a.answer_text,
          is_correct: Boolean(a.is_correct),
        })),
      };

      const eqResult = insertEQ.run(
        examId,
        question.id,
        JSON.stringify(snapshot)
      ) as InsertResult;

      examQuestions.push({
        id: Number(eqResult.lastInsertRowid),
        question_snapshot: snapshot,
      });
    }
  });

  insertAll();

  return NextResponse.json({ examId, questions: examQuestions });
}
