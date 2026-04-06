import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const { searchParams } = request.nextUrl;
  const module = searchParams.get('module');
  const random = searchParams.get('random') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 100);

  let query = `
    SELECT id, module, type, question_text
    FROM questions
    WHERE deleted_at IS NULL
  `;
  const params: (string | number)[] = [];

  if (module) {
    query += ' AND module = ?';
    params.push(module);
  }

  if (random) {
    query += ' ORDER BY RANDOM()';
  } else {
    query += ' ORDER BY id';
  }

  query += ' LIMIT ?';
  params.push(limit);

  const questions = db.prepare(query).all(...params) as QuestionRow[];

  if (questions.length === 0) {
    return NextResponse.json({ questions: [] });
  }

  const questionIds = questions.map((q) => q.id);
  const placeholders = questionIds.map(() => '?').join(',');

  const answers = db
    .prepare(
      `SELECT id, question_id, answer_text, is_correct
       FROM answers
       WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`
    )
    .all(...questionIds) as AnswerRow[];

  const answersByQuestion = new Map<number, AnswerRow[]>();
  for (const answer of answers) {
    const list = answersByQuestion.get(answer.question_id) ?? [];
    list.push(answer);
    answersByQuestion.set(answer.question_id, list);
  }

  const result = questions.map((q) => ({
    id: q.id,
    module: q.module,
    type: q.type,
    question_text: q.question_text,
    answers: (answersByQuestion.get(q.id) ?? []).map((a) => ({
      id: a.id,
      answer_text: a.answer_text,
      is_correct: Boolean(a.is_correct),
    })),
  }));

  return NextResponse.json({ questions: result });
}
