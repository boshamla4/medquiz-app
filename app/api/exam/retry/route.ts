import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const RetrySchema = z.object({
  examId: z.number().int().positive(),
  filter: z.enum(['all', 'wrong_only']).default('all'),
});

interface QuestionRow {
  id: number;
  module: string;
  source_file?: string | null;
  question_order?: number | null;
  type: string;
  question_text: string;
}

interface AnswerRow {
  id: number;
  question_id: number;
  answer_text: string;
  is_correct: boolean;
}

interface ExamQuestionSnapshot {
  id: number;
  module: string;
  source_file: string;
  question_order: number | null;
  type: string;
  question_text: string;
  answers: Array<{
    id: number;
    answer_text: string;
    is_correct: boolean;
  }>;
}

interface ExamQuestionRow {
  question: QuestionRow;
  snapshot: ExamQuestionSnapshot;
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

  const { data: examOwner, error: examOwnerError } = await db
    .from('exams')
    .select('id')
    .eq('id', examId)
    .eq('user_id', session.userId)
    .maybeSingle();

  if (examOwnerError) {
    return NextResponse.json(
      { error: 'Failed to verify exam', code: 'EXAM_LOOKUP_FAILED' },
      { status: 500 }
    );
  }

  if (!examOwner) {
    return NextResponse.json(
      { error: 'Exam not found', code: 'EXAM_NOT_FOUND' },
      { status: 404 }
    );
  }

  let eqQuery = db
    .from('exam_questions')
    .select('question_id, is_correct')
    .eq('exam_id', examId);

  if (filter === 'wrong_only') {
    eqQuery = eqQuery.eq('is_correct', false);
  }

  const { data: examQs, error: examQuestionsError } = await eqQuery;
  if (examQuestionsError || !examQs) {
    return NextResponse.json(
      { error: 'Failed to fetch exam questions', code: 'EXAM_QUESTIONS_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const questionIds = examQs.map((eq) => eq.question_id);

  if (questionIds.length === 0) {
    return NextResponse.json(
      { error: 'No questions found for retry', code: 'NO_QUESTIONS' },
      { status: 404 }
    );
  }

  const { data: questions, error: questionsError } = await db
    .from('questions')
    .select('id, module, source_file, question_order, type, question_text')
    .in('id', questionIds)
    .is('deleted_at', null);

  if (questionsError || !questions) {
    return NextResponse.json(
      { error: 'Failed to fetch questions', code: 'QUESTIONS_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const { data: answers, error: answersError } = await db
    .from('answers')
    .select('id, question_id, answer_text, is_correct')
    .in('question_id', questionIds)
    .is('deleted_at', null);

  if (answersError || !answers) {
    return NextResponse.json(
      { error: 'Failed to fetch answers', code: 'ANSWERS_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const answersByQuestion = new Map<number, AnswerRow[]>();
  for (const a of answers) {
    const list = answersByQuestion.get(a.question_id) ?? [];
    list.push(a);
    answersByQuestion.set(a.question_id, list);
  }

  const { data: newExamRow, error: createExamError } = await db
    .from('exams')
    .insert({ user_id: session.userId, started_at: new Date().toISOString() })
    .select('id')
    .single();

  if (createExamError || !newExamRow) {
    return NextResponse.json(
      { error: 'Failed to create exam', code: 'EXAM_CREATE_FAILED' },
      { status: 500 }
    );
  }

  const newExamId = newExamRow.id;

  const questionsById = new Map<number, QuestionRow>();
  for (const q of questions) questionsById.set(q.id, q);


  const examQuestionRows: ExamQuestionRow[] = questionIds
    .map((questionId) => {
      const q = questionsById.get(questionId);
      if (!q) return null;

      const qAnswers = answersByQuestion.get(q.id) ?? [];
      const snapshot: ExamQuestionSnapshot = {
        id: q.id,
        module: q.module,
        source_file: q.source_file ?? q.module,
        question_order: q.question_order ?? null,
        type: q.type,
        question_text: q.question_text,
        answers: qAnswers.map((a) => ({
          id: a.id,
          answer_text: a.answer_text,
          is_correct: Boolean(a.is_correct),
        })),
      };

      return { question: q, snapshot };
    })
    .filter((entry): entry is ExamQuestionRow => Boolean(entry));

  const insertedExamQuestionIds = new Map<number, number>();
  const batchSize = 250;

  for (let index = 0; index < examQuestionRows.length; index += batchSize) {
    const batch = examQuestionRows.slice(index, index + batchSize).map(({ question, snapshot }) => ({
      exam_id: newExamId,
      question_id: question.id,
      question_snapshot: JSON.stringify(snapshot),
    }));

    const { data: insertedRows, error: examQuestionInsertError } = await db
      .from('exam_questions')
      .insert(batch)
      .select('id, question_id');

    if (examQuestionInsertError || !insertedRows) {
      return NextResponse.json(
        { error: 'Failed to save exam questions', code: 'EXAM_QUESTIONS_CREATE_FAILED' },
        { status: 500 }
      );
    }

    for (const row of insertedRows) {
      insertedExamQuestionIds.set(row.question_id, row.id);
    }
  }

  const examQuestions = examQuestionRows
    .map(({ question, snapshot }) => ({
      id: insertedExamQuestionIds.get(question.id) ?? 0,
      question_snapshot: snapshot,
    }))
    .filter((entry) => entry.id > 0);

  return NextResponse.json({ examId: newExamId, questions: examQuestions });
}
