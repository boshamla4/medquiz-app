import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';
import { formatServerTiming, recordApiMetric } from '@/lib/performanceMetrics';
import { scoreQuestion, isFullyCorrect } from '@/lib/scoring';

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


export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const requestStart = Date.now();
  const stages: Record<string, number> = {};

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
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { examId, answers } = parsed.data;

  const loadExamStart = Date.now();
  const { data: exam, error: examError } = await db
    .from('exams')
    .select('id, user_id, started_at, finished_at')
    .eq('id', examId)
    .eq('user_id', session.userId)
    .maybeSingle();
  stages.load_exam = Date.now() - loadExamStart;

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

  const loadQuestionsStart = Date.now();
  const { data: examQuestions, error: examQuestionsError } = await db
    .from('exam_questions')
    .select('id, question_id, question_snapshot')
    .eq('exam_id', examId);
  stages.load_questions = Date.now() - loadQuestionsStart;

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

  let weightedScore = 0;
  const results: Array<{
    examQuestionId: number;
    selectedAnswerIds: number[];
    is_correct: boolean;
    score_weight: number;
  }> = [];

  const updates: Array<{
    id: number;
    selectedAnswerIds: number[];
    isCorrect: boolean;
    scoreWeight: number;
  }> = [];

  const scoreStart = Date.now();
  for (const answer of answers) {
    const eq = eqMap.get(answer.examQuestionId);
    if (!eq) continue;

    const snapshot =
      typeof eq.question_snapshot === 'string'
        ? (JSON.parse(eq.question_snapshot) as QuestionSnapshot)
        : eq.question_snapshot;

    const weight = scoreQuestion(snapshot, answer.selectedAnswerIds);
    const fullyCorrect = isFullyCorrect(snapshot, answer.selectedAnswerIds);
    weightedScore += weight;

    updates.push({
      id: eq.id,
      selectedAnswerIds: answer.selectedAnswerIds,
      isCorrect: fullyCorrect,
      scoreWeight: weight,
    });

    results.push({
      examQuestionId: eq.id,
      selectedAnswerIds: answer.selectedAnswerIds,
      is_correct: fullyCorrect,
      score_weight: weight,
    });
  }
  stages.score_answers = Date.now() - scoreStart;

  const updateBatchSize = 50;
  const updateAnswersStart = Date.now();
  for (let i = 0; i < updates.length; i += updateBatchSize) {
    const batch = updates.slice(i, i + updateBatchSize);
    const settled = await Promise.allSettled(
      batch.map((item) =>
        db
          .from('exam_questions')
          .update({
            user_answer: JSON.stringify(item.selectedAnswerIds),
            is_correct: item.isCorrect,
            score_weight: item.scoreWeight,
          })
          .eq('id', item.id)
      )
    );

    for (const result of settled) {
      if (result.status === 'rejected' || result.value.error) {
        return NextResponse.json(
          { error: 'Failed to submit answers', code: 'ANSWER_SUBMIT_FAILED' },
          { status: 500 }
        );
      }
    }
  }
  stages.update_answers = Date.now() - updateAnswersStart;

  // Calculate duration server-side; use CURRENT_TIMESTAMP for finished_at to stay consistent with SQLite
  const startedAt = new Date(exam.started_at);
  const duration = Math.round((Date.now() - startedAt.getTime()) / 1000);

  const finalizeStart = Date.now();
  const { error: finishError } = await db
    .from('exams')
    .update({ finished_at: new Date().toISOString(), duration })
    .eq('id', examId);
  stages.finalize_exam = Date.now() - finalizeStart;

  if (finishError) {
    return NextResponse.json(
      { error: 'Failed to finalize exam', code: 'EXAM_FINALIZE_FAILED' },
      { status: 500 }
    );
  }

  const totalMs = Date.now() - requestStart;
  const response = NextResponse.json({
    score: Math.round(weightedScore * 100) / 100,
    total: examQuestions.length,
    duration,
    results,
  });
  response.headers.set('Server-Timing', formatServerTiming(stages, totalMs));

  await recordApiMetric({
    route: '/api/exam/submit',
    statusCode: 200,
    userId: session.userId,
    totalMs,
    itemCount: updates.length,
    stages,
    meta: {
      examId,
      answerPayloadCount: answers.length,
    },
  });

  return response;
}
