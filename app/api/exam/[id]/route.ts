import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

interface ExamRow {
  id: number;
  user_id: number;
  started_at: string;
  finished_at: string | null;
  duration: number | null;
}

interface ExamQuestionRow {
  id: number;
  question_id: number;
  question_snapshot: string;
  user_answer: string | null;
  is_correct: number | null;
}

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

  const exam = db
    .prepare(
      'SELECT id, user_id, started_at, finished_at, duration FROM exams WHERE id = ?'
    )
    .get(examId) as ExamRow | undefined;

  if (!exam || exam.user_id !== session.userId) {
    return NextResponse.json(
      { error: 'Exam not found', code: 'EXAM_NOT_FOUND' },
      { status: 404 }
    );
  }

  const examQuestions = db
    .prepare(
      `SELECT id, question_id, question_snapshot, user_answer, is_correct
       FROM exam_questions
       WHERE exam_id = ?
       ORDER BY id`
    )
    .all(examId) as ExamQuestionRow[];

  const questions = examQuestions.map((eq) => ({
    id: eq.id,
    question_id: eq.question_id,
    question_snapshot: JSON.parse(eq.question_snapshot) as unknown,
    user_answer: eq.user_answer ? (JSON.parse(eq.user_answer) as number[]) : null,
    is_correct: eq.is_correct === null ? null : Boolean(eq.is_correct),
  }));

  return NextResponse.json({
    id: exam.id,
    started_at: exam.started_at,
    finished_at: exam.finished_at,
    duration: exam.duration,
    questions,
  });
}
