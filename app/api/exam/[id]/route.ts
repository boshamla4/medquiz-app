import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const examId = parseInt(id, 10);

  if (isNaN(examId)) {
    return NextResponse.json(
      { error: 'Invalid exam ID', code: 'INVALID_ID' },
      { status: 400 }
    );
  }

  const { data: exam, error: examError } = await db
    .from('exams')
    .select('id, user_id, started_at, finished_at, duration')
    .eq('id', examId)
    .eq('user_id', session.userId)
    .maybeSingle();

  if (examError) {
    return NextResponse.json(
      { error: 'Failed to load exam', code: 'EXAM_LOOKUP_FAILED' },
      { status: 500 }
    );
  }

  if (!exam) {
    return NextResponse.json(
      { error: 'Exam not found', code: 'EXAM_NOT_FOUND' },
      { status: 404 }
    );
  }

  const { data: examQuestions, error: examQuestionsError } = await db
    .from('exam_questions')
    .select('id, question_id, question_snapshot, user_answer, is_correct')
    .eq('exam_id', examId)
    .order('id');

  if (examQuestionsError || !examQuestions) {
    return NextResponse.json(
      { error: 'Failed to load exam questions', code: 'EXAM_QUESTIONS_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const questions = examQuestions.map((eq) => ({
    id: eq.id,
    question_id: eq.question_id,
    question_snapshot:
      typeof eq.question_snapshot === 'string'
        ? (JSON.parse(eq.question_snapshot) as unknown)
        : eq.question_snapshot,
    user_answer:
      typeof eq.user_answer === 'string'
        ? (JSON.parse(eq.user_answer) as number[])
        : ((eq.user_answer as number[] | null) ?? null),
    is_correct: eq.is_correct,
  }));

  return NextResponse.json({
    id: exam.id,
    started_at: exam.started_at,
    finished_at: exam.finished_at,
    duration: exam.duration,
    questions,
  });
}
