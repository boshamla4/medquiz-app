import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const SubmitAnswerSchema = z.object({
  examQuestionId: z.number().int().positive(),
  selectedAnswerIds: z.array(z.number().int().positive()),
});

const SubmitExamSchema = z.object({
  examId: z.number().int().positive(),
  answers: z.array(SubmitAnswerSchema),
});

interface ExamQuestionRow {
  id: number;
  question_id: number;
  question_snapshot: string | QuestionSnapshot;
}

interface SnapshotAnswer {
  id: number;
  answer_text: string;
  is_correct: boolean;
}

interface QuestionSnapshot {
  id: number;
  type: string;
  answers: SnapshotAnswer[];
}

function isAnswerCorrect(snapshot: QuestionSnapshot, selectedIds: number[]): boolean {
  const correctIds = snapshot.answers
    .filter((a) => a.is_correct)
    .map((a) => a.id)
    .sort((a, b) => a - b);

  const selected = [...selectedIds].sort((a, b) => a - b);

  if (correctIds.length !== selected.length) return false;
  return correctIds.every((id, i) => id === selected[i]);
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

  const parsed = SubmitExamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const { examId, answers } = parsed.data;

  const { data: exam, error: examError } = await db
    .from('exams')
    .select('id, user_id, started_at, finished_at')
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

  if (exam.finished_at) {
    return NextResponse.json(
      { error: 'Exam already submitted', code: 'EXAM_ALREADY_SUBMITTED' },
      { status: 400 }
    );
  }

  const { data: examQuestions, error: examQuestionsError } = await db
    .from('exam_questions')
    .select('id, question_id, question_snapshot')
    .eq('exam_id', examId);

  if (examQuestionsError || !examQuestions) {
    return NextResponse.json(
      { error: 'Failed to load exam questions', code: 'EXAM_QUESTIONS_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const eqMap = new Map<number, ExamQuestionRow>();
  for (const eq of examQuestions) {
    eqMap.set(eq.id, eq);
  }

  let correctCount = 0;
  const results: {
    examQuestionId: number;
    selectedAnswerIds: number[];
    is_correct: boolean;
  }[] = [];

  for (const answer of answers) {
    const eq = eqMap.get(answer.examQuestionId);
    if (!eq) continue;

    const snapshot =
      typeof eq.question_snapshot === 'string'
        ? (JSON.parse(eq.question_snapshot) as QuestionSnapshot)
        : eq.question_snapshot;
    const correct = isAnswerCorrect(snapshot, answer.selectedAnswerIds);

    if (correct) correctCount++;

    const { error: updateError } = await db
      .from('exam_questions')
      .update({
        user_answer: JSON.stringify(answer.selectedAnswerIds),
        is_correct: correct,
      })
      .eq('id', eq.id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to submit answers', code: 'ANSWER_SUBMIT_FAILED' },
        { status: 500 }
      );
    }

    results.push({
      examQuestionId: eq.id,
      selectedAnswerIds: answer.selectedAnswerIds,
      is_correct: correct,
    });
  }

  // Calculate duration server-side; use CURRENT_TIMESTAMP for finished_at to stay consistent with SQLite
  const startedAt = new Date(exam.started_at);
  const duration = Math.round((Date.now() - startedAt.getTime()) / 1000);

  const { error: finishError } = await db
    .from('exams')
    .update({ finished_at: new Date().toISOString(), duration })
    .eq('id', examId);

  if (finishError) {
    return NextResponse.json(
      { error: 'Failed to finalize exam', code: 'EXAM_FINALIZE_FAILED' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    score: correctCount,
    total: examQuestions.length,
    duration,
    results,
  });
}
