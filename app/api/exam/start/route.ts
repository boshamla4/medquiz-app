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
  is_correct: boolean;
}

async function fetchQuestionsWithAnswers(questionIds: number[]): Promise<{
  question: QuestionRow;
  answers: AnswerRow[];
}[]> {
  if (questionIds.length === 0) return [];

  const { data: questions, error: questionsError } = await db
    .from('questions')
    .select('id, module, type, question_text')
    .in('id', questionIds)
    .is('deleted_at', null);

  if (questionsError || !questions) return [];

  const { data: answers, error: answersError } = await db
    .from('answers')
    .select('id, question_id, answer_text, is_correct')
    .in('question_id', questionIds)
    .is('deleted_at', null);

  if (answersError || !answers) return [];

  const answersByQuestion = new Map<number, AnswerRow[]>();
  for (const a of answers) {
    const list = answersByQuestion.get(a.question_id) ?? [];
    list.push(a);
    answersByQuestion.set(a.question_id, list);
  }

  const questionsById = new Map<number, QuestionRow>();
  for (const q of questions) questionsById.set(q.id, q);

  return questionIds
    .map((id) => questionsById.get(id))
    .filter((q): q is QuestionRow => Boolean(q))
    .map((q) => ({
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
    const { data: examOwner, error: ownerError } = await db
      .from('exams')
      .select('id')
      .eq('id', source_exam_id)
      .eq('user_id', session.userId)
      .maybeSingle();

    if (ownerError) {
      return NextResponse.json(
        { error: 'Failed to verify source exam', code: 'SOURCE_EXAM_LOOKUP_FAILED' },
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
      .select('question_id, question_snapshot, is_correct')
      .eq('exam_id', source_exam_id);

    if (filter === 'wrong_only') {
      eqQuery = eqQuery.eq('is_correct', false);
    }

    const { data: examQs, error: examQsError } = await eqQuery;
    if (examQsError || !examQs) {
      return NextResponse.json(
        { error: 'Failed to fetch source questions', code: 'SOURCE_QUESTIONS_FETCH_FAILED' },
        { status: 500 }
      );
    }

    const questionIds = examQs.map((eq) => eq.question_id);
    questionData = await fetchQuestionsWithAnswers(questionIds);
  } else {
    let questions: QuestionRow[] = [];

    const rpcResult = await db.rpc('get_random_questions', {
      p_module: module ?? null,
      p_limit: limit,
    });

    if (rpcResult.error || !rpcResult.data) {
      let fallbackQuery = db
        .from('questions')
        .select('id, module, type, question_text')
        .is('deleted_at', null)
        .order('id')
        .limit(limit * 3);

      if (module) {
        fallbackQuery = fallbackQuery.eq('module', module);
      }

      const { data: fallbackQuestions, error: fallbackError } = await fallbackQuery;
      if (fallbackError || !fallbackQuestions) {
        return NextResponse.json(
          { error: 'Failed to fetch questions', code: 'QUESTIONS_FETCH_FAILED' },
          { status: 500 }
        );
      }

      questions = [...fallbackQuestions]
        .sort(() => Math.random() - 0.5)
        .slice(0, limit);
    } else {
      questions = rpcResult.data.map((q) => ({
        id: q.id,
        module: q.module,
        type: q.type,
        question_text: q.question_text,
      }));
    }

    const questionIds = questions.map((q) => q.id);
    questionData = await fetchQuestionsWithAnswers(questionIds);
  }

  if (questionData.length === 0) {
    return NextResponse.json(
      { error: 'No questions found', code: 'NO_QUESTIONS' },
      { status: 404 }
    );
  }

  const { data: examRow, error: examInsertError } = await db
    .from('exams')
    .insert({ user_id: session.userId, started_at: new Date().toISOString() })
    .select('id')
    .single();

  if (examInsertError || !examRow) {
    return NextResponse.json(
      { error: 'Failed to create exam', code: 'EXAM_CREATE_FAILED' },
      { status: 500 }
    );
  }

  const examId = examRow.id;

  const examQuestions: { id: number; question_snapshot: object }[] = [];

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

    const { data: examQuestionRow, error: examQuestionInsertError } = await db
      .from('exam_questions')
      .insert({
        exam_id: examId,
        question_id: question.id,
        question_snapshot: JSON.stringify(snapshot),
      })
      .select('id')
      .single();

    if (examQuestionInsertError || !examQuestionRow) {
      return NextResponse.json(
        { error: 'Failed to save exam questions', code: 'EXAM_QUESTIONS_CREATE_FAILED' },
        { status: 500 }
      );
    }

    examQuestions.push({
      id: examQuestionRow.id,
      question_snapshot: snapshot,
    });
  }

  return NextResponse.json({ examId, questions: examQuestions });
}
