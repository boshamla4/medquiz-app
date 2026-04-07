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
  is_correct: boolean;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const { searchParams } = request.nextUrl;
  const moduleFilter = searchParams.get('module');
  const random = searchParams.get('random') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 100);

  let questions: QuestionRow[] = [];

  if (random) {
    const rpcResult = await db.rpc('get_random_questions', {
      p_module: moduleFilter ?? null,
      p_limit: limit,
    });

    if (!rpcResult.error && rpcResult.data) {
      questions = rpcResult.data.map((q) => ({
        id: q.id,
        module: q.module,
        type: q.type,
        question_text: q.question_text,
      }));
    } else {
      let fallbackQuery = db
        .from('questions')
        .select('id, module, type, question_text')
        .is('deleted_at', null)
        .order('id')
        .limit(limit * 3);

      if (moduleFilter) {
        fallbackQuery = fallbackQuery.eq('module', moduleFilter);
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
    }
  } else {
    let query = db
      .from('questions')
      .select('id, module, type, question_text')
      .is('deleted_at', null)
      .order('id')
      .limit(limit);

    if (moduleFilter) {
      query = query.eq('module', moduleFilter);
    }

    const { data, error } = await query;
    if (error || !data) {
      return NextResponse.json(
        { error: 'Failed to fetch questions', code: 'QUESTIONS_FETCH_FAILED' },
        { status: 500 }
      );
    }

    questions = data;
  }

  if (questions.length === 0) {
    return NextResponse.json({ questions: [] });
  }

  const questionIds = questions.map((q) => q.id);

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
